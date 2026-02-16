import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAdsAccountId } from '@/lib/reddit/ads-queries';
import { createCampaign, createAdGroup, createAd } from '@/lib/reddit/ads-mutations';
import { checkAdsGuardrails } from '@/lib/reddit/validation';
import type { AdCTA } from '@/lib/reddit/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface CreateAdBody {
  campaignName: string;
  objective: string;
  dailyBudget: number;
  durationDays: number;
  targetingSubreddits: string[];
  targetingKeywords: string[];
  adHeadline: string;
  adBody: string;
  adCta: string;
  sourceSignalType: string;
  sourceSignalDetail: Record<string, unknown>;
  sourceOpportunityId?: string;
  sourceTrendSnapshotId?: string;
  decisionId?: string;
}

/**
 * Create a campaign via Reddit Ads API after approval.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreateAdBody;

    // Check ads guardrails
    const guardrailCheck = await checkAdsGuardrails(body.dailyBudget);
    if (!guardrailCheck.allowed) {
      return NextResponse.json(
        { error: `Ads guardrail blocked: ${guardrailCheck.reason}` },
        { status: 400 }
      );
    }

    // Create internal campaign record first (status: creating)
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + body.durationDays * 24 * 60 * 60 * 1000);

    const { data: internalCampaign, error: insertError } = await supabase
      .from('reddit_agent_ad_campaigns')
      .insert({
        campaign_name: body.campaignName,
        objective: body.objective.toLowerCase(),
        status: 'creating',
        daily_budget: body.dailyBudget,
        total_budget: body.dailyBudget * body.durationDays,
        targeting_subreddits: body.targetingSubreddits,
        targeting_keywords: body.targetingKeywords,
        ad_headline: body.adHeadline,
        ad_body: body.adBody,
        ad_cta: body.adCta,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        duration_days: body.durationDays,
        source_signal_type: body.sourceSignalType,
        source_opportunity_id: body.sourceOpportunityId || null,
        source_trend_snapshot_id: body.sourceTrendSnapshotId || null,
        source_signal_detail: body.sourceSignalDetail,
        recommended_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError || !internalCampaign) {
      throw new Error(`Failed to create internal campaign: ${insertError?.message}`);
    }

    // Create campaign via Reddit Ads API
    const accountId = await getAdsAccountId();
    const objective = body.objective.toUpperCase() as 'TRAFFIC' | 'CONVERSIONS' | 'AWARENESS';

    const redditCampaign = await createCampaign({
      accountId,
      name: body.campaignName,
      objective,
      dailyBudgetCents: Math.round(body.dailyBudget * 100),
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
    });

    // Create ad group with targeting
    const adGroup = await createAdGroup({
      accountId,
      campaignId: redditCampaign.id,
      name: `${body.campaignName} - Ad Group`,
      bidCents: 100, // $1.00 default CPC bid
      targetingSubreddits: body.targetingSubreddits,
      targetingKeywords: body.targetingKeywords,
    });

    // Create the ad creative
    await createAd({
      accountId,
      adGroupId: adGroup.id,
      headline: body.adHeadline,
      body: body.adBody,
      cta: (body.adCta as AdCTA) || 'LEARN_MORE',
      url: 'https://inecta.com',
    });

    // Update internal campaign with Reddit IDs
    await supabase
      .from('reddit_agent_ad_campaigns')
      .update({
        reddit_campaign_id: redditCampaign.id,
        status: 'active',
        created_at_reddit: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', internalCampaign.id);

    // Log to change log
    await supabase.from('reddit_agent_change_log').insert({
      action_type: 'ad_created',
      action_detail: `Created campaign "${body.campaignName}" — $${body.dailyBudget}/day for ${body.durationDays} days`,
      data_used: {
        campaignId: internalCampaign.id,
        redditCampaignId: redditCampaign.id,
        objective: body.objective,
        budget: body.dailyBudget,
        targeting: {
          subreddits: body.targetingSubreddits,
          keywords: body.targetingKeywords,
        },
        sourceSignal: body.sourceSignalType,
      },
      reason: `Ad created from ${body.sourceSignalType} signal`,
      outcome: 'executed',
    });

    return NextResponse.json({
      success: true,
      campaignId: internalCampaign.id,
      redditCampaignId: redditCampaign.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Campaign creation failed: ${message}` },
      { status: 500 }
    );
  }
}
