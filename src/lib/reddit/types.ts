// ============================================================================
// Reddit Data API Types
// ============================================================================

export interface RedditPost {
  id: string;            // e.g. "abc123"
  name: string;          // fullname e.g. "t3_abc123"
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  score: number;
  num_comments: number;
  created_utc: number;   // Unix timestamp
  permalink: string;
  url: string;
  link_flair_text: string | null;
  is_self: boolean;
  over_18: boolean;
}

export interface RedditComment {
  id: string;
  name: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  parent_id: string;
  replies: unknown; // Reddit returns nested Listing, empty string, or undefined
  depth: number;
}

export interface RedditListing<T> {
  kind: 'Listing';
  data: {
    after: string | null;
    before: string | null;
    children: Array<{
      kind: string;
      data: T;
    }>;
  };
}

export interface RedditUserPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
}

// ============================================================================
// Reddit Ads API v3 Types
// ============================================================================

export type CampaignObjective = 'TRAFFIC' | 'CONVERSIONS' | 'AWARENESS';
export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
export type AdCTA =
  | 'LEARN_MORE' | 'SIGN_UP' | 'SHOP_NOW' | 'INSTALL' | 'WATCH_NOW'
  | 'GET_STARTED' | 'CONTACT_US' | 'DOWNLOAD' | 'APPLY_NOW' | 'BOOK_NOW'
  | 'SUBSCRIBE' | 'ORDER_NOW' | 'READ_MORE';

export interface RedditAdCampaign {
  id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  budget_type: 'daily' | 'lifetime';
  budget_cents: number;        // Reddit Ads API uses cents
  start_time: string;          // ISO 8601
  end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface RedditAdGroup {
  id: string;
  campaign_id: string;
  name: string;
  bid_strategy: 'CPC' | 'CPM' | 'CPA';
  bid_cents: number;
  targeting: RedditAdTargeting;
  status: CampaignStatus;
}

export interface RedditAdTargeting {
  subreddits?: string[];
  keywords?: string[];
  interests?: string[];
  locations?: string[];
  devices?: string[];
}

export interface RedditAdCreative {
  id: string;
  ad_group_id: string;
  headline: string;            // 300 char max
  body: string;                // 40K char max
  cta: AdCTA;
  thumbnail_url?: string;
  url: string;
  status: CampaignStatus;
}

export interface RedditAdReport {
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  spend_cents: number;
  conversions: number;
  conversion_value_cents: number;
}

// ============================================================================
// Internal Types (Cayenne-specific)
// ============================================================================

export interface ScannedPost {
  id: string;
  reddit_post_id: string;
  subreddit: string;
  title: string;
  selftext: string | null;
  author: string | null;
  post_score: number;
  num_comments: number;
  created_utc: string;
  permalink: string;
  url: string | null;
  flair: string | null;
  layer1_score: number | null;
  layer1_keywords_matched: string[] | null;
  layer2_analyzed: boolean;
  scanned_at: string;
}

export type OpportunityType =
  | 'direct_ask'
  | 'pain_point'
  | 'competitor_mention'
  | 'compliance_question'
  | 'industry_trend'
  | 'process_discussion';

export type OpportunityStatus =
  | 'new'
  | 'response_drafted'
  | 'approved'
  | 'posted'
  | 'expired'
  | 'skipped';

export interface Opportunity {
  id: string;
  scanned_post_id: string;
  reddit_post_id: string;
  subreddit: string;
  title: string;
  permalink: string;
  author: string | null;
  opportunity_type: OpportunityType;
  layer1_score: number;
  layer2_score: number | null;
  combined_score: number | null;
  intent_analysis: string | null;
  key_signals: Record<string, unknown> | null;
  agent_loop_iterations: number | null;
  agent_loop_tools_used: string[] | null;
  agent_investigation_summary: string | null;
  status: OpportunityStatus;
  skip_reason: string | null;
  expires_at: string;
  created_at: string;
}

export type DecisionActionType =
  | 'draft_response'
  | 'ad_recommendation'
  | 'ad_pause'
  | 'ad_resume'
  | 'trend_alert';

export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface DecisionQueueItem {
  id: string;
  opportunity_id: string | null;
  reddit_post_id: string | null;
  subreddit: string | null;
  post_title: string | null;
  post_permalink: string | null;
  action_type: DecisionActionType;
  action_summary: string;
  action_detail: Record<string, unknown> | null;
  draft_response: string | null;
  response_style: string | null;
  opportunity_type: string | null;
  combined_score: number | null;
  confidence: number | null;
  quality_check: Record<string, unknown> | null;
  promotional_score: number | null;
  risk_level: 'low' | 'medium' | 'high';
  priority: number;
  status: DecisionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  expires_at: string;
  created_at: string;
}

export type InternalCampaignStatus =
  | 'recommended'
  | 'approved'
  | 'creating'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed';

export interface AdCampaign {
  id: string;
  reddit_campaign_id: string | null;
  campaign_name: string;
  objective: string;
  status: InternalCampaignStatus;
  daily_budget: number;
  total_budget: number | null;
  targeting_subreddits: string[] | null;
  targeting_keywords: string[] | null;
  ad_headline: string;
  ad_body: string;
  ad_cta: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  source_signal_type: string | null;
  source_opportunity_id: string | null;
  source_trend_snapshot_id: string | null;
  source_signal_detail: Record<string, unknown> | null;
  recommended_at: string | null;
  approved_at: string | null;
  created_at_reddit: string | null;
  paused_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitoredSubreddit {
  id: string;
  subreddit: string;
  display_name: string | null;
  intent_tier: 'high' | 'medium' | 'low';
  is_active: boolean;
  scan_priority: number;
  description: string | null;
  subscriber_count: number | null;
  last_scanned_at: string | null;
  last_post_fullname: string | null;
  min_weekly_engagements: number;
}

export interface Keyword {
  id: string;
  keyword: string;
  weight: 'high' | 'medium' | 'low' | 'competitor';
  category: string | null;
  is_active: boolean;
}

export interface Guardrail {
  id: string;
  rule_name: string;
  rule_type: 'threshold' | 'rule' | 'trend';
  rule_category: string;
  threshold_value: number | null;
  config_json: Record<string, unknown> | null;
  violation_action: 'warn' | 'block' | 'alert';
  check_layer: 'layer1' | 'layer2' | 'both';
  is_active: boolean;
  description: string | null;
}

export interface ChangeLogEntry {
  id: string;
  action_type: string;
  action_detail: string | null;
  data_used: Record<string, unknown> | null;
  reason: string | null;
  outcome: string | null;
  executed_by: string | null;
  executed_at: string | null;
  created_at: string;
}

// ============================================================================
// Agent Loop Types
// ============================================================================

export interface AgentToolCall {
  tool_name: string;
  input: Record<string, unknown>;
  output: unknown;
  duration_ms: number;
}

export interface AgentLoopResult {
  action: 'submit' | 'skip';
  opportunity_type?: OpportunityType;
  layer2_score?: number;
  intent_analysis?: string;
  key_signals?: Record<string, unknown>;
  draft_response?: string;
  response_style?: string;
  quality_check?: Record<string, unknown>;
  promotional_score?: number;
  skip_reason?: string;
  investigation_summary: string;
  iterations: number;
  tools_used: string[];
  tool_calls: AgentToolCall[];
}

export interface Layer1Candidate {
  scanned_post_id: string;
  reddit_post_id: string;
  subreddit: string;
  title: string;
  selftext: string | null;
  author: string | null;
  post_score: number;
  num_comments: number;
  created_utc: string;
  permalink: string;
  flair: string | null;
  layer1_score: number;
  layer1_keywords_matched: string[];
  intent_tier: 'high' | 'medium' | 'low';
}
