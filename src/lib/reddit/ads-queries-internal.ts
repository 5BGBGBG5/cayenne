import { supabase } from '../supabase';
import { emitSignal } from '../signals';
import { getAdsAccountId, getCampaignReport } from './ads-queries';
import { pauseCampaign } from './ads-mutations';
import { loadGuardrails } from './validation';

/**
 * Sync performance data from Reddit Ads API for all active campaigns.
 * Called during the main cron run.
 */
export async function syncAdsPerformance(): Promise<{
  synced: number;
  autoPaused: number;
}> {
  let synced = 0;
  let autoPaused = 0;

  // Get active campaigns with Reddit campaign IDs
  const { data: campaigns } = await supabase
    .from('reddit_agent_ad_campaigns')
    .select('*')
    .eq('status', 'active')
    .not('reddit_campaign_id', 'is', null);

  if (!campaigns?.length) {
    return { synced: 0, autoPaused: 0 };
  }

  const accountId = await getAdsAccountId();
  const guardrails = await loadGuardrails();
  const cpcThresholdRule = guardrails.find(g => g.rule_name === 'ads_auto_pause_cpc_threshold');
  const cpcThreshold = cpcThresholdRule?.threshold_value || 3.0;

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  for (const campaign of campaigns) {
    try {
      const reports = await getCampaignReport(
        accountId,
        campaign.reddit_campaign_id,
        yesterday,
        today
      );

      for (const report of reports) {
        // Convert cents to dollars
        const cpc = report.cpc_cents / 100;
        const cpm = report.cpm_cents / 100;
        const spend = report.spend_cents / 100;
        const conversionValue = report.conversion_value_cents / 100;
        const roas = spend > 0 ? conversionValue / spend : 0;

        // Store performance data
        await supabase.from('reddit_agent_ad_performance').insert({
          campaign_id: campaign.id,
          reddit_campaign_id: campaign.reddit_campaign_id,
          report_date: report.date,
          impressions: report.impressions,
          clicks: report.clicks,
          ctr: report.ctr,
          cpc,
          cpm,
          spend,
          conversions: report.conversions,
          conversion_value: conversionValue,
          roas,
        });

        synced++;

        // Emit performance signal
        await emitSignal('reddit_ad_performance', {
          campaignId: campaign.id,
          spend,
          clicks: report.clicks,
          ctr: report.ctr,
          cpc,
          roas,
        });

        // Auto-pause if CPC exceeds threshold
        if (cpc > cpcThreshold && report.clicks > 0) {
          try {
            await pauseCampaign(accountId, campaign.reddit_campaign_id);
            await supabase
              .from('reddit_agent_ad_campaigns')
              .update({ status: 'paused', paused_at: new Date().toISOString() })
              .eq('id', campaign.id);

            await supabase.from('reddit_agent_change_log').insert({
              action_type: 'ad_auto_paused',
              action_detail: `Auto-paused campaign "${campaign.campaign_name}" — CPC $${cpc} exceeds $${cpcThreshold} threshold`,
              data_used: { campaignId: campaign.id, cpc, threshold: cpcThreshold },
              reason: `CPC $${cpc} exceeds auto-pause threshold $${cpcThreshold}`,
              outcome: 'executed',
            });

            await emitSignal('reddit_ad_auto_paused', {
              campaignId: campaign.id,
              cpc,
              threshold: cpcThreshold,
            });

            autoPaused++;
          } catch {
            // Log but don't fail the whole sync
            console.error(`Failed to auto-pause campaign ${campaign.id}`);
          }
        }
      }

      // Update correlation data if campaign has a source signal
      if (campaign.source_signal_type) {
        await updateCorrelation(campaign.id, campaign.source_signal_type, campaign.source_signal_detail);
      }
    } catch (err) {
      console.error(`Failed to sync performance for campaign ${campaign.id}:`, err);
    }
  }

  return { synced, autoPaused };
}

/**
 * Update the signal correlation table for a campaign.
 */
async function updateCorrelation(
  campaignId: string,
  signalType: string,
  signalDetail: Record<string, unknown> | null
): Promise<void> {
  // Aggregate all performance data for this campaign
  const { data: perfData } = await supabase
    .from('reddit_agent_ad_performance')
    .select('spend, impressions, clicks, conversions, roas')
    .eq('campaign_id', campaignId);

  if (!perfData?.length) return;

  const totals = perfData.reduce(
    (acc, row) => ({
      spend: acc.spend + (row.spend || 0),
      impressions: acc.impressions + (row.impressions || 0),
      clicks: acc.clicks + (row.clicks || 0),
      conversions: acc.conversions + (row.conversions || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
  );

  const totalRoas = totals.spend > 0 ? totals.conversions / totals.spend : 0;
  const rating = totalRoas >= 2 ? 'high' : totalRoas >= 1 ? 'medium' : 'low';

  // Upsert correlation
  const { data: existing } = await supabase
    .from('reddit_agent_ad_signal_correlation')
    .select('id')
    .eq('campaign_id', campaignId)
    .limit(1);

  if (existing?.length) {
    await supabase
      .from('reddit_agent_ad_signal_correlation')
      .update({
        total_spend: totals.spend,
        total_impressions: totals.impressions,
        total_clicks: totals.clicks,
        total_conversions: totals.conversions,
        total_roas: totalRoas,
        performance_rating: rating,
        updated_at: new Date().toISOString(),
      })
      .eq('campaign_id', campaignId);
  } else {
    await supabase.from('reddit_agent_ad_signal_correlation').insert({
      campaign_id: campaignId,
      source_signal_type: signalType,
      source_signal_detail: signalDetail,
      total_spend: totals.spend,
      total_impressions: totals.impressions,
      total_clicks: totals.clicks,
      total_conversions: totals.conversions,
      total_roas: totalRoas,
      performance_rating: rating,
    });
  }
}
