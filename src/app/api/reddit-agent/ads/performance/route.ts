import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { syncAdsPerformance } from '@/lib/reddit/ads-queries-internal';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET: Return stored performance data for all campaigns.
 * POST: Pull fresh metrics from Reddit Ads API.
 */
export async function GET() {
  try {
    const { data: campaigns } = await supabase
      .from('reddit_agent_ad_campaigns')
      .select('*')
      .in('status', ['active', 'paused', 'completed'])
      .order('created_at', { ascending: false });

    const campaignIds = (campaigns || []).map(c => c.id);

    const { data: performance } = await supabase
      .from('reddit_agent_ad_performance')
      .select('*')
      .in('campaign_id', campaignIds.length ? campaignIds : ['none'])
      .order('report_date', { ascending: false });

    // Aggregate by campaign
    const byCapaign: Record<string, { campaign: unknown; performance: unknown[]; totals: Record<string, number> }> = {};
    for (const c of campaigns || []) {
      const perfRows = (performance || []).filter(p => p.campaign_id === c.id);
      const totals = perfRows.reduce(
        (acc, p) => ({
          impressions: acc.impressions + (p.impressions || 0),
          clicks: acc.clicks + (p.clicks || 0),
          spend: acc.spend + (p.spend || 0),
          conversions: acc.conversions + (p.conversions || 0),
        }),
        { impressions: 0, clicks: 0, spend: 0, conversions: 0 }
      );

      byCapaign[c.id] = {
        campaign: c,
        performance: perfRows,
        totals: {
          ...totals,
          ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
          cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
          roas: totals.spend > 0 ? totals.conversions / totals.spend : 0,
        },
      };
    }

    return NextResponse.json({ campaigns: byCapaign });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await syncAdsPerformance();
    return NextResponse.json({
      success: true,
      synced: result.synced,
      autoPaused: result.autoPaused,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
