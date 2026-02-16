"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, Target, MessageSquare, BarChart3,
  Megaphone, FileText, Clock, Shield,
  ExternalLink, Copy, Check, AlertTriangle,
  Pause, Play, ChevronDown, ChevronUp, Eye,
  RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Supabase client (browser-side, uses anon key)
// ============================================================================
const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder'
);

// ============================================================================
// Types
// ============================================================================
type TabId = 'overview' | 'opportunities' | 'responses' | 'trends' | 'ads' | 'digest' | 'changelog' | 'guardrails';

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'opportunities', label: 'Opportunities', icon: Target },
  { id: 'responses', label: 'Responses', icon: MessageSquare },
  { id: 'trends', label: 'Trends', icon: BarChart3 },
  { id: 'ads', label: 'Ads', icon: Megaphone },
  { id: 'digest', label: 'Digest', icon: FileText },
  { id: 'changelog', label: 'Change Log', icon: Clock },
  { id: 'guardrails', label: 'Guardrails', icon: Shield },
];

interface Opportunity {
  id: string;
  reddit_post_id: string;
  subreddit: string;
  title: string;
  permalink: string;
  author: string | null;
  opportunity_type: string;
  layer1_score: number;
  layer2_score: number | null;
  combined_score: number | null;
  intent_analysis: string | null;
  agent_investigation_summary: string | null;
  agent_loop_iterations: number | null;
  agent_loop_tools_used: string[] | null;
  status: string;
  skip_reason: string | null;
  created_at: string;
  expires_at: string;
}

interface Decision {
  id: string;
  opportunity_id: string | null;
  reddit_post_id: string | null;
  subreddit: string | null;
  post_title: string | null;
  post_permalink: string | null;
  action_type: string;
  action_summary: string;
  action_detail: Record<string, unknown> | null;
  draft_response: string | null;
  response_style: string | null;
  opportunity_type: string | null;
  combined_score: number | null;
  promotional_score: number | null;
  status: string;
  review_notes: string | null;
  created_at: string;
  expires_at: string;
}

interface Campaign {
  id: string;
  reddit_campaign_id: string | null;
  campaign_name: string;
  objective: string;
  status: string;
  daily_budget: number;
  targeting_subreddits: string[] | null;
  targeting_keywords: string[] | null;
  ad_headline: string;
  ad_body: string;
  source_signal_type: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

interface ChangeLogItem {
  id: string;
  action_type: string;
  action_detail: string | null;
  data_used: Record<string, unknown> | null;
  reason: string | null;
  outcome: string | null;
  created_at: string;
}

interface Guardrail {
  id: string;
  rule_name: string;
  rule_type: string;
  rule_category: string;
  threshold_value: number | null;
  violation_action: string;
  check_layer: string;
  is_active: boolean;
  description: string | null;
}

interface Digest {
  id: string;
  digest_date: string;
  summary_narrative: string | null;
  posts_scanned: number;
  opportunities_found: number;
  responses_drafted: number;
  ad_recommendations_generated: number;
  top_opportunities: unknown[];
  trend_summary: Record<string, unknown> | null;
}

// ============================================================================
// Helper Components
// ============================================================================

function MetricCard({ label, value, icon: Icon, color = 'cyan' }: {
  label: string; value: string | number; icon: React.ElementType; color?: string;
}) {
  const colorMap: Record<string, string> = {
    cyan: 'text-cyan-400',
    green: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
  };
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[var(--text-secondary)] text-sm">{label}</span>
        <Icon className={`w-5 h-5 ${colorMap[color] || colorMap.cyan}`} />
      </div>
      <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-500/20 text-amber-400',
    approved: 'bg-emerald-500/20 text-emerald-400',
    rejected: 'bg-red-500/20 text-red-400',
    expired: 'bg-gray-500/20 text-gray-400',
    new: 'bg-blue-500/20 text-blue-400',
    response_drafted: 'bg-cyan-500/20 text-cyan-400',
    posted: 'bg-emerald-500/20 text-emerald-400',
    skipped: 'bg-gray-500/20 text-gray-400',
    active: 'bg-emerald-500/20 text-emerald-400',
    paused: 'bg-amber-500/20 text-amber-400',
    creating: 'bg-blue-500/20 text-blue-400',
    recommended: 'bg-purple-500/20 text-purple-400',
    failed: 'bg-red-500/20 text-red-400',
    completed: 'bg-gray-500/20 text-gray-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.new}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    direct_ask: 'bg-cyan-500/20 text-cyan-400',
    pain_point: 'bg-amber-500/20 text-amber-400',
    competitor_mention: 'bg-red-500/20 text-red-400',
    compliance_question: 'bg-purple-500/20 text-purple-400',
    industry_trend: 'bg-blue-500/20 text-blue-400',
    process_discussion: 'bg-emerald-500/20 text-emerald-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[type] || 'bg-gray-500/20 text-gray-400'}`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function ExpandableText({ text, maxLength = 200 }: { text: string; maxLength?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= maxLength) return <p className="text-sm text-[var(--text-secondary)]">{text}</p>;
  return (
    <div>
      <p className="text-sm text-[var(--text-secondary)]">
        {expanded ? text : `${text.slice(0, maxLength)}...`}
      </p>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-[var(--text-accent)] mt-1 hover:underline"
      >
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="text-center py-16 text-[var(--text-secondary)]">
      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
      Loading...
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16 text-[var(--text-secondary)]">{message}</div>
  );
}

// ============================================================================
// Tab: Overview
// ============================================================================
function OverviewTab({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [activity, setActivity] = useState<ChangeLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [
        { count: scannedToday },
        { count: scannedWeek },
        { count: oppsToday },
        { count: pendingResponses },
        { count: activeCampaigns },
        { count: pendingAds },
        { data: activityData },
        { data: activeAds },
      ] = await Promise.all([
        supabase.from('reddit_agent_scanned_posts').select('id', { count: 'exact', head: true }).gte('scanned_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
        supabase.from('reddit_agent_scanned_posts').select('id', { count: 'exact', head: true }).gte('scanned_at', new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from('reddit_agent_opportunities').select('id', { count: 'exact', head: true }).gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
        supabase.from('reddit_agent_decision_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('action_type', 'draft_response'),
        supabase.from('reddit_agent_ad_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('reddit_agent_decision_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('action_type', 'ad_recommendation'),
        supabase.from('reddit_agent_change_log').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('reddit_agent_ad_campaigns').select('daily_budget').eq('status', 'active'),
      ]);

      const totalDailySpend = (activeAds || []).reduce((s: number, c: { daily_budget: number }) => s + (c.daily_budget || 0), 0);

      setMetrics({
        scannedToday: scannedToday || 0,
        scannedWeek: scannedWeek || 0,
        oppsToday: oppsToday || 0,
        pendingResponses: pendingResponses || 0,
        activeCampaigns: activeCampaigns || 0,
        pendingAds: pendingAds || 0,
        totalDailySpend,
      });
      setActivity((activityData || []) as ChangeLogItem[]);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingState />;
  if (!metrics) return <EmptyState message="No data available" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard label="Scanned Today" value={metrics.scannedToday as number} icon={Eye} />
        <MetricCard label="Scanned (7d)" value={metrics.scannedWeek as number} icon={TrendingUp} color="blue" />
        <MetricCard label="Opportunities" value={metrics.oppsToday as number} icon={Target} color="green" />
        <MetricCard
          label="Pending Responses"
          value={metrics.pendingResponses as number}
          icon={MessageSquare}
          color="amber"
        />
        <MetricCard label="Active Campaigns" value={metrics.activeCampaigns as number} icon={Megaphone} color="purple" />
        <MetricCard label="Daily Ad Spend" value={`$${metrics.totalDailySpend}`} icon={BarChart3} color="cyan" />
      </div>

      {((metrics.pendingResponses as number) > 0 || (metrics.pendingAds as number) > 0) && (
        <div className="glass-card p-4 border-l-4 border-amber-400">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <span className="font-semibold text-amber-400">Action Required</span>
          </div>
          <div className="space-y-1 text-sm text-[var(--text-secondary)]">
            {(metrics.pendingResponses as number) > 0 && (
              <p>
                <button onClick={() => onNavigate('responses')} className="text-[var(--text-accent)] hover:underline">
                  {metrics.pendingResponses as number} response{(metrics.pendingResponses as number) !== 1 ? 's' : ''} awaiting review
                </button>
              </p>
            )}
            {(metrics.pendingAds as number) > 0 && (
              <p>
                <button onClick={() => onNavigate('ads')} className="text-[var(--text-accent)] hover:underline">
                  {metrics.pendingAds as number} ad recommendation{(metrics.pendingAds as number) !== 1 ? 's' : ''} awaiting approval
                </button>
              </p>
            )}
          </div>
        </div>
      )}

      <div className="glass-card p-5">
        <h3 className="font-semibold text-[var(--text-primary)] mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {activity.length === 0 && <EmptyState message="No activity yet" />}
          {activity.map(item => (
            <div key={item.id} className="flex items-start gap-3 py-2 border-b border-[var(--border-secondary)] last:border-0">
              <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)] mt-2 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text-primary)] truncate">{item.action_detail || item.action_type}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {new Date(item.created_at).toLocaleString()} — {item.outcome || 'pending'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tab: Opportunities
// ============================================================================
function OpportunitiesTab() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('reddit_agent_opportunities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (filterType !== 'all') query = query.eq('opportunity_type', filterType);
    if (filterStatus !== 'all') query = query.eq('status', filterStatus);

    const { data } = await query;
    setOpportunities((data || []) as Opportunity[]);
    setLoading(false);
  }, [filterType, filterStatus]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="glass-input !w-auto text-sm"
        >
          <option value="all">All Types</option>
          <option value="direct_ask">Direct Ask</option>
          <option value="pain_point">Pain Point</option>
          <option value="competitor_mention">Competitor Mention</option>
          <option value="compliance_question">Compliance Question</option>
          <option value="industry_trend">Industry Trend</option>
          <option value="process_discussion">Process Discussion</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="glass-input !w-auto text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="new">New</option>
          <option value="response_drafted">Response Drafted</option>
          <option value="approved">Approved</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      {opportunities.length === 0 && <EmptyState message="No opportunities found" />}

      {opportunities.map(opp => {
        const isExpanded = expandedId === opp.id;
        const isExpiring = new Date(opp.expires_at).getTime() - Date.now() < 24 * 60 * 60 * 1000;

        return (
          <div key={opp.id} className="glass-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs text-[var(--text-secondary)]">r/{opp.subreddit}</span>
                  <TypeBadge type={opp.opportunity_type} />
                  <StatusBadge status={opp.status} />
                  {isExpiring && opp.status !== 'skipped' && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Expiring soon
                    </span>
                  )}
                </div>
                <h4 className="font-medium text-[var(--text-primary)] text-sm">{opp.title}</h4>
                <div className="flex items-center gap-4 mt-2 text-xs text-[var(--text-secondary)]">
                  <span>L1: {opp.layer1_score}</span>
                  {opp.layer2_score != null && <span>L2: {opp.layer2_score}</span>}
                  {opp.combined_score != null && <span className="font-semibold text-[var(--accent-primary)]">Combined: {opp.combined_score}</span>}
                  {opp.author && <span>by u/{opp.author}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`https://reddit.com${opp.permalink}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--text-accent)] hover:text-[var(--accent-primary)]"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button onClick={() => setExpandedId(isExpanded ? null : opp.id)}>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="mt-4 pt-4 border-t border-[var(--border-secondary)] space-y-3"
              >
                {opp.intent_analysis && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-1">Intent Analysis</p>
                    <p className="text-sm text-[var(--text-primary)]">{opp.intent_analysis}</p>
                  </div>
                )}
                {opp.agent_investigation_summary && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-1">Investigation Summary</p>
                    <ExpandableText text={opp.agent_investigation_summary} maxLength={300} />
                  </div>
                )}
                {opp.agent_loop_tools_used && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-[var(--text-secondary)]">Tools used ({opp.agent_loop_iterations} iterations):</span>
                    {opp.agent_loop_tools_used.map(tool => (
                      <span key={tool} className="px-2 py-0.5 rounded bg-white/5 text-xs text-[var(--text-secondary)]">{tool}</span>
                    ))}
                  </div>
                )}
                {opp.skip_reason && (
                  <div>
                    <p className="text-xs font-semibold text-red-400 uppercase mb-1">Skip Reason</p>
                    <p className="text-sm text-[var(--text-secondary)]">{opp.skip_reason}</p>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Tab: Responses
// ============================================================================
function ResponsesTab() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reddit_agent_decision_queue')
        .select('*')
        .eq('action_type', 'draft_response')
        .order('created_at', { ascending: false })
        .limit(30);
      setDecisions((data || []) as Decision[]);
      setLoading(false);
    }
    load();
  }, []);

  const handleDecision = async (id: string, action: 'approve' | 'reject') => {
    try {
      await fetch('/api/reddit-agent/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionId: id, action }),
      });
      setDecisions(prev => prev.map(d => d.id === id ? { ...d, status: action === 'approve' ? 'approved' : 'rejected' } : d));
    } catch {
      // Silent failure — optimistic update
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) return <LoadingState />;
  if (decisions.length === 0) return <EmptyState message="No draft responses yet" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)] italic">
        Drafts do not mention Inecta. Add your own context if appropriate when posting.
      </p>

      {decisions.map(d => {
        const isExpiring = new Date(d.expires_at).getTime() - Date.now() < 24 * 60 * 60 * 1000;
        const postAge = d.created_at ? Math.round((Date.now() - new Date(d.created_at).getTime()) / 3600000) : 0;

        return (
          <div key={d.id} className="glass-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs text-[var(--text-secondary)]">r/{d.subreddit}</span>
                  {d.opportunity_type && <TypeBadge type={d.opportunity_type} />}
                  <StatusBadge status={d.status} />
                  {d.combined_score != null && (
                    <span className="text-xs text-[var(--accent-primary)] font-semibold">Score: {d.combined_score}</span>
                  )}
                  {isExpiring && d.status === 'pending' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Expiring
                    </span>
                  )}
                </div>
                <h4 className="font-medium text-[var(--text-primary)] text-sm">{d.post_title}</h4>
                {postAge > 24 && (
                  <p className="text-xs text-amber-400 mt-1">Post is {postAge}h old — response may appear late</p>
                )}
              </div>
              {d.post_permalink && (
                <a
                  href={`https://reddit.com${d.post_permalink}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1 shrink-0"
                >
                  <ExternalLink className="w-3 h-3" /> Open on Reddit
                </a>
              )}
            </div>

            {d.response_style && (
              <p className="text-xs text-[var(--text-secondary)]">Style: {d.response_style.replace(/_/g, ' ')}</p>
            )}

            {d.draft_response && (
              <div className="bg-white/5 rounded-lg p-4 relative">
                <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{d.draft_response}</p>
                <button
                  onClick={() => copyToClipboard(d.draft_response!, d.id)}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                  title="Copy response"
                >
                  {copiedId === d.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[var(--text-secondary)]" />}
                </button>
              </div>
            )}

            {d.promotional_score != null && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-secondary)]">Promotional score:</span>
                <span className={d.promotional_score > 0.3 ? 'text-red-400' : 'text-emerald-400'}>
                  {d.promotional_score.toFixed(2)}
                </span>
              </div>
            )}

            {d.action_detail && typeof (d.action_detail as Record<string, unknown>).investigation_summary === 'string' && (
              <div className="pt-2 border-t border-[var(--border-secondary)]">
                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-1">Investigation Summary</p>
                <ExpandableText text={(d.action_detail as Record<string, unknown>).investigation_summary as string} />
              </div>
            )}

            {d.status === 'pending' && (
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleDecision(d.id, 'approve')}
                  className="btn-primary !py-1.5 !px-4 text-sm"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDecision(d.id, 'reject')}
                  className="btn-secondary !py-1.5 !px-4 text-sm"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Tab: Trends
// ============================================================================
function TrendsTab() {
  const [snapshots, setSnapshots] = useState<Array<{
    snapshot_date: string;
    topic_frequencies: Record<string, number>;
    subreddit_activity: Record<string, number>;
    competitor_mentions: Record<string, number>;
    emerging_topics: string[];
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reddit_agent_trend_snapshots')
        .select('*')
        .eq('period', 'daily')
        .order('snapshot_date', { ascending: false })
        .limit(7);
      setSnapshots(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingState />;
  if (snapshots.length === 0) return <EmptyState message="No trend data yet. Run a scan first." />;

  const latest = snapshots[0];
  const topTopics = Object.entries(latest.topic_frequencies || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const subActivity = Object.entries(latest.subreddit_activity || {}).sort((a, b) => b[1] - a[1]);
  const competitors = Object.entries(latest.competitor_mentions || {}).sort((a, b) => b[1] - a[1]);

  const topicChartData = topTopics.map(([name, count]) => ({ name, count }));
  const subChartData = subActivity.map(([name, posts]) => ({ name: `r/${name}`, posts }));

  return (
    <div className="space-y-6">
      {latest.emerging_topics?.length > 0 && (
        <div className="glass-card p-4 border-l-4 border-cyan-400">
          <p className="font-semibold text-cyan-400 text-sm mb-2">Emerging Topics</p>
          <div className="flex flex-wrap gap-2">
            {latest.emerging_topics.map(t => (
              <span key={t} className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 text-xs">{t}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="font-semibold text-[var(--text-primary)] mb-4">Top Keywords ({latest.snapshot_date})</h3>
          {topicChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topicChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis type="number" stroke="var(--text-secondary)" />
                <YAxis type="category" dataKey="name" width={150} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--background-secondary)', border: '1px solid var(--border-primary)', borderRadius: '8px' }} />
                <Bar dataKey="count" fill="var(--accent-primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No keyword data" />
          )}
        </div>

        <div className="glass-card p-5">
          <h3 className="font-semibold text-[var(--text-primary)] mb-4">Subreddit Activity</h3>
          {subChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={subChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis type="number" stroke="var(--text-secondary)" />
                <YAxis type="category" dataKey="name" width={120} stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--background-secondary)', border: '1px solid var(--border-primary)', borderRadius: '8px' }} />
                <Bar dataKey="posts" fill="#34D399" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No subreddit data" />
          )}
        </div>
      </div>

      {competitors.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="font-semibold text-[var(--text-primary)] mb-4">Competitor Mentions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {competitors.map(([name, count]) => (
              <div key={name} className="bg-white/5 rounded-lg p-3 text-center">
                <p className="text-sm font-medium text-[var(--text-primary)]">{name}</p>
                <p className="text-2xl font-bold text-red-400 mt-1">{count}</p>
                <p className="text-xs text-[var(--text-secondary)]">mentions</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tab: Ads
// ============================================================================
function AdsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adDecisions, setAdDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: campData }, { data: decData }] = await Promise.all([
      supabase.from('reddit_agent_ad_campaigns').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('reddit_agent_decision_queue').select('*').eq('action_type', 'ad_recommendation').eq('status', 'pending').order('created_at', { ascending: false }),
    ]);
    setCampaigns((campData || []) as Campaign[]);
    setAdDecisions((decData || []) as Decision[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdDecision = async (id: string, action: 'approve' | 'reject') => {
    await fetch('/api/reddit-agent/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionId: id, action }),
    });
    load();
  };

  const handlePauseResume = async (campaignId: string, action: 'pause' | 'resume') => {
    await fetch(`/api/reddit-agent/ads/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId }),
    });
    load();
  };

  if (loading) return <LoadingState />;

  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const totalDailySpend = activeCampaigns.reduce((s, c) => s + (c.daily_budget || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Active Campaigns" value={activeCampaigns.length} icon={Megaphone} color="green" />
        <MetricCard label="Total Daily Spend" value={`$${totalDailySpend}`} icon={BarChart3} />
        <MetricCard label="Pending Approvals" value={adDecisions.length} icon={Clock} color="amber" />
        <MetricCard label="All Campaigns" value={campaigns.length} icon={Target} color="blue" />
      </div>

      {adDecisions.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-amber-400">Pending Ad Recommendations</h3>
          {adDecisions.map(d => {
            const detail = (d.action_detail || {}) as Record<string, string | number | string[] | undefined>;
            const budget = detail.daily_budget ?? 5;
            const duration = detail.duration_days ?? 7;
            const signal = detail.source_signal_type ?? 'organic';
            const subs = Array.isArray(detail.targeting_subreddits) ? detail.targeting_subreddits.join(', ') : 'N/A';
            const headline = typeof detail.headline === 'string' ? detail.headline : null;
            return (
              <div key={d.id} className="glass-card p-4 border-l-4 border-amber-400">
                <p className="text-sm font-medium text-[var(--text-primary)] mb-2">{d.action_summary}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] mb-3">
                  <span>Budget: ${String(budget)}/day</span>
                  <span>Duration: {String(duration)} days</span>
                  <span>Signal: {String(signal)}</span>
                  <span>Subreddits: {subs}</span>
                </div>
                {headline && (
                  <p className="text-sm text-[var(--text-primary)] bg-white/5 p-2 rounded mb-3">
                    &ldquo;{headline}&rdquo;
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => handleAdDecision(d.id, 'approve')} className="btn-primary !py-1.5 !px-4 text-sm">Approve &amp; Create</button>
                  <button onClick={() => handleAdDecision(d.id, 'reject')} className="btn-secondary !py-1.5 !px-4 text-sm">Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)]">Campaigns</h3>
        {campaigns.length === 0 && <EmptyState message="No campaigns yet" />}
        {campaigns.map(c => (
          <div key={c.id} className="glass-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <StatusBadge status={c.status} />
                  <span className="text-xs text-[var(--text-secondary)]">{c.objective}</span>
                  {c.source_signal_type && (
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 text-xs">{c.source_signal_type}</span>
                  )}
                </div>
                <h4 className="font-medium text-[var(--text-primary)] text-sm">{c.campaign_name}</h4>
                <p className="text-xs text-[var(--text-secondary)] mt-1">&ldquo;{c.ad_headline}&rdquo;</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-[var(--text-secondary)]">
                  <span>${c.daily_budget}/day</span>
                  {c.targeting_subreddits?.length && <span>Targeting: {c.targeting_subreddits.join(', ')}</span>}
                  {c.start_date && <span>{c.start_date} — {c.end_date}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                {c.status === 'active' && (
                  <button onClick={() => handlePauseResume(c.id, 'pause')} className="p-2 rounded-md hover:bg-white/10" title="Pause">
                    <Pause className="w-4 h-4 text-amber-400" />
                  </button>
                )}
                {c.status === 'paused' && (
                  <button onClick={() => handlePauseResume(c.id, 'resume')} className="p-2 rounded-md hover:bg-white/10" title="Resume">
                    <Play className="w-4 h-4 text-emerald-400" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Tab: Digest
// ============================================================================
function DigestTab() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reddit_agent_daily_digest')
        .select('*')
        .order('digest_date', { ascending: false })
        .limit(7);
      setDigests((data || []) as Digest[]);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingState />;
  if (digests.length === 0) return <EmptyState message="No digests yet. Digest runs daily at 10 PM UTC." />;

  // Chart data for digest metrics over time
  const chartData = [...digests].reverse().map(d => ({
    date: d.digest_date,
    scanned: d.posts_scanned,
    opportunities: d.opportunities_found,
    drafted: d.responses_drafted,
    adRecs: d.ad_recommendations_generated,
  }));

  return (
    <div className="space-y-6">
      {chartData.length > 1 && (
        <div className="glass-card p-5">
          <h3 className="font-semibold text-[var(--text-primary)] mb-4">Activity Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis dataKey="date" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--text-secondary)" />
              <Tooltip contentStyle={{ background: 'var(--background-secondary)', border: '1px solid var(--border-primary)', borderRadius: '8px' }} />
              <Line type="monotone" dataKey="scanned" name="Posts Scanned" stroke="var(--accent-primary)" strokeWidth={2} />
              <Line type="monotone" dataKey="opportunities" name="Opportunities" stroke="#34D399" strokeWidth={2} />
              <Line type="monotone" dataKey="drafted" name="Drafted" stroke="#F59E0B" strokeWidth={2} />
              <Line type="monotone" dataKey="adRecs" name="Ad Recs" stroke="#A78BFA" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {digests.map(d => (
        <div key={d.id} className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-[var(--text-primary)]">{d.digest_date}</h3>
            <div className="flex gap-3 text-xs text-[var(--text-secondary)]">
              <span>{d.posts_scanned} scanned</span>
              <span>{d.opportunities_found} opps</span>
              <span>{d.responses_drafted} drafted</span>
              <span>{d.ad_recommendations_generated} ad recs</span>
            </div>
          </div>
          {d.summary_narrative && (
            <div className="bg-white/5 rounded-lg p-4">
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{d.summary_narrative}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Tab: Change Log
// ============================================================================
function ChangeLogTab() {
  const [logs, setLogs] = useState<ChangeLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('reddit_agent_change_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (typeFilter !== 'all') query = query.eq('action_type', typeFilter);

    const { data } = await query;
    setLogs((data || []) as ChangeLogItem[]);
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <select
        value={typeFilter}
        onChange={e => setTypeFilter(e.target.value)}
        className="glass-input !w-auto text-sm"
      >
        <option value="all">All Types</option>
        <option value="agent_investigation">Agent Investigation</option>
        <option value="draft_response_approved">Response Approved</option>
        <option value="draft_response_rejected">Response Rejected</option>
        <option value="ad_created">Ad Created</option>
        <option value="ad_paused">Ad Paused</option>
        <option value="ad_resumed">Ad Resumed</option>
        <option value="ad_auto_paused">Ad Auto-Paused</option>
      </select>

      {logs.length === 0 && <EmptyState message="No change log entries" />}

      {logs.map(log => {
        const isExpanded = expandedId === log.id;
        return (
          <div key={log.id} className="glass-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 rounded bg-white/10 text-xs font-mono text-[var(--text-secondary)]">
                    {log.action_type}
                  </span>
                  {log.outcome && <StatusBadge status={log.outcome} />}
                </div>
                <p className="text-sm text-[var(--text-primary)]">{log.action_detail || 'No details'}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {new Date(log.created_at).toLocaleString()}
                  {log.reason && ` — ${log.reason}`}
                </p>
              </div>
              {log.data_used && (
                <button onClick={() => setExpandedId(isExpanded ? null : log.id)}>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              )}
            </div>
            {isExpanded && log.data_used && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="mt-3 pt-3 border-t border-[var(--border-secondary)]"
              >
                <pre className="text-xs text-[var(--text-secondary)] bg-black/30 p-3 rounded overflow-auto max-h-60">
                  {JSON.stringify(log.data_used, null, 2)}
                </pre>
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Tab: Guardrails
// ============================================================================
function GuardrailsTab() {
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reddit_agent_guardrails')
        .select('*')
        .order('rule_category', { ascending: true });
      setGuardrails((data || []) as Guardrail[]);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingState />;

  const categories = [...new Set(guardrails.map(g => g.rule_category))];
  const categoryColors: Record<string, string> = {
    frequency: 'border-blue-400',
    content: 'border-cyan-400',
    freshness: 'border-green-400',
    quality: 'border-purple-400',
    safety: 'border-red-400',
    anti_drift: 'border-amber-400',
    ads: 'border-pink-400',
  };

  return (
    <div className="space-y-6">
      {categories.map(cat => {
        const rules = guardrails.filter(g => g.rule_category === cat);
        return (
          <div key={cat} className="space-y-3">
            <h3 className="font-semibold text-[var(--text-primary)] capitalize">{cat.replace(/_/g, ' ')}</h3>
            {rules.map(rule => (
              <div key={rule.id} className={`glass-card p-4 border-l-4 ${categoryColors[cat] || 'border-gray-400'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-[var(--text-accent)]">{rule.rule_name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        rule.violation_action === 'block' ? 'bg-red-500/20 text-red-400' :
                        rule.violation_action === 'warn' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {rule.violation_action}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">{rule.check_layer}</span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)]">{rule.description}</p>
                    {rule.threshold_value != null && (
                      <p className="text-xs text-[var(--accent-primary)] mt-1">Threshold: {rule.threshold_value}</p>
                    )}
                  </div>
                  <span className={`w-3 h-3 rounded-full ${rule.is_active ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Dashboard
// ============================================================================
export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [pendingCount, setPendingCount] = useState(0);

  // Load pending count for badge
  useEffect(() => {
    async function loadBadges() {
      const { count } = await supabase
        .from('reddit_agent_decision_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('action_type', 'draft_response');
      setPendingCount(count || 0);
    }
    loadBadges();
  }, [activeTab]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Cayenne</h1>
          <p className="text-sm text-[var(--text-secondary)]">Reddit Marketing Intelligence Agent</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-[var(--text-secondary)]">SALT Crew</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-[var(--border-primary)] mb-6">
        <nav className="-mb-px flex space-x-1 overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            let badge: number | null = null;
            if (tab.id === 'responses' && pendingCount > 0) badge = pendingCount;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap py-3 px-4 border-b-2 text-sm font-medium transition-all ${
                  isActive
                    ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {badge !== null && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'overview' && <OverviewTab onNavigate={setActiveTab} />}
          {activeTab === 'opportunities' && <OpportunitiesTab />}
          {activeTab === 'responses' && <ResponsesTab />}
          {activeTab === 'trends' && <TrendsTab />}
          {activeTab === 'ads' && <AdsTab />}
          {activeTab === 'digest' && <DigestTab />}
          {activeTab === 'changelog' && <ChangeLogTab />}
          {activeTab === 'guardrails' && <GuardrailsTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
