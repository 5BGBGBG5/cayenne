import { supabase } from '../supabase';
import type { Guardrail } from './types';

export interface ValidationResult {
  passed: boolean;
  violations: Array<{
    rule: string;
    message: string;
    action: 'warn' | 'block' | 'alert';
  }>;
  promotionalScore: number | null;
  qualityCheck: {
    length: number;
    hasLinks: boolean;
    mentionsInecta: boolean;
    hasProhibitedPhrases: string[];
    passesAll: boolean;
  };
}

let cachedGuardrails: Guardrail[] | null = null;
let guardrailCacheTime = 0;
const GUARDRAIL_CACHE_TTL = 5 * 60 * 1000;

/**
 * Load active guardrails from Supabase. Cached for 5 minutes.
 */
export async function loadGuardrails(): Promise<Guardrail[]> {
  if (cachedGuardrails && Date.now() - guardrailCacheTime < GUARDRAIL_CACHE_TTL) {
    return cachedGuardrails;
  }

  const { data, error } = await supabase
    .from('reddit_agent_guardrails')
    .select('*')
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to load guardrails: ${error.message}`);
  }

  cachedGuardrails = (data || []) as Guardrail[];
  guardrailCacheTime = Date.now();
  return cachedGuardrails;
}

/**
 * Validate a draft response against content guardrails.
 * Used both as the `evaluate_draft` agent tool and as a post-loop safety net.
 */
export async function validateDraftResponse(
  draft: string,
  promotionalScore?: number
): Promise<ValidationResult> {
  const guardrails = await loadGuardrails();
  const violations: ValidationResult['violations'] = [];

  // Check: never mention Inecta
  const mentionsInecta = /\binecta\b/i.test(draft);
  if (mentionsInecta) {
    const rule = guardrails.find(g => g.rule_name === 'never_mention_inecta');
    violations.push({
      rule: 'never_mention_inecta',
      message: 'Response mentions Inecta by name',
      action: rule?.violation_action || 'block',
    });
  }

  // Check: never include links
  const hasLinks = /https?:\/\/|www\./i.test(draft);
  if (hasLinks) {
    const rule = guardrails.find(g => g.rule_name === 'never_include_links');
    violations.push({
      rule: 'never_include_links',
      message: 'Response contains URLs',
      action: rule?.violation_action || 'block',
    });
  }

  // Check: prohibited phrases
  const prohibitedRule = guardrails.find(g => g.rule_name === 'prohibited_phrases');
  const prohibitedPhrases = (prohibitedRule?.config_json as { phrases?: string[] })?.phrases || [
    'book a demo', 'sign up', 'our product', 'our solution',
    'check out', 'we offer', 'free trial',
  ];
  const foundProhibited: string[] = [];
  for (const phrase of prohibitedPhrases) {
    if (draft.toLowerCase().includes(phrase.toLowerCase())) {
      foundProhibited.push(phrase);
    }
  }
  if (foundProhibited.length > 0) {
    violations.push({
      rule: 'prohibited_phrases',
      message: `Contains prohibited phrases: ${foundProhibited.join(', ')}`,
      action: prohibitedRule?.violation_action || 'block',
    });
  }

  // Check: response length
  const maxLenRule = guardrails.find(g => g.rule_name === 'max_response_length');
  const maxLen = maxLenRule?.threshold_value || 2000;
  if (draft.length > maxLen) {
    violations.push({
      rule: 'max_response_length',
      message: `Response is ${draft.length} chars (max ${maxLen})`,
      action: maxLenRule?.violation_action || 'warn',
    });
  }

  const minLenRule = guardrails.find(g => g.rule_name === 'min_response_length');
  const minLen = minLenRule?.threshold_value || 150;
  if (draft.length < minLen) {
    violations.push({
      rule: 'min_response_length',
      message: `Response is ${draft.length} chars (min ${minLen})`,
      action: minLenRule?.violation_action || 'warn',
    });
  }

  // Check: promotional score
  const maxPromoRule = guardrails.find(g => g.rule_name === 'max_promotional_score');
  const maxPromo = maxPromoRule?.threshold_value || 0.3;
  if (promotionalScore !== undefined && promotionalScore > maxPromo) {
    violations.push({
      rule: 'max_promotional_score',
      message: `Promotional score ${promotionalScore} exceeds max ${maxPromo}`,
      action: maxPromoRule?.violation_action || 'block',
    });
  }

  const hasBlockingViolation = violations.some(v => v.action === 'block');

  return {
    passed: !hasBlockingViolation,
    violations,
    promotionalScore: promotionalScore ?? null,
    qualityCheck: {
      length: draft.length,
      hasLinks,
      mentionsInecta,
      hasProhibitedPhrases: foundProhibited,
      passesAll: violations.length === 0,
    },
  };
}

/**
 * Check Layer 1 frequency guardrails for a subreddit.
 * Returns true if we're allowed to engage, false if blocked.
 */
export async function checkFrequencyGuardrails(subreddit: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const guardrails = await loadGuardrails();

  // Check daily per-subreddit limit
  const dailySubRule = guardrails.find(g => g.rule_name === 'max_responses_per_subreddit_per_day');
  const dailySubMax = dailySubRule?.threshold_value || 2;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count: dailySubCount } = await supabase
    .from('reddit_agent_decision_queue')
    .select('id', { count: 'exact', head: true })
    .eq('subreddit', subreddit)
    .eq('action_type', 'draft_response')
    .in('status', ['pending', 'approved'])
    .gte('created_at', today.toISOString());

  if ((dailySubCount || 0) >= dailySubMax) {
    return { allowed: false, reason: `Reached ${dailySubMax} responses in r/${subreddit} today` };
  }

  // Check total daily limit
  const dailyTotalRule = guardrails.find(g => g.rule_name === 'max_total_responses_per_day');
  const dailyTotalMax = dailyTotalRule?.threshold_value || 10;

  const { count: dailyTotalCount } = await supabase
    .from('reddit_agent_decision_queue')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', 'draft_response')
    .in('status', ['pending', 'approved'])
    .gte('created_at', today.toISOString());

  if ((dailyTotalCount || 0) >= dailyTotalMax) {
    return { allowed: false, reason: `Reached ${dailyTotalMax} total responses today` };
  }

  // Check min hours between responses in same subreddit
  const minHoursRule = guardrails.find(g => g.rule_name === 'min_hours_between_responses_same_subreddit');
  const minHours = minHoursRule?.threshold_value || 4;
  const minHoursAgo = new Date(Date.now() - minHours * 60 * 60 * 1000).toISOString();

  const { count: recentSubCount } = await supabase
    .from('reddit_agent_decision_queue')
    .select('id', { count: 'exact', head: true })
    .eq('subreddit', subreddit)
    .eq('action_type', 'draft_response')
    .in('status', ['pending', 'approved'])
    .gte('created_at', minHoursAgo);

  if ((recentSubCount || 0) > 0) {
    return { allowed: false, reason: `Must wait ${minHours}h between responses in r/${subreddit}` };
  }

  return { allowed: true };
}

/**
 * Check ads guardrails before creating a campaign.
 */
export async function checkAdsGuardrails(dailyBudget: number): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const guardrails = await loadGuardrails();

  // Check daily budget cap across all campaigns
  const budgetCapRule = guardrails.find(g => g.rule_name === 'ads_total_daily_budget_cap');
  const budgetCap = budgetCapRule?.threshold_value || 50;

  const { data: activeCampaigns } = await supabase
    .from('reddit_agent_ad_campaigns')
    .select('daily_budget')
    .eq('status', 'active');

  const currentDailyTotal = (activeCampaigns || []).reduce(
    (sum, c) => sum + (c.daily_budget || 0), 0
  );

  if (currentDailyTotal + dailyBudget > budgetCap) {
    return {
      allowed: false,
      reason: `Adding $${dailyBudget}/day would exceed $${budgetCap}/day cap (current: $${currentDailyTotal})`,
    };
  }

  // Check max new campaigns per day
  const maxCampaignsRule = guardrails.find(g => g.rule_name === 'ads_max_new_campaigns_per_day');
  const maxNewPerDay = maxCampaignsRule?.threshold_value || 3;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count: todayCampaigns } = await supabase
    .from('reddit_agent_ad_campaigns')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today.toISOString());

  if ((todayCampaigns || 0) >= maxNewPerDay) {
    return { allowed: false, reason: `Reached ${maxNewPerDay} new campaigns today` };
  }

  // Check min budget
  const minBudgetRule = guardrails.find(g => g.rule_name === 'ads_min_campaign_budget');
  const minBudget = minBudgetRule?.threshold_value || 5;

  if (dailyBudget < minBudget) {
    return { allowed: false, reason: `Daily budget $${dailyBudget} below minimum $${minBudget}` };
  }

  return { allowed: true };
}
