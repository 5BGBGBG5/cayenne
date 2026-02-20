export type ChangeType = 'feature' | 'fix' | 'improvement';

export interface ChangelogEntry {
  date: string;
  type: ChangeType;
  title: string;
  description: string;
}

// Newest first. To add an entry, prepend to this array.
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-02-20',
    type: 'improvement',
    title: 'Deactivate r/SaaS and refine subreddit tiers',
    description:
      'Removed r/SaaS from monitored subreddits (too broad, caused off-topic opportunities). Downgraded r/smallbusiness and r/accounting to low tier for better signal-to-noise.',
  },
  {
    date: '2026-02-20',
    type: 'feature',
    title: 'SALT Crew link in dashboard header',
    description:
      'The SALT Crew badge in the top-right corner now links back to the SALT hub at inecta-salt.com.',
  },
  {
    date: '2026-02-16',
    type: 'fix',
    title: 'Graceful ad approval when Reddit Ads API is unavailable',
    description:
      'Approving an ad recommendation no longer fails if the Reddit Ads API is unreachable. Campaigns are saved locally as "approved" with a clear message. Decision queue reverts to pending on unexpected errors so you can retry.',
  },
  {
    date: '2026-02-16',
    type: 'fix',
    title: 'Responses tab badge only counts draft responses',
    description:
      'The badge on the Responses tab was incorrectly counting ad recommendations as pending responses. Now it only counts draft_response items.',
  },
  {
    date: '2026-02-16',
    type: 'feature',
    title: 'Pain point cluster detection',
    description:
      'The digest now detects when the same keyword appears in 3+ posts within 7 days and emits a reddit_pain_point_cluster signal to the SALT signal bus.',
  },
  {
    date: '2026-02-16',
    type: 'feature',
    title: 'Initial launch',
    description:
      'Cayenne deployed with two-layer Reddit scanning (deterministic + Claude agent loop), trend analysis, ad recommendations, daily digest, and a full dashboard with 8 tabs.',
  },
];
