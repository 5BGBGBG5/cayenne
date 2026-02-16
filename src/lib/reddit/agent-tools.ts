import type Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../supabase';
import { getPostComments, getUserPosts } from './queries';
import { validateDraftResponse } from './validation';
import type { Layer1Candidate, AgentToolCall } from './types';

// ============================================================================
// Tool Definitions — Claude API tool schemas
// ============================================================================

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_post_comments',
    description: 'Fetch the comment thread for the current post. Understand the conversation, check if someone already recommended a competitor, gauge sentiment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max comments to fetch (default 30)',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_user_history',
    description: 'Get recent posts by the post author across Reddit (last 30 days). Assess: decision-maker? Actively evaluating ERPs? Related pain points?',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_related_posts',
    description: 'Search previously scanned posts for recent posts on the same topic or subreddit. Detect recurring pain point clusters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — topic or keyword to match against post titles and text',
        },
        subreddit: {
          type: 'string',
          description: 'Optionally filter to a specific subreddit',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_competitor_mentions',
    description: 'Query for mentions of specific ERP competitors (NetSuite, SAP, Dynamics, Fishbowl, etc.) in recently scanned posts. Returns posts where competitors are discussed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        competitors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Competitor names to search for (e.g. ["NetSuite", "SAP", "Fishbowl"])',
        },
      },
      required: ['competitors'],
    },
  },
  {
    name: 'get_active_campaigns',
    description: 'Check what Reddit ad campaigns are currently running for this topic/subreddit. Helps determine if organic response adds incremental value or is redundant.',
    input_schema: {
      type: 'object' as const,
      properties: {
        subreddit: {
          type: 'string',
          description: 'Optionally filter campaigns targeting this subreddit',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_signal_bus',
    description: 'Query shared_agent_signals for recent signals from any SALT agent related to this topic. Cross-agent intelligence — maybe Saffron sees this keyword trending in Google Ads too.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description: 'Topic or keyword to search signals for',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'evaluate_draft',
    description: 'Score a draft response against content guardrails (promotional score, prohibited phrases, length, tone). If the draft fails, revise and re-evaluate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        draft: {
          type: 'string',
          description: 'The draft response text to evaluate',
        },
        promotional_score: {
          type: 'number',
          description: 'Your self-assessed promotional score (0.0 = purely helpful, 1.0 = purely promotional)',
        },
      },
      required: ['draft', 'promotional_score'],
    },
  },
  {
    name: 'submit_opportunity',
    description: 'TERMINAL. Finalize the analysis — submit the scored opportunity and optional draft response to the decision queue. The agent loop ends after this call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunity_type: {
          type: 'string',
          enum: ['direct_ask', 'pain_point', 'competitor_mention', 'compliance_question', 'industry_trend', 'process_discussion'],
          description: 'Classification of this opportunity',
        },
        layer2_score: {
          type: 'number',
          description: 'Your Layer 2 score (0-100) based on purchase intent, problem-solution fit, response viability, authority position, conversion potential',
        },
        intent_analysis: {
          type: 'string',
          description: 'Brief analysis of the poster\'s intent and context',
        },
        key_signals: {
          type: 'object',
          description: 'Key signals discovered during investigation',
        },
        draft_response: {
          type: 'string',
          description: 'Optional draft response. Must NOT mention Inecta or include links. Null if no natural response exists.',
        },
        response_style: {
          type: 'string',
          description: 'Style used for the response (helpful_peer, empathetic_practitioner, fair_advisor, technical_advisor, industry_expert)',
        },
        investigation_summary: {
          type: 'string',
          description: 'Summary of what you investigated and what you learned',
        },
      },
      required: ['opportunity_type', 'layer2_score', 'intent_analysis', 'investigation_summary'],
    },
  },
  {
    name: 'skip_opportunity',
    description: 'TERMINAL. Explicitly decide not to pursue this post, with a reason. Logs skip reason for anti-drift tracking. The agent loop ends after this call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: 'Why this opportunity should be skipped',
        },
        investigation_summary: {
          type: 'string',
          description: 'Summary of what you investigated before deciding to skip',
        },
      },
      required: ['reason', 'investigation_summary'],
    },
  },
];

// ============================================================================
// Tool Execution Handlers
// ============================================================================

export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  candidate: Layer1Candidate
): Promise<{ result: unknown; call: AgentToolCall }> {
  const startTime = Date.now();
  let result: unknown;

  switch (toolName) {
    case 'read_post_comments': {
      const limit = (input.limit as number) || 30;
      // Strip "t3_" prefix if present
      const postId = candidate.reddit_post_id.replace(/^t3_/, '');
      const comments = await getPostComments(postId, candidate.subreddit, { limit, depth: 3 });
      result = {
        count: comments.length,
        comments: comments.slice(0, 20).map(c => ({
          author: c.author,
          body: c.body.slice(0, 500),
          score: c.score,
          depth: c.depth,
        })),
      };
      break;
    }

    case 'check_user_history': {
      if (!candidate.author || candidate.author === '[deleted]') {
        result = { error: 'Author is deleted or unknown' };
        break;
      }
      try {
        const posts = await getUserPosts(candidate.author, { limit: 15 });
        result = {
          username: candidate.author,
          recent_posts: posts.slice(0, 10).map(p => ({
            subreddit: p.subreddit,
            title: p.title,
            score: p.score,
            created_utc: p.created_utc,
          })),
        };
      } catch {
        result = { error: 'Could not fetch user history (private or suspended)' };
      }
      break;
    }

    case 'search_related_posts': {
      const query = input.query as string;
      const subFilter = input.subreddit as string | undefined;

      let queryBuilder = supabase
        .from('reddit_agent_scanned_posts')
        .select('reddit_post_id, subreddit, title, selftext, layer1_score, scanned_at')
        .gte('scanned_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .order('scanned_at', { ascending: false })
        .limit(10);

      if (subFilter) {
        queryBuilder = queryBuilder.eq('subreddit', subFilter);
      }

      // Text search on title
      queryBuilder = queryBuilder.ilike('title', `%${query}%`);

      const { data } = await queryBuilder;
      result = { related_posts: data || [] };
      break;
    }

    case 'check_competitor_mentions': {
      const competitors = input.competitors as string[];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      const mentions: Array<{ competitor: string; posts: unknown[] }> = [];
      for (const comp of competitors.slice(0, 5)) {
        const { data } = await supabase
          .from('reddit_agent_scanned_posts')
          .select('reddit_post_id, subreddit, title, scanned_at')
          .or(`title.ilike.%${comp}%,selftext.ilike.%${comp}%`)
          .gte('scanned_at', twoWeeksAgo)
          .order('scanned_at', { ascending: false })
          .limit(5);

        mentions.push({ competitor: comp, posts: data || [] });
      }
      result = { competitor_mentions: mentions };
      break;
    }

    case 'get_active_campaigns': {
      const subFilter = input.subreddit as string | undefined;

      let queryBuilder = supabase
        .from('reddit_agent_ad_campaigns')
        .select('campaign_name, status, daily_budget, targeting_subreddits, targeting_keywords, source_signal_type, ad_headline')
        .eq('status', 'active');

      if (subFilter) {
        queryBuilder = queryBuilder.contains('targeting_subreddits', [subFilter]);
      }

      const { data } = await queryBuilder;
      result = { active_campaigns: data || [] };
      break;
    }

    case 'check_signal_bus': {
      const topic = input.topic as string;
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from('shared_agent_signals')
        .select('source_agent, event_type, payload, created_at')
        .gte('created_at', oneWeekAgo)
        .order('created_at', { ascending: false })
        .limit(10);

      // Filter signals that are relevant to the topic
      const relevant = (data || []).filter(s => {
        const payloadStr = JSON.stringify(s.payload).toLowerCase();
        return payloadStr.includes(topic.toLowerCase());
      });

      result = { signals: relevant.slice(0, 5) };
      break;
    }

    case 'evaluate_draft': {
      const draft = input.draft as string;
      const promoScore = input.promotional_score as number;
      const validation = await validateDraftResponse(draft, promoScore);
      result = validation;
      break;
    }

    case 'submit_opportunity':
    case 'skip_opportunity': {
      // Terminal tools — the result is the input itself
      // The agent loop reads these from the final message
      result = { acknowledged: true, action: toolName };
      break;
    }

    default:
      result = { error: `Unknown tool: ${toolName}` };
  }

  return {
    result,
    call: {
      tool_name: toolName,
      input,
      output: result,
      duration_ms: Date.now() - startTime,
    },
  };
}
