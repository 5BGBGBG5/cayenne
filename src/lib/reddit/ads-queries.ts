import { adsGet } from './client';
import type { RedditAdCampaign, RedditAdReport } from './types';

/**
 * Get the Reddit Ads account ID.
 * We need this for all campaign operations.
 */
export async function getAdsAccountId(): Promise<string> {
  const data = await adsGet<{ data: Array<{ id: string }> }>('/me/accounts');
  if (!data.data?.length) {
    throw new Error('No Reddit Ads accounts found for this user');
  }
  return data.data[0].id;
}

/**
 * List all campaigns for the account.
 */
export async function listCampaigns(accountId: string): Promise<RedditAdCampaign[]> {
  const data = await adsGet<{ data: RedditAdCampaign[] }>(
    `/accounts/${accountId}/campaigns`
  );
  return data.data || [];
}

/**
 * Get a single campaign by ID.
 */
export async function getCampaign(
  accountId: string,
  campaignId: string
): Promise<RedditAdCampaign> {
  const data = await adsGet<{ data: RedditAdCampaign }>(
    `/accounts/${accountId}/campaigns/${campaignId}`
  );
  return data.data;
}

/**
 * Get performance report for a campaign.
 * Returns daily performance metrics for the specified date range.
 */
export async function getCampaignReport(
  accountId: string,
  campaignId: string,
  startDate: string,
  endDate: string
): Promise<RedditAdReport[]> {
  const data = await adsGet<{ data: RedditAdReport[] }>(
    `/accounts/${accountId}/campaigns/${campaignId}/report`,
    {
      starts_at: startDate,
      ends_at: endDate,
      group_by: 'date',
    }
  );
  return data.data || [];
}

/**
 * Get account-level performance summary.
 */
export async function getAccountReport(
  accountId: string,
  startDate: string,
  endDate: string
): Promise<RedditAdReport[]> {
  const data = await adsGet<{ data: RedditAdReport[] }>(
    `/accounts/${accountId}/report`,
    {
      starts_at: startDate,
      ends_at: endDate,
      group_by: 'date',
    }
  );
  return data.data || [];
}
