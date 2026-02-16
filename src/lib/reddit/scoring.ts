import type { RedditPost, Keyword, MonitoredSubreddit } from './types';

interface Layer1ScoreResult {
  score: number;
  breakdown: {
    keywordScore: number;
    subredditScore: number;
    freshnessScore: number;
    engagementScore: number;
    qualityScore: number;
  };
}

/**
 * Layer 1 deterministic scoring (0-100).
 *
 * | Dimension          | Max  | Logic |
 * |--------------------|------|-------|
 * | Keyword match      | 35   | High: 35, Competitor: 30, Medium: 20, Low: 10 |
 * | Subreddit tier     | 20   | Tier 1: 20, Tier 2: 12, Tier 3: 5 |
 * | Freshness          | 15   | <6h: 15, <12h: 12, <24h: 8, <48h: 4, >48h: 0 |
 * | Engagement potential| 15  | 0 comments: 15, 1-5: 12, 6-20: 8, >20: 3 |
 * | Post quality       | 15   | Has selftext >100 chars: 10, Is question: 5 |
 */
export function scoreLayer1(
  post: RedditPost,
  matchedKeywords: Keyword[],
  subreddit: MonitoredSubreddit
): Layer1ScoreResult {
  // 1. Keyword match score (0-35)
  let keywordScore = 0;
  if (matchedKeywords.length > 0) {
    // Use highest-weight keyword
    const weightScores: Record<string, number> = {
      high: 35,
      competitor: 30,
      medium: 20,
      low: 10,
    };
    const bestWeight = matchedKeywords[0].weight; // Already sorted by weight
    keywordScore = weightScores[bestWeight] || 10;
  }

  // 2. Subreddit tier score (0-20)
  const tierScores: Record<string, number> = { high: 20, medium: 12, low: 5 };
  const subredditScore = tierScores[subreddit.intent_tier] || 5;

  // 3. Freshness score (0-15)
  const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
  let freshnessScore = 0;
  if (ageHours < 6) freshnessScore = 15;
  else if (ageHours < 12) freshnessScore = 12;
  else if (ageHours < 24) freshnessScore = 8;
  else if (ageHours < 48) freshnessScore = 4;

  // 4. Engagement potential score (0-15)
  // Low comment count = first-mover advantage
  let engagementScore = 3;
  if (post.num_comments === 0) engagementScore = 15;
  else if (post.num_comments <= 5) engagementScore = 12;
  else if (post.num_comments <= 20) engagementScore = 8;

  // 5. Post quality score (0-15)
  let qualityScore = 0;
  if (post.selftext && post.selftext.length > 100) qualityScore += 10;
  if (isQuestion(post.title)) qualityScore += 5;

  const score = keywordScore + subredditScore + freshnessScore + engagementScore + qualityScore;

  return {
    score: Math.min(100, score),
    breakdown: {
      keywordScore,
      subredditScore,
      freshnessScore,
      engagementScore,
      qualityScore,
    },
  };
}

/**
 * Check if a title looks like a question.
 */
function isQuestion(title: string): boolean {
  const lower = title.toLowerCase().trim();
  if (lower.endsWith('?')) return true;
  const questionStarters = [
    'what ', 'how ', 'why ', 'which ', 'where ', 'when ', 'who ',
    'does ', 'do ', 'is ', 'are ', 'can ', 'should ', 'would ',
    'has anyone', 'anyone ', 'looking for', 'need help', 'recommendations',
    'suggestions', 'advice',
  ];
  return questionStarters.some(s => lower.startsWith(s));
}

/**
 * Compute the combined score from L1 and L2 scores.
 * Formula: (L1 * 0.3) + (L2 * 0.7)
 */
export function combinedScore(layer1Score: number, layer2Score: number): number {
  return Math.round((layer1Score * 0.3) + (layer2Score * 0.7));
}
