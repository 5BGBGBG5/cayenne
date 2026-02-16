import { supabase } from '../supabase';
import { emitSignal } from '../signals';

/**
 * Compute trend analysis from scanned posts and opportunities.
 * Called during the digest cron.
 */
export async function computeTrends(period: 'daily' | 'weekly' = 'daily'): Promise<{
  topicFrequencies: Record<string, number>;
  subredditActivity: Record<string, number>;
  competitorMentions: Record<string, number>;
  emergingTopics: string[];
}> {
  const lookback = period === 'daily' ? 1 : 7;
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000).toISOString();

  // Topic frequencies from keywords matched
  const { data: recentPosts } = await supabase
    .from('reddit_agent_scanned_posts')
    .select('subreddit, layer1_keywords_matched, title')
    .gte('scanned_at', since);

  const topicFrequencies: Record<string, number> = {};
  const subredditActivity: Record<string, number> = {};

  for (const post of recentPosts || []) {
    // Count subreddit activity
    subredditActivity[post.subreddit] = (subredditActivity[post.subreddit] || 0) + 1;

    // Count keyword frequencies
    for (const kw of post.layer1_keywords_matched || []) {
      topicFrequencies[kw] = (topicFrequencies[kw] || 0) + 1;
    }
  }

  // Competitor mentions
  const competitors = ['NetSuite', 'SAP', 'Fishbowl', 'Aptean', 'Plex', 'BatchMaster', 'DEACOM', 'Sage', 'Dynamics'];
  const competitorMentions: Record<string, number> = {};

  for (const comp of competitors) {
    const { count } = await supabase
      .from('reddit_agent_scanned_posts')
      .select('id', { count: 'exact', head: true })
      .or(`title.ilike.%${comp}%,selftext.ilike.%${comp}%`)
      .gte('scanned_at', since);

    if (count && count > 0) {
      competitorMentions[comp] = count;
    }
  }

  // Detect emerging topics — compare current period to baseline
  const baselineSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: baselinePosts } = await supabase
    .from('reddit_agent_scanned_posts')
    .select('layer1_keywords_matched')
    .gte('scanned_at', baselineSince);

  const baselineFreqs: Record<string, number> = {};
  for (const post of baselinePosts || []) {
    for (const kw of post.layer1_keywords_matched || []) {
      baselineFreqs[kw] = (baselineFreqs[kw] || 0) + 1;
    }
  }

  // Normalize baseline to per-day
  const baselineDays = 30;
  const emergingTopics: string[] = [];

  for (const [topic, count] of Object.entries(topicFrequencies)) {
    const baselinePerDay = (baselineFreqs[topic] || 0) / baselineDays;
    const currentPerDay = count / lookback;

    // Emerging if 2x baseline or new topic not seen before
    if (baselinePerDay === 0 && currentPerDay > 0) {
      emergingTopics.push(topic);
    } else if (baselinePerDay > 0 && currentPerDay > baselinePerDay * 2) {
      emergingTopics.push(topic);
    }
  }

  // Emit signals for notable trends
  for (const [comp, count] of Object.entries(competitorMentions)) {
    if (count >= 3) {
      await emitSignal('reddit_competitor_mention', {
        competitor: comp,
        mentionCount: count,
        subreddits: Object.keys(subredditActivity),
      });
    }
  }

  for (const topic of emergingTopics) {
    await emitSignal('reddit_trending_topic', {
      topic,
      frequency: topicFrequencies[topic],
      baseline: (baselineFreqs[topic] || 0) / baselineDays,
      subreddits: Object.keys(subredditActivity),
    });
  }

  // Store snapshot
  const today = new Date().toISOString().split('T')[0];
  await supabase.from('reddit_agent_trend_snapshots').insert({
    snapshot_date: today,
    period,
    topic_frequencies: topicFrequencies,
    subreddit_activity: subredditActivity,
    competitor_mentions: competitorMentions,
    emerging_topics: emergingTopics,
  });

  return { topicFrequencies, subredditActivity, competitorMentions, emergingTopics };
}
