import Anthropic from '@anthropic-ai/sdk';
import { AGENT_TOOLS, executeToolCall } from './agent-tools';
import type { Layer1Candidate, AgentLoopResult, AgentToolCall } from './types';

const anthropic = new Anthropic();

const MAX_TOOL_CALLS = 8;
const MAX_DURATION_MS = 45_000;

const SYSTEM_PROMPT = `You are Cayenne, a Reddit marketing intelligence agent for Inecta, a food & beverage ERP company. You are analyzing a Reddit post to determine if it represents an opportunity for Inecta to provide genuine, helpful engagement.

## Your Role
You investigate Reddit posts to understand context, assess opportunity quality, and optionally draft helpful responses. You are NOT a salesperson — you are a knowledgeable industry peer who provides genuine value.

## Investigation Process
1. Start by understanding the post context. Read comments if the thread has them.
2. Check the author's history if relevant — are they a decision-maker? Actively evaluating ERPs?
3. Search for related posts to detect patterns or recurring pain points.
4. Check if competitors have been mentioned in this thread or related ones.
5. Check active ad campaigns to avoid redundancy.
6. Check the signal bus for cross-agent intelligence.
7. Based on your investigation, decide whether to submit or skip this opportunity.

## If You Draft a Response
- NEVER mention Inecta by name
- NEVER include URLs or links
- NEVER use marketing language (book a demo, sign up, our product, etc.)
- Lead with genuine value — answer the question first
- Match the subreddit's tone
- 2-4 paragraphs max
- Use the evaluate_draft tool to validate before submitting
- If the draft fails evaluation, revise and re-evaluate

## Scoring Rubric (Layer 2, 0-100)
| Dimension | Points | What to Evaluate |
|-----------|--------|-----------------|
| Purchase intent | 0-30 | Actively looking for a solution? Budget/timeline mentioned? |
| Problem-solution fit | 0-25 | Does the problem map to Inecta's capabilities? |
| Response viability | 0-20 | Can we add genuine value? Is conversation still active? |
| Authority position | 0-15 | Can Inecta demonstrate credible expertise here? |
| Conversion potential | 0-10 | Decision-maker? Company size? Industry match? |

## Response Styles
- direct_ask → helpful_peer ("We went through this evaluation last year...")
- pain_point → empathetic_practitioner ("I've seen this exact problem...")
- competitor_mention → fair_advisor ("NetSuite is solid for general manufacturing. For food-specific needs...")
- compliance_question → technical_advisor ("FSMA 204 requires forward and backward traceability within 24 hours...")
- industry_trend → industry_expert ("The biggest shift I'm seeing is...")
- process_discussion → empathetic_practitioner ("Spreadsheet-based scheduling hits a wall around X SKUs...")

## Context Sensitivity
Skip posts about: layoffs, plant closures, product recalls, personal hardship, lawsuits, deaths, injuries. These require empathy, not marketing intelligence.

## Budget
You have a maximum of ${MAX_TOOL_CALLS} tool calls. Use them wisely — not every investigation needs all tools. You MUST call submit_opportunity or skip_opportunity before your budget runs out.`;

/**
 * Run the agent loop for a single Layer 1 candidate.
 * Returns the agent's analysis, optional draft response, or skip decision.
 */
export async function runAgentLoop(candidate: Layer1Candidate): Promise<AgentLoopResult> {
  const startTime = Date.now();
  const toolCalls: AgentToolCall[] = [];
  let iterations = 0;

  // Build the initial user message with post data
  const userMessage = buildInitialMessage(candidate);

  // Conversation history for the agent
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  while (true) {
    iterations++;

    // Check budget: time
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_DURATION_MS) {
      return forceTermination(candidate, toolCalls, iterations, 'Time budget exceeded');
    }

    // Check budget: tool calls
    if (toolCalls.length >= MAX_TOOL_CALLS) {
      return forceTermination(candidate, toolCalls, iterations, 'Tool call budget exceeded');
    }

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
    });

    // Process the response
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'
    );

    // If no tool calls, the agent wants to send text (shouldn't happen with our tools, but handle it)
    if (toolUseBlocks.length === 0) {
      // Agent stopped without calling a terminal tool — force skip
      return forceTermination(candidate, toolCalls, iterations, 'Agent ended without terminal tool call');
    }

    // Execute tool calls and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let terminalResult: AgentLoopResult | null = null;

    for (const toolBlock of toolUseBlocks) {
      // Check budget before each call
      if (toolCalls.length >= MAX_TOOL_CALLS) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: 'Budget exceeded — you must call submit_opportunity or skip_opportunity now.',
        });
        continue;
      }

      const input = toolBlock.input as Record<string, unknown>;

      // Handle terminal tools
      if (toolBlock.name === 'submit_opportunity') {
        terminalResult = buildSubmitResult(input, toolCalls, iterations);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify({ acknowledged: true }),
        });
        continue;
      }

      if (toolBlock.name === 'skip_opportunity') {
        terminalResult = buildSkipResult(input, toolCalls, iterations);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify({ acknowledged: true }),
        });
        continue;
      }

      // Execute non-terminal tool
      const { result, call } = await executeToolCall(toolBlock.name, input, candidate);
      toolCalls.push(call);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: JSON.stringify(result),
      });
    }

    // If a terminal tool was called, we're done
    if (terminalResult) {
      return terminalResult;
    }

    // Add assistant response + tool results to conversation
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    // If stop_reason is 'end_turn' (shouldn't happen mid-loop), force termination
    if (response.stop_reason === 'end_turn' && toolUseBlocks.length === 0) {
      return forceTermination(candidate, toolCalls, iterations, 'Agent ended turn without tool call');
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function buildInitialMessage(candidate: Layer1Candidate): string {
  return `## Post to Analyze

**Subreddit:** r/${candidate.subreddit} (Intent Tier: ${candidate.intent_tier})
**Title:** ${candidate.title}
**Author:** ${candidate.author || '[unknown]'}
**Score:** ${candidate.post_score} | **Comments:** ${candidate.num_comments}
**Posted:** ${candidate.created_utc}
**Permalink:** ${candidate.permalink}
${candidate.flair ? `**Flair:** ${candidate.flair}` : ''}

**Post Body:**
${candidate.selftext || '(no body text)'}

**Layer 1 Analysis:**
- Score: ${candidate.layer1_score}/100
- Keywords matched: ${candidate.layer1_keywords_matched.join(', ') || 'none'}

Investigate this post and decide whether to submit it as an opportunity (with optional draft response) or skip it. Use your tools to gather context before deciding.`;
}

function buildSubmitResult(
  input: Record<string, unknown>,
  toolCalls: AgentToolCall[],
  iterations: number
): AgentLoopResult {
  return {
    action: 'submit',
    opportunity_type: input.opportunity_type as AgentLoopResult['opportunity_type'],
    layer2_score: input.layer2_score as number,
    intent_analysis: input.intent_analysis as string,
    key_signals: input.key_signals as Record<string, unknown> | undefined,
    draft_response: input.draft_response as string | undefined,
    response_style: input.response_style as string | undefined,
    investigation_summary: input.investigation_summary as string,
    iterations,
    tools_used: [...new Set(toolCalls.map(c => c.tool_name))],
    tool_calls: toolCalls,
  };
}

function buildSkipResult(
  input: Record<string, unknown>,
  toolCalls: AgentToolCall[],
  iterations: number
): AgentLoopResult {
  return {
    action: 'skip',
    skip_reason: input.reason as string,
    investigation_summary: input.investigation_summary as string,
    iterations,
    tools_used: [...new Set(toolCalls.map(c => c.tool_name))],
    tool_calls: toolCalls,
  };
}

function forceTermination(
  candidate: Layer1Candidate,
  toolCalls: AgentToolCall[],
  iterations: number,
  reason: string
): AgentLoopResult {
  return {
    action: 'skip',
    skip_reason: `Forced termination: ${reason}`,
    investigation_summary: `Agent was forced to terminate after ${iterations} iterations and ${toolCalls.length} tool calls. Reason: ${reason}. Post: "${candidate.title}" in r/${candidate.subreddit}`,
    iterations,
    tools_used: [...new Set(toolCalls.map(c => c.tool_name))],
    tool_calls: toolCalls,
  };
}
