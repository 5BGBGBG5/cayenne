import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../supabase';
import { emitSignal } from '../signals';
import { getCorrelationInsights } from './correlation';

const anthropic = new Anthropic();

const MAX_AD_TOOL_CALLS = 4;
const MAX_AD_DURATION_MS = 30_000;

interface AdRecommendation {
  campaignName: string;
  targetSubreddits: string[];
  targetKeywords: string[];
  headline: string;
  body: string;
  cta: string;
  dailyBudget: number;
  durationDays: number;
  sourceSignalType: string;
  sourceSignalDetail: Record<string, unknown>;
  reasoning: string;
  isEvergreen: boolean;
}

const AD_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_active_campaigns',
    description: 'Check what ad campaigns are currently running. Avoid duplicating existing campaigns.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'check_signal_bus',
    description: 'Query shared_agent_signals for recent cross-agent intelligence.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: { type: 'string', description: 'Topic to search signals for' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'get_correlation_data',
    description: 'Get historical data on which organic signal types produce the best ad ROI.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'submit_recommendations',
    description: 'TERMINAL. Submit ad recommendations. Each recommendation should include targeting, copy, budget, and the organic signal that inspired it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              campaign_name: { type: 'string' },
              target_subreddits: { type: 'array', items: { type: 'string' } },
              target_keywords: { type: 'array', items: { type: 'string' } },
              headline: { type: 'string', description: 'Ad headline (max 300 chars)' },
              body: { type: 'string', description: 'Ad body text' },
              cta: { type: 'string', description: 'Call to action (LEARN_MORE, GET_STARTED, etc.)' },
              daily_budget: { type: 'number', description: 'Daily budget in USD ($5-$15)' },
              duration_days: { type: 'number', description: 'Campaign duration (3-7 days)' },
              source_signal_type: { type: 'string', description: 'trending_topic, pain_point_cluster, competitor_mention, or evergreen' },
              source_signal_detail: { type: 'object', description: 'The organic data that triggered this' },
              reasoning: { type: 'string' },
              is_evergreen: { type: 'boolean' },
            },
            required: ['campaign_name', 'target_subreddits', 'headline', 'body', 'daily_budget', 'duration_days', 'source_signal_type', 'reasoning', 'is_evergreen'],
          },
          description: 'List of ad recommendations',
        },
      },
      required: ['recommendations'],
    },
  },
];

/**
 * Run the ad recommendation agent loop (lighter version).
 * Used during the digest cron to generate ad recommendations from organic signals.
 */
export async function generateAdRecommendations(trendData: {
  topicFrequencies: Record<string, number>;
  competitorMentions: Record<string, number>;
  emergingTopics: string[];
  subredditActivity: Record<string, number>;
}): Promise<AdRecommendation[]> {
  const startTime = Date.now();
  let toolCallCount = 0;

  // Build context for the agent
  const systemPrompt = `You are Cayenne's ad recommendation engine. Based on today's organic Reddit intelligence, recommend Reddit ad campaigns that would complement the organic strategy.

## Guidelines
- Every ad must link to an organic signal (trending topic, pain point cluster, competitor mention) or be tagged evergreen
- Check what's already running to avoid duplicates
- Use correlation data to weight signal types that historically produce better ROI
- Maintain at least 1 evergreen campaign for core pain points (FDA compliance, traceability, food manufacturing ERP)
- Budget range: $5-$15/day per campaign, 3-7 day duration
- Headlines max 300 chars, body text should be concise and relevant
- CTA options: LEARN_MORE, GET_STARTED, CONTACT_US, READ_MORE
- Max 2 new recommendations per digest cycle

## Inecta Context
Inecta provides ERP software for food & beverage manufacturers, built on Microsoft Dynamics 365 Business Central. Key capabilities: lot tracking, FSMA compliance, recipe management, production scheduling, multi-entity accounting.`;

  const userMessage = `## Today's Organic Intelligence

**Topic Frequencies:** ${JSON.stringify(trendData.topicFrequencies)}
**Competitor Mentions:** ${JSON.stringify(trendData.competitorMentions)}
**Emerging Topics:** ${trendData.emergingTopics.join(', ') || 'none'}
**Subreddit Activity:** ${JSON.stringify(trendData.subredditActivity)}

Review the data, check active campaigns and correlation history, then submit your recommendations.`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  const recommendations: AdRecommendation[] = [];

  while (toolCallCount < MAX_AD_TOOL_CALLS) {
    if (Date.now() - startTime > MAX_AD_DURATION_MS) break;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: systemPrompt,
      tools: AD_TOOLS,
      messages,
    });

    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'
    );

    if (toolBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolBlocks) {
      toolCallCount++;
      const input = block.input as Record<string, unknown>;

      if (block.name === 'submit_recommendations') {
        // Terminal — extract recommendations
        const recs = (input.recommendations as Array<Record<string, unknown>>) || [];
        for (const rec of recs) {
          recommendations.push({
            campaignName: (rec.campaign_name as string) || 'Cayenne Ad',
            targetSubreddits: (rec.target_subreddits as string[]) || [],
            targetKeywords: (rec.target_keywords as string[]) || [],
            headline: (rec.headline as string) || '',
            body: (rec.body as string) || '',
            cta: (rec.cta as string) || 'LEARN_MORE',
            dailyBudget: (rec.daily_budget as number) || 5,
            durationDays: (rec.duration_days as number) || 7,
            sourceSignalType: (rec.source_signal_type as string) || 'organic',
            sourceSignalDetail: (rec.source_signal_detail as Record<string, unknown>) || {},
            reasoning: (rec.reasoning as string) || '',
            isEvergreen: (rec.is_evergreen as boolean) || false,
          });
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ acknowledged: true }) });
        // Write recommendations to decision queue
        for (const rec of recommendations) {
          await supabase.from('reddit_agent_decision_queue').insert({
            action_type: 'ad_recommendation',
            action_summary: `Ad recommendation: "${rec.headline}" targeting ${rec.targetSubreddits.join(', ')}`,
            action_detail: {
              campaign_name: rec.campaignName,
              targeting_subreddits: rec.targetSubreddits,
              targeting_keywords: rec.targetKeywords,
              headline: rec.headline,
              body: rec.body,
              cta: rec.cta,
              daily_budget: rec.dailyBudget,
              duration_days: rec.durationDays,
              source_signal_type: rec.sourceSignalType,
              source_signal_detail: rec.sourceSignalDetail,
              objective: 'traffic',
              is_evergreen: rec.isEvergreen,
            },
            confidence: 0.7,
            risk_level: 'low',
            priority: rec.isEvergreen ? 8 : 6,
          });

          await emitSignal('reddit_ad_recommended', {
            signalType: rec.sourceSignalType,
            targetSubreddits: rec.targetSubreddits,
            suggestedBudget: rec.dailyBudget,
            headline: rec.headline,
          });
        }
        return recommendations;
      }

      // Non-terminal tools
      let result: unknown;
      if (block.name === 'get_active_campaigns') {
        const { data } = await supabase
          .from('reddit_agent_ad_campaigns')
          .select('campaign_name, status, daily_budget, targeting_subreddits, source_signal_type, ad_headline')
          .in('status', ['active', 'recommended', 'approved']);
        result = { campaigns: data || [] };
      } else if (block.name === 'check_signal_bus') {
        const topic = input.topic as string;
        const { data } = await supabase
          .from('shared_agent_signals')
          .select('source_agent, event_type, payload, created_at')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(10);

        const relevant = (data || []).filter(s =>
          JSON.stringify(s.payload).toLowerCase().includes(topic.toLowerCase())
        );
        result = { signals: relevant.slice(0, 5) };
      } else if (block.name === 'get_correlation_data') {
        result = await getCorrelationInsights();
      } else {
        result = { error: `Unknown tool: ${block.name}` };
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  return recommendations;
}
