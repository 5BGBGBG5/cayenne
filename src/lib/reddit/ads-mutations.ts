import { adsPost, adsPatch } from './client';
import type { RedditAdCampaign, AdCTA } from './types';

interface CreateCampaignInput {
  accountId: string;
  name: string;
  objective: 'TRAFFIC' | 'CONVERSIONS' | 'AWARENESS';
  dailyBudgetCents: number;
  startTime: string;       // ISO 8601
  endTime: string | null;
}

interface CreateAdGroupInput {
  accountId: string;
  campaignId: string;
  name: string;
  bidCents: number;
  targetingSubreddits?: string[];
  targetingKeywords?: string[];
}

interface CreateAdInput {
  accountId: string;
  adGroupId: string;
  headline: string;
  body: string;
  cta: AdCTA;
  url: string;
}

/**
 * Create a new campaign in Reddit Ads.
 * Returns the Reddit-assigned campaign ID.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<RedditAdCampaign> {
  const body: Record<string, unknown> = {
    name: input.name,
    objective: input.objective,
    budget_type: 'daily',
    budget_cents: input.dailyBudgetCents,
    start_time: input.startTime,
    status: 'ACTIVE',
  };
  if (input.endTime) {
    body.end_time = input.endTime;
  }

  const data = await adsPost<{ data: RedditAdCampaign }>(
    `/accounts/${input.accountId}/campaigns`,
    body
  );
  return data.data;
}

/**
 * Create an ad group within a campaign.
 * Ad groups define targeting (subreddits, keywords) and bidding.
 */
export async function createAdGroup(input: CreateAdGroupInput): Promise<{ id: string }> {
  const targeting: Record<string, unknown> = {};
  if (input.targetingSubreddits?.length) {
    targeting.subreddits = input.targetingSubreddits;
  }
  if (input.targetingKeywords?.length) {
    targeting.keywords = input.targetingKeywords;
  }

  const data = await adsPost<{ data: { id: string } }>(
    `/accounts/${input.accountId}/campaigns/${input.campaignId}/adgroups`,
    {
      name: input.name,
      bid_strategy: 'CPC',
      bid_cents: input.bidCents,
      targeting,
      status: 'ACTIVE',
    }
  );
  return data.data;
}

/**
 * Create an ad (creative) within an ad group.
 */
export async function createAd(input: CreateAdInput): Promise<{ id: string }> {
  const data = await adsPost<{ data: { id: string } }>(
    `/accounts/${input.accountId}/adgroups/${input.adGroupId}/ads`,
    {
      headline: input.headline,
      body: input.body,
      cta: input.cta,
      url: input.url,
      status: 'ACTIVE',
    }
  );
  return data.data;
}

/**
 * Pause a campaign.
 */
export async function pauseCampaign(accountId: string, campaignId: string): Promise<void> {
  await adsPatch(`/accounts/${accountId}/campaigns/${campaignId}`, {
    status: 'PAUSED',
  });
}

/**
 * Resume a paused campaign.
 */
export async function resumeCampaign(accountId: string, campaignId: string): Promise<void> {
  await adsPatch(`/accounts/${accountId}/campaigns/${campaignId}`, {
    status: 'ACTIVE',
  });
}
