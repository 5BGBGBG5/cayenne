import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { emitSignal } from '@/lib/signals';
import { getAccessToken } from '@/lib/reddit/auth';
import { getSubredditNew } from '@/lib/reddit/queries';
import { loadKeywords, matchKeywords } from '@/lib/reddit/keywords';
import { scoreLayer1 } from '@/lib/reddit/scoring';
import { computeTrends } from '@/lib/reddit/trends';
import { generateAdRecommendations } from '@/lib/reddit/ad-recommender';
import type { MonitoredSubreddit } from '@/lib/reddit/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const anthropic = new Anthropic();

/**
 * Cron 2: Mini-scan + trends + ad recommendation loop + daily digest
 * Schedule: 0 22 * * * (10 PM UTC / 6 PM ET)
 */
export async function GET(request: NextRequest) {
  return handleDigest(request);
}

export async function POST(request: NextRequest) {
  return handleDigest(request);
}

async function handleDigest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const startTime = Date.now();

  try {
    // ---- Phase 1: Refresh token ----
    await getAccessToken();
    const keywords = await loadKeywords();

    // ---- Phase 2: Mini Layer 1 scan (higher threshold, catch afternoon posts) ----
    const { data: subreddits } = await supabase
      .from('reddit_agent_monitored_subreddits')
      .select('*')
      .eq('is_active', true)
      .order('scan_priority', { ascending: false });

    let miniScanCount = 0;
    let highScoringStored = 0;

    for (const sub of (subreddits || []) as MonitoredSubreddit[]) {
      try {
        const { posts } = await getSubredditNew(sub.subreddit, { limit: 10 });

        for (const post of posts) {
          if (post.over_18 || post.author === '[deleted]') continue;
          const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
          if (ageHours > 48) continue;

          // Deduplicate
          const { data: existing } = await supabase
            .from('reddit_agent_scanned_posts')
            .select('id')
            .eq('reddit_post_id', post.name)
            .limit(1);
          if (existing?.length) continue;

          const searchText = `${post.title} ${post.selftext || ''}`;
          const { matched } = matchKeywords(searchText, keywords);
          const { score } = scoreLayer1(post, matched, sub);

          // Store all scanned posts
          await supabase.from('reddit_agent_scanned_posts').insert({
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
          });

          miniScanCount++;
          if (score >= 60) highScoringStored++;
        }
      } catch {
        // Skip this subreddit on error
      }
    }

    // ---- Phase 3: Trend analysis ----
    const trends = await computeTrends('daily');

    // ---- Phase 4: Ad recommendation agent loop ----
    let adRecommendations: unknown[] = [];
    try {
      adRecommendations = await generateAdRecommendations(trends);
    } catch (err) {
      console.error('Ad recommendation failed:', err);
    }

    // ---- Phase 5: Generate digest narrative ----
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: totalScanned } = await supabase
      .from('reddit_agent_scanned_posts')
      .select('id', { count: 'exact', head: true })
      .gte('scanned_at', today.toISOString());

    const { count: totalOpportunities } = await supabase
      .from('reddit_agent_opportunities')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    const { count: totalDrafted } = await supabase
      .from('reddit_agent_decision_queue')
      .select('id', { count: 'exact', head: true })
      .eq('action_type', 'draft_response')
      .gte('created_at', today.toISOString());

    const { data: topOpportunities } = await supabase
      .from('reddit_agent_opportunities')
      .select('title, subreddit, combined_score, opportunity_type, status')
      .gte('created_at', today.toISOString())
      .order('combined_score', { ascending: false })
      .limit(5);

    // Generate narrative with Claude
    let narrative = '';
    try {
      const narrativeResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Generate a concise daily digest narrative (3-5 paragraphs) for Cayenne, the Reddit marketing intelligence agent for Inecta (food & beverage ERP). Today's data:

Posts scanned: ${totalScanned || 0}
Opportunities found: ${totalOpportunities || 0}
Responses drafted: ${totalDrafted || 0}
Ad recommendations: ${adRecommendations.length}
Top topics: ${Object.entries(trends.topicFrequencies).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}
Competitor mentions: ${Object.entries(trends.competitorMentions).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}
Emerging topics: ${trends.emergingTopics.join(', ') || 'none'}
Active subreddits: ${Object.entries(trends.subredditActivity).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `r/${k} (${v})`).join(', ') || 'none'}
Top opportunities: ${JSON.stringify(topOpportunities || [])}

Write in first person as Cayenne. Be factual, concise, and highlight actionable insights. Return plain text, no JSON wrapping.`,
        }],
      });

      const textBlock = narrativeResponse.content.find(b => b.type === 'text');
      narrative = textBlock ? (textBlock as Anthropic.TextBlock).text : 'Digest generation produced no narrative.';
    } catch {
      narrative = `Cayenne scanned ${totalScanned || 0} posts today, found ${totalOpportunities || 0} opportunities, and generated ${adRecommendations.length} ad recommendations.`;
    }

    // ---- Phase 6: Store digest ----
    const digestDate = new Date().toISOString().split('T')[0];
    await supabase.from('reddit_agent_daily_digest').upsert({
      digest_date: digestDate,
      summary_narrative: narrative,
      posts_scanned: (totalScanned || 0) + miniScanCount,
      opportunities_found: totalOpportunities || 0,
      responses_drafted: totalDrafted || 0,
      ad_recommendations_generated: adRecommendations.length,
      top_opportunities: topOpportunities || [],
      trend_summary: trends,
      ad_recommendations: adRecommendations,
    }, { onConflict: 'digest_date' });

    await emitSignal('reddit_digest_complete', {
      digestDate,
      topTopics: Object.keys(trends.topicFrequencies).slice(0, 5),
      emergingTopics: trends.emergingTopics,
    });

    return NextResponse.json({
      success: true,
      agent: 'cayenne',
      duration_ms: Date.now() - startTime,
      digestDate,
      stats: {
        miniScanCount,
        highScoringStored,
        trends: {
          topics: Object.keys(trends.topicFrequencies).length,
          emergingTopics: trends.emergingTopics.length,
          competitors: Object.keys(trends.competitorMentions).length,
        },
        adRecommendations: adRecommendations.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Digest failed: ${message}` }, { status: 500 });
  }
}
