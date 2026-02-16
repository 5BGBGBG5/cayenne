import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Key metrics
    const [
      { count: totalScannedToday },
      { count: totalScannedWeek },
      { count: opportunitiesToday },
      { count: pendingResponses },
      { count: activeCampaigns },
    ] = await Promise.all([
      supabase.from('reddit_agent_scanned_posts').select('id', { count: 'exact', head: true }).gte('scanned_at', today.toISOString()),
      supabase.from('reddit_agent_scanned_posts').select('id', { count: 'exact', head: true }).gte('scanned_at', weekAgo),
      supabase.from('reddit_agent_opportunities').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
      supabase.from('reddit_agent_decision_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('action_type', 'draft_response'),
      supabase.from('reddit_agent_ad_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ]);

    // Total ad spend (active campaigns)
    const { data: activeAds } = await supabase
      .from('reddit_agent_ad_campaigns')
      .select('daily_budget')
      .eq('status', 'active');
    const totalDailySpend = (activeAds || []).reduce((sum, c) => sum + (c.daily_budget || 0), 0);

    // Recent activity
    const { data: recentActivity } = await supabase
      .from('reddit_agent_change_log')
      .select('action_type, action_detail, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    // Pipeline: opportunity statuses
    const { data: pipeline } = await supabase
      .from('reddit_agent_opportunities')
      .select('status')
      .gte('created_at', weekAgo);

    const pipelineCounts: Record<string, number> = {};
    for (const opp of pipeline || []) {
      pipelineCounts[opp.status] = (pipelineCounts[opp.status] || 0) + 1;
    }

    return NextResponse.json({
      metrics: {
        postsScannedToday: totalScannedToday || 0,
        postsScannedWeek: totalScannedWeek || 0,
        opportunitiesToday: opportunitiesToday || 0,
        pendingResponses: pendingResponses || 0,
        activeCampaigns: activeCampaigns || 0,
        totalDailyAdSpend: totalDailySpend,
      },
      recentActivity: recentActivity || [],
      pipeline: pipelineCounts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
