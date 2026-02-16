import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { emitSignal } from '@/lib/signals';
import { getAccessToken } from '@/lib/reddit/auth';
import { getSubredditNew } from '@/lib/reddit/queries';
import { loadKeywords, matchKeywords } from '@/lib/reddit/keywords';
import { scoreLayer1 } from '@/lib/reddit/scoring';
import { runLayer2Analysis } from '@/lib/reddit/analysis';
import { syncAdsPerformance } from '@/lib/reddit/ads-queries-internal';
import type { MonitoredSubreddit, Layer1Candidate, RedditPost } from '@/lib/reddit/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const L1_THRESHOLD = 40;

/**
 * Cron 1: Main scan + Layer 2 agent loop + ads performance sync
 * Schedule: 0 14 * * * (2 PM UTC / 10 AM ET)
 */
export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}

async function handleRun(request: NextRequest) {
  // Auth check for cron
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('Authorization');
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const isManual = body.manual === true;

    if (!isManual && auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const stats = {
    postsScanned: 0,
    candidatesFound: 0,
    layer2Processed: 0,
    opportunitiesCreated: 0,
    responseDrafted: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    // ---- Phase 1: Refresh token + load config ----
    await getAccessToken();

    const { data: subreddits } = await supabase
      .from('reddit_agent_monitored_subreddits')
      .select('*')
      .eq('is_active', true)
      .order('scan_priority', { ascending: false });

    if (!subreddits?.length) {
      return NextResponse.json({ error: 'No active subreddits configured' }, { status: 500 });
    }

    const keywords = await loadKeywords();

    // ---- Phase 2: Layer 1 scan ----
    const candidates: Layer1Candidate[] = [];

    for (const sub of subreddits as MonitoredSubreddit[]) {
      try {
        const { posts, after } = await getSubredditNew(sub.subreddit, {
          limit: 25,
          after: sub.last_post_fullname || undefined,
        });

        for (const post of posts) {
          stats.postsScanned++;

          // Skip NSFW, deleted, or very old posts
          if (post.over_18) continue;
          if (post.author === '[deleted]') continue;

          const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
          if (ageHours > 48) continue;

          // Deduplicate — check if already scanned
          const { data: existing } = await supabase
            .from('reddit_agent_scanned_posts')
            .select('id')
            .eq('reddit_post_id', post.name)
            .limit(1);

          if (existing && existing.length > 0) continue;

          // Keyword matching
          const searchText = `${post.title} ${post.selftext || ''}`;
          const { matched } = matchKeywords(searchText, keywords);

          // Score
          const { score } = scoreLayer1(post, matched, sub);

          // Store scanned post
          const { data: scannedPost } = await supabase
            .from('reddit_agent_scanned_posts')
            .insert({
              reddit_post_id: post.name,
              subreddit: sub.subreddit,
              title: post.title,
              selftext: post.selftext || null,
              author: post.author,
              post_score: post.score,
              num_comments: post.num_comments,
              created_utc: new Date(post.created_utc * 1000).toISOString(),
              permalink: post.permalink,
              url: post.url,
              flair: post.link_flair_text,
              layer1_score: score,
              layer1_keywords_matched: matched.map(k => k.keyword),
            })
            .select('id')
            .single();

          if (score >= L1_THRESHOLD && scannedPost) {
            candidates.push({
              scanned_post_id: scannedPost.id,
              reddit_post_id: post.name,
              subreddit: sub.subreddit,
              title: post.title,
              selftext: post.selftext || null,
              author: post.author,
              post_score: post.score,
              num_comments: post.num_comments,
              created_utc: new Date(post.created_utc * 1000).toISOString(),
              permalink: post.permalink,
              flair: post.link_flair_text,
              layer1_score: score,
              layer1_keywords_matched: matched.map(k => k.keyword),
              intent_tier: sub.intent_tier,
            });
          }
        }

        // Update cursor for this subreddit
        if (after || posts.length > 0) {
          await supabase
            .from('reddit_agent_monitored_subreddits')
            .update({
              last_scanned_at: new Date().toISOString(),
              last_post_fullname: after || (posts.length > 0 ? posts[0].name : sub.last_post_fullname),
            })
            .eq('id', sub.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        stats.errors.push(`r/${sub.subreddit}: ${msg}`);
      }
    }

    // Also pick up any previously scanned but unanalyzed posts
    const { data: carryOver } = await supabase
      .from('reddit_agent_scanned_posts')
      .select('*')
      .eq('layer2_analyzed', false)
      .gte('layer1_score', L1_THRESHOLD)
      .gte('scanned_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('layer1_score', { ascending: false })
      .limit(5);

    if (carryOver) {
      for (const post of carryOver) {
        // Don't duplicate candidates already in this run
        if (candidates.some(c => c.reddit_post_id === post.reddit_post_id)) continue;

        // Look up the subreddit for intent_tier
        const { data: subData } = await supabase
          .from('reddit_agent_monitored_subreddits')
          .select('intent_tier')
          .eq('subreddit', post.subreddit)
          .single();

        candidates.push({
          scanned_post_id: post.id,
          reddit_post_id: post.reddit_post_id,
          subreddit: post.subreddit,
          title: post.title,
          selftext: post.selftext,
          author: post.author,
          post_score: post.post_score,
          num_comments: post.num_comments,
          created_utc: post.created_utc,
          permalink: post.permalink,
          flair: post.flair,
          layer1_score: post.layer1_score || 0,
          layer1_keywords_matched: post.layer1_keywords_matched || [],
          intent_tier: (subData?.intent_tier as 'high' | 'medium' | 'low') || 'low',
        });
      }
    }

    // Sort by L1 score descending
    candidates.sort((a, b) => b.layer1_score - a.layer1_score);
    stats.candidatesFound = candidates.length;

    // ---- Phase 3: Layer 2 agent loop ----
    if (candidates.length > 0) {
      const l2Result = await runLayer2Analysis(candidates);
      stats.layer2Processed = l2Result.processed;
      stats.opportunitiesCreated = l2Result.opportunities.length;
      stats.responseDrafted = l2Result.opportunities.filter(o => o.status === 'response_drafted').length;
      stats.skipped = l2Result.skipped;
    }

    // ---- Phase 4: Ads performance sync ----
    try {
      await syncAdsPerformance();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      stats.errors.push(`Ads sync: ${msg}`);
    }

    // ---- Phase 5: Emit signals ----
    await emitSignal('reddit_scan_complete', {
      postsScanned: stats.postsScanned,
      opportunitiesFound: stats.opportunitiesCreated,
      responsesDrafted: stats.responseDrafted,
    });

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      agent: 'cayenne',
      duration_ms: elapsed,
      stats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Run failed: ${message}`, stats },
      { status: 500 }
    );
  }
}

// Suppress unused variable lint for GET/POST
void (GET as unknown);
void (POST as unknown);
