import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAdsAccountId } from '@/lib/reddit/ads-queries';
import { resumeCampaign } from '@/lib/reddit/ads-mutations';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { campaignId } = await request.json() as { campaignId: string };

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    const { data: campaign } = await supabase
      .from('reddit_agent_ad_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (!campaign.reddit_campaign_id) {
      return NextResponse.json({ error: 'Campaign has no Reddit ID' }, { status: 400 });
    }

    if (campaign.status !== 'paused') {
      return NextResponse.json({ error: `Campaign is ${campaign.status}, not paused` }, { status: 400 });
    }

    const accountId = await getAdsAccountId();
    await resumeCampaign(accountId, campaign.reddit_campaign_id);

    await supabase
      .from('reddit_agent_ad_campaigns')
      .update({
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    await supabase.from('reddit_agent_change_log').insert({
      action_type: 'ad_resumed',
      action_detail: `Resumed campaign "${campaign.campaign_name}"`,
      data_used: { campaignId, redditCampaignId: campaign.reddit_campaign_id },
      reason: 'Manual resume',
      outcome: 'executed',
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
