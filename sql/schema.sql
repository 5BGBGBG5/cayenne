-- Cayenne — Reddit Marketing Agent for Inecta
-- All tables in AiEO Supabase project (zqvyaxexfbgyvebfnudz)
-- Prefix: reddit_agent_*

-- ============================================================================
-- 1. CONFIG
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. REDDIT AUTH — OAuth tokens (single row, updated on every refresh)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_reddit_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read,identity,adsread',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. MONITORED SUBREDDITS
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_monitored_subreddits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit TEXT UNIQUE NOT NULL,
  display_name TEXT,
  intent_tier TEXT NOT NULL CHECK (intent_tier IN ('high', 'medium', 'low')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  scan_priority INT NOT NULL DEFAULT 5 CHECK (scan_priority BETWEEN 1 AND 10),
  description TEXT,
  subscriber_count INT,
  last_scanned_at TIMESTAMPTZ,
  last_post_fullname TEXT,
  min_weekly_engagements INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. KEYWORDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  weight TEXT NOT NULL CHECK (weight IN ('high', 'medium', 'low', 'competitor')),
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. SCANNED POSTS — Every post fetched from Reddit (dedup registry)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_scanned_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reddit_post_id TEXT UNIQUE NOT NULL,
  subreddit TEXT NOT NULL,
  title TEXT NOT NULL,
  selftext TEXT,
  author TEXT,
  post_score INT NOT NULL DEFAULT 0,
  num_comments INT NOT NULL DEFAULT 0,
  created_utc TIMESTAMPTZ NOT NULL,
  permalink TEXT NOT NULL,
  url TEXT,
  flair TEXT,
  layer1_score INT,
  layer1_keywords_matched TEXT[],
  layer2_analyzed BOOLEAN NOT NULL DEFAULT false,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scanned_posts_subreddit ON reddit_agent_scanned_posts(subreddit);
CREATE INDEX IF NOT EXISTS idx_scanned_posts_layer2 ON reddit_agent_scanned_posts(layer2_analyzed) WHERE layer2_analyzed = false;
CREATE INDEX IF NOT EXISTS idx_scanned_posts_scanned_at ON reddit_agent_scanned_posts(scanned_at DESC);

-- ============================================================================
-- 6. OPPORTUNITIES — Scored and classified
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_post_id UUID REFERENCES reddit_agent_scanned_posts(id),
  reddit_post_id TEXT NOT NULL,
  subreddit TEXT NOT NULL,
  title TEXT NOT NULL,
  permalink TEXT NOT NULL,
  author TEXT,
  opportunity_type TEXT NOT NULL CHECK (opportunity_type IN (
    'direct_ask', 'pain_point', 'competitor_mention',
    'compliance_question', 'industry_trend', 'process_discussion'
  )),
  layer1_score INT NOT NULL,
  layer2_score INT,
  combined_score NUMERIC,
  intent_analysis TEXT,
  key_signals JSONB,
  -- Agent loop metadata
  agent_loop_iterations INT,
  agent_loop_tools_used TEXT[],
  agent_investigation_summary TEXT,
  -- Status
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'response_drafted', 'approved', 'posted', 'expired', 'skipped'
  )),
  skip_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status ON reddit_agent_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_combined_score ON reddit_agent_opportunities(combined_score DESC);

-- ============================================================================
-- 7. DECISION QUEUE — Pending proposals for human approval
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_decision_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES reddit_agent_opportunities(id),
  reddit_post_id TEXT,
  subreddit TEXT,
  post_title TEXT,
  post_permalink TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'draft_response', 'ad_recommendation', 'ad_pause', 'ad_resume', 'trend_alert'
  )),
  action_summary TEXT NOT NULL,
  action_detail JSONB,
  draft_response TEXT,
  response_style TEXT,
  opportunity_type TEXT,
  combined_score NUMERIC,
  confidence NUMERIC,
  quality_check JSONB,
  promotional_score NUMERIC,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  priority INT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'expired'
  )),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_queue_status ON reddit_agent_decision_queue(status);
CREATE INDEX IF NOT EXISTS idx_decision_queue_action_type ON reddit_agent_decision_queue(action_type);

-- ============================================================================
-- 8. CHANGE LOG — Audit trail of all actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  action_detail TEXT,
  data_used JSONB,
  reason TEXT,
  outcome TEXT CHECK (outcome IN ('pending', 'approved', 'rejected', 'executed')),
  executed_by TEXT,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_log_action_type ON reddit_agent_change_log(action_type);
CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON reddit_agent_change_log(created_at DESC);

-- ============================================================================
-- 9. NOTIFICATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'success', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. GUARDRAILS
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_guardrails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT UNIQUE NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('threshold', 'rule', 'trend')),
  rule_category TEXT NOT NULL CHECK (rule_category IN (
    'frequency', 'content', 'freshness', 'quality', 'safety', 'anti_drift', 'ads'
  )),
  threshold_value NUMERIC,
  config_json JSONB,
  violation_action TEXT NOT NULL DEFAULT 'warn' CHECK (violation_action IN ('warn', 'block', 'alert')),
  check_layer TEXT NOT NULL DEFAULT 'both' CHECK (check_layer IN ('layer1', 'layer2', 'both')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 11. DAILY DIGEST
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_daily_digest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date DATE NOT NULL UNIQUE,
  summary_narrative TEXT,
  posts_scanned INT NOT NULL DEFAULT 0,
  opportunities_found INT NOT NULL DEFAULT 0,
  responses_drafted INT NOT NULL DEFAULT 0,
  ad_recommendations_generated INT NOT NULL DEFAULT 0,
  top_opportunities JSONB,
  trend_summary JSONB,
  ad_recommendations JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 12. TREND SNAPSHOTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_trend_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily', 'weekly')),
  topic_frequencies JSONB,
  subreddit_activity JSONB,
  competitor_mentions JSONB,
  emerging_topics TEXT[],
  sentiment_summary JSONB,
  ad_insights JSONB,
  agent_narrative TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_snapshots_date ON reddit_agent_trend_snapshots(snapshot_date DESC);

-- ============================================================================
-- 13. AD CAMPAIGNS — Campaign lifecycle tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reddit_campaign_id TEXT,
  campaign_name TEXT NOT NULL,
  objective TEXT NOT NULL CHECK (objective IN ('traffic', 'conversions', 'awareness')),
  status TEXT NOT NULL DEFAULT 'recommended' CHECK (status IN (
    'recommended', 'approved', 'creating', 'active', 'paused', 'completed', 'failed'
  )),
  daily_budget NUMERIC NOT NULL CHECK (daily_budget >= 5),
  total_budget NUMERIC,
  targeting_subreddits TEXT[],
  targeting_keywords TEXT[],
  ad_headline TEXT NOT NULL,
  ad_body TEXT NOT NULL,
  ad_cta TEXT,
  start_date DATE,
  end_date DATE,
  duration_days INT,
  -- Organic signal linkage (closed-loop correlation)
  source_signal_type TEXT,
  source_opportunity_id UUID REFERENCES reddit_agent_opportunities(id),
  source_trend_snapshot_id UUID REFERENCES reddit_agent_trend_snapshots(id),
  source_signal_detail JSONB,
  -- Lifecycle timestamps
  recommended_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at_reddit TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON reddit_agent_ad_campaigns(status);

-- ============================================================================
-- 14. AD PERFORMANCE — Daily performance data from Reddit Ads API
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_ad_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES reddit_agent_ad_campaigns(id),
  reddit_campaign_id TEXT,
  report_date DATE NOT NULL,
  impressions INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0,
  cpc NUMERIC NOT NULL DEFAULT 0,
  cpm NUMERIC NOT NULL DEFAULT 0,
  spend NUMERIC NOT NULL DEFAULT 0,
  conversions INT NOT NULL DEFAULT 0,
  conversion_value NUMERIC NOT NULL DEFAULT 0,
  roas NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_performance_campaign ON reddit_agent_ad_performance(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_performance_date ON reddit_agent_ad_performance(report_date DESC);

-- ============================================================================
-- 15. AD SIGNAL CORRELATION — Tracks which organic signals produce best ad ROI
-- ============================================================================
CREATE TABLE IF NOT EXISTS reddit_agent_ad_signal_correlation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES reddit_agent_ad_campaigns(id),
  source_signal_type TEXT NOT NULL,
  source_signal_detail JSONB,
  total_spend NUMERIC NOT NULL DEFAULT 0,
  total_impressions INT NOT NULL DEFAULT 0,
  total_clicks INT NOT NULL DEFAULT 0,
  total_conversions INT NOT NULL DEFAULT 0,
  total_roas NUMERIC NOT NULL DEFAULT 0,
  performance_rating TEXT CHECK (performance_rating IN ('high', 'medium', 'low')),
  correlation_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_correlation_signal_type ON reddit_agent_ad_signal_correlation(source_signal_type);

-- ============================================================================
-- SEED: Default monitored subreddits
-- ============================================================================
INSERT INTO reddit_agent_monitored_subreddits (subreddit, display_name, intent_tier, scan_priority, description, subscriber_count, min_weekly_engagements) VALUES
  -- Tier 1: High Intent
  ('ERP', 'r/ERP', 'high', 9, 'Direct ERP discussions, vendor comparisons, implementation questions', 15000, 3),
  ('dynamics365', 'r/dynamics365', 'high', 8, 'Microsoft Dynamics 365 community — competitive positioning', NULL, 2),
  ('businesscentral', 'r/businesscentral', 'high', 8, 'Dynamics 365 Business Central users — Inecta platform base', NULL, 2),
  ('smallbusiness', 'r/smallbusiness', 'high', 7, 'SMB owners asking about operations software, inventory, accounting', 1900000, 3),
  ('SaaS', 'r/SaaS', 'high', 7, 'B2B SaaS evaluations, ERP/software discovery', 100000, 2),
  -- Tier 2: Medium Intent
  ('FoodScience', 'r/FoodScience', 'medium', 6, 'HACCP, food safety, regulatory discussions — professional audience', 50000, 2),
  ('supplychain', 'r/supplychain', 'medium', 6, 'Supply chain management, inventory optimization, demand planning', NULL, 2),
  ('manufacturing', 'r/manufacturing', 'medium', 6, 'General manufacturing ops, MRP/ERP discussions', 9000, 2),
  ('accounting', 'r/accounting', 'medium', 5, 'Financial controls, cost tracking, multi-entity', 1200000, 1),
  ('operations', 'r/operations', 'medium', 5, 'Operations management — directly relevant to manufacturing ops', 15000, 1),
  -- Tier 3: Low Intent / Awareness
  ('Brewing', 'r/Brewing', 'low', 4, 'Commercial brewery operations (filter for commercial, not homebrew)', 500000, 1),
  ('FoodIndustry', 'r/FoodIndustry', 'low', 4, 'General F&B industry discussions', NULL, 1),
  ('Farming', 'r/Farming', 'low', 3, 'Agricultural and food production operations', 82000, 1),
  ('logistics', 'r/logistics', 'low', 3, 'Warehouse and distribution operations', 4200, 1),
  ('QualityAssurance', 'r/QualityAssurance', 'low', 3, 'Quality management and compliance processes', NULL, 1)
ON CONFLICT (subreddit) DO NOTHING;

-- ============================================================================
-- SEED: Default keywords
-- ============================================================================
INSERT INTO reddit_agent_keywords (keyword, weight, category) VALUES
  -- High weight: Direct ERP / software search intent
  ('food manufacturing ERP', 'high', 'erp'),
  ('food manufacturing software', 'high', 'erp'),
  ('ERP for food', 'high', 'erp'),
  ('food production software', 'high', 'erp'),
  ('food ERP', 'high', 'erp'),
  ('beverage ERP', 'high', 'erp'),
  ('brewery software', 'high', 'erp'),
  ('dairy ERP', 'high', 'erp'),
  ('meat processing software', 'high', 'erp'),
  ('seafood traceability', 'high', 'traceability'),
  ('lot tracking software', 'high', 'traceability'),
  ('FSMA 204', 'high', 'compliance'),
  ('FSMA traceability', 'high', 'compliance'),
  ('food safety software', 'high', 'compliance'),
  -- Medium weight: Pain points Inecta solves
  ('lot tracking', 'medium', 'traceability'),
  ('batch tracking', 'medium', 'traceability'),
  ('recipe management', 'medium', 'operations'),
  ('production scheduling food', 'medium', 'operations'),
  ('food recall', 'medium', 'compliance'),
  ('HACCP software', 'medium', 'compliance'),
  ('inventory management food', 'medium', 'operations'),
  ('cost tracking manufacturing', 'medium', 'operations'),
  ('multi-entity accounting', 'medium', 'operations'),
  ('supply chain traceability', 'medium', 'traceability'),
  ('quality management food', 'medium', 'compliance'),
  ('production planning', 'medium', 'operations'),
  ('MRP system', 'medium', 'erp'),
  ('Business Central food', 'medium', 'erp'),
  -- Low weight: Industry awareness
  ('food manufacturing', 'low', 'industry'),
  ('food production', 'low', 'industry'),
  ('food and beverage', 'low', 'industry'),
  ('manufacturing software', 'low', 'industry'),
  ('compliance software', 'low', 'industry'),
  ('traceability', 'low', 'industry'),
  -- Competitor mentions
  ('NetSuite food', 'competitor', 'competitor'),
  ('SAP food manufacturing', 'competitor', 'competitor'),
  ('Fishbowl inventory', 'competitor', 'competitor'),
  ('Aptean food', 'competitor', 'competitor'),
  ('Plex manufacturing', 'competitor', 'competitor'),
  ('BatchMaster', 'competitor', 'competitor'),
  ('DEACOM', 'competitor', 'competitor'),
  ('Sage food manufacturing', 'competitor', 'competitor'),
  ('NetSuite manufacturing', 'competitor', 'competitor'),
  ('SAP Business One food', 'competitor', 'competitor')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED: Default guardrails
-- ============================================================================
INSERT INTO reddit_agent_guardrails (rule_name, rule_type, rule_category, threshold_value, config_json, violation_action, check_layer, description) VALUES
  -- Frequency guardrails
  ('max_responses_per_subreddit_per_day', 'threshold', 'frequency', 2, NULL, 'block', 'layer1', 'Max responses per subreddit per day'),
  ('max_responses_per_subreddit_per_week', 'threshold', 'frequency', 7, NULL, 'block', 'layer1', 'Max responses per subreddit per week'),
  ('max_total_responses_per_day', 'threshold', 'frequency', 10, NULL, 'block', 'layer1', 'Max total responses per day across all subreddits'),
  ('min_hours_between_responses_same_subreddit', 'threshold', 'frequency', 4, NULL, 'block', 'layer1', 'Min hours between responses in same subreddit'),
  ('min_engagement_high_intent_pct', 'threshold', 'frequency', 40, NULL, 'warn', 'both', 'Min % of weekly responses in Tier 1 subreddits'),
  -- Freshness guardrails
  ('max_post_age_hours', 'threshold', 'freshness', 18, NULL, 'block', 'layer1', 'Max post age in hours for response eligibility'),
  ('stale_thread_absolute_cutoff', 'threshold', 'freshness', 48, NULL, 'block', 'layer1', 'Absolute cutoff — never engage posts older than this'),
  -- Content guardrails
  ('never_mention_inecta', 'rule', 'content', 0, '{"prohibited": ["inecta", "Inecta", "INECTA"]}', 'block', 'layer2', 'Responses must never mention Inecta by name'),
  ('never_include_links', 'rule', 'content', 0, NULL, 'block', 'layer2', 'Responses must never include URLs'),
  ('prohibited_phrases', 'rule', 'content', NULL, '{"phrases": ["book a demo", "sign up", "our product", "our solution", "check out", "we offer", "free trial"]}', 'block', 'layer2', 'Block responses containing promotional phrases'),
  ('max_response_length', 'threshold', 'content', 2000, NULL, 'warn', 'layer2', 'Max response length in characters'),
  ('min_response_length', 'threshold', 'content', 150, NULL, 'warn', 'layer2', 'Min response length in characters'),
  ('max_promotional_score', 'threshold', 'quality', 0.3, NULL, 'block', 'layer2', 'Max promotional score (0-1) from Claude evaluation'),
  -- Safety guardrails
  ('human_approval_required', 'rule', 'safety', NULL, NULL, 'block', 'both', 'All responses require human approval before posting'),
  ('never_engage_prohibited_subreddits', 'rule', 'safety', NULL, '{"subreddits": []}', 'block', 'layer1', 'Never engage in excluded subreddits'),
  ('never_disparage_competitors', 'rule', 'safety', NULL, NULL, 'block', 'layer2', 'Never make negative comments about competitors'),
  ('context_sensitivity_check', 'rule', 'safety', NULL, '{"skip_topics": ["layoffs", "recall", "crisis", "death", "injury", "lawsuit"]}', 'block', 'layer2', 'Skip posts about sensitive topics'),
  -- Ads guardrails
  ('ads_total_daily_budget_cap', 'threshold', 'ads', 50, NULL, 'block', 'both', 'Max total daily spend across all Cayenne-managed campaigns'),
  ('ads_max_campaign_duration_days', 'threshold', 'ads', 7, NULL, 'warn', 'both', 'Default max campaign duration in days'),
  ('ads_human_approval_required', 'rule', 'ads', NULL, NULL, 'block', 'both', 'All ad campaigns require human approval'),
  ('ads_auto_pause_cpc_threshold', 'threshold', 'ads', 3.00, NULL, 'block', 'both', 'Auto-pause campaigns exceeding this CPC'),
  ('ads_max_new_campaigns_per_day', 'threshold', 'ads', 3, NULL, 'block', 'both', 'Max new campaigns per day'),
  ('ads_must_have_source_signal', 'rule', 'ads', NULL, NULL, 'block', 'both', 'Every ad must link to organic signal or be tagged evergreen'),
  ('ads_min_campaign_budget', 'threshold', 'ads', 5, NULL, 'block', 'both', 'Min daily budget per campaign (Reddit minimum)'),
  ('ads_evergreen_presence_check', 'rule', 'ads', NULL, '{"min_evergreen_campaigns": 1}', 'warn', 'both', 'At least 1 evergreen campaign should be active'),
  -- Anti-drift guardrails
  ('subreddit_distribution_drift', 'trend', 'anti_drift', 30, NULL, 'alert', 'both', 'Alert if any tier engagement drops >30% from baseline'),
  ('promotional_tone_trend', 'trend', 'anti_drift', 0.1, NULL, 'alert', 'both', 'Alert if 7d avg promotional score exceeds 30d avg by >0.1'),
  ('response_freshness_trend', 'trend', 'anti_drift', 50, NULL, 'alert', 'both', 'Alert if 7d avg post age >50% higher than 30d avg'),
  ('subreddit_coverage_drift', 'trend', 'anti_drift', 80, NULL, 'alert', 'both', 'Alert if unique subreddits engaged drops below 80% of baseline'),
  ('ads_reactive_vs_evergreen_ratio', 'trend', 'anti_drift', 30, NULL, 'alert', 'both', 'Alert if evergreen drops below 30% of total ad spend')
ON CONFLICT (rule_name) DO NOTHING;
