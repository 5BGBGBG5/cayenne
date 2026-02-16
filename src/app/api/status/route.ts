import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Last scan timestamp
    const { data: lastScan } = await supabase
      .from('reddit_agent_scanned_posts')
      .select('scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(1)
      .single();

    // Active pending proposals
    const { count: activeProposals } = await supabase
      .from('reddit_agent_decision_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Last action from change log
    const { data: lastAction } = await supabase
      .from('reddit_agent_change_log')
      .select('action_type, action_detail, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Active ad campaigns
    const { count: activeCampaigns } = await supabase
      .from('reddit_agent_ad_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');

    return NextResponse.json({
      agent: 'cayenne',
      lastRun: lastScan?.scanned_at || null,
      lastAction: lastAction || null,
      activeProposals: activeProposals || 0,
      activeCampaigns: activeCampaigns || 0,
      status: 'operational',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { agent: 'cayenne', status: 'error', error: message },
      { status: 500 }
    );
  }
}
