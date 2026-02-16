import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAdsAccountId } from '@/lib/reddit/ads-queries';
import { pauseCampaign } from '@/lib/reddit/ads-mutations';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { campaignId } = await request.json() as { campaignId: string };

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    // Get the campaign
    const { data: campaign } = await supabase
      .from('reddit_agent_ad_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (!campaign.reddit_campaign_id) {
      return NextResponse.json({ error: 'Campaign has no Reddit ID — not yet created' }, { status: 400 });
    }

    if (campaign.status !== 'active') {
      return NextResponse.json({ error: `Campaign is ${campaign.status}, not active` }, { status: 400 });
    }

    // Pause on Reddit
    const accountId = await getAdsAccountId();
    await pauseCampaign(accountId, campaign.reddit_campaign_id);

    // Update local status
    await supabase
      .from('reddit_agent_ad_campaigns')
      .update({
        status: 'paused',
        paused_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    // Log
    await supabase.from('reddit_agent_change_log').insert({
      action_type: 'ad_paused',
      action_detail: `Paused campaign "${campaign.campaign_name}"`,
      data_used: { campaignId, redditCampaignId: campaign.reddit_campaign_id },
      reason: 'Manual pause',
      outcome: 'executed',
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
