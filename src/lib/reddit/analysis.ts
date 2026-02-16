import { supabase } from '../supabase';
import { emitSignal } from '../signals';
import { runAgentLoop } from './agent-loop';
import { validateDraftResponse } from './validation';
import { combinedScore } from './scoring';
import type { Layer1Candidate, Opportunity } from './types';

// Default: 1 candidate per cron run (tune up after observing execution times)
const MAX_L2_CANDIDATES_PER_RUN = 1;

/**
 * Orchestrate Layer 2 analysis via the agent loop.
 * Takes ranked L1 candidates, runs top N through the agent loop,
 * validates results, and writes to Supabase.
 */
export async function runLayer2Analysis(
  candidates: Layer1Candidate[]
): Promise<{ processed: number; opportunities: Opportunity[]; skipped: number }> {
  const toProcess = candidates.slice(0, MAX_L2_CANDIDATES_PER_RUN);
  const opportunities: Opportunity[] = [];
  let skipped = 0;

  for (const candidate of toProcess) {
    try {
      // Run the agent loop
      const result = await runAgentLoop(candidate);

      // Log the investigation to change log
      await supabase.from('reddit_agent_change_log').insert({
        action_type: 'agent_investigation',
        action_detail: `Investigated "${candidate.title}" in r/${candidate.subreddit}`,
        data_used: {
          reddit_post_id: candidate.reddit_post_id,
          subreddit: candidate.subreddit,
          layer1_score: candidate.layer1_score,
          iterations: result.iterations,
          tools_used: result.tools_used,
          tool_calls: result.tool_calls,
          action: result.action,
        },
        reason: result.action === 'skip' ? result.skip_reason : result.investigation_summary,
        outcome: result.action === 'submit' ? 'pending' : 'rejected',
      });

      // Mark post as Layer 2 analyzed
      await supabase
        .from('reddit_agent_scanned_posts')
        .update({ layer2_analyzed: true })
        .eq('id', candidate.scanned_post_id);

      if (result.action === 'skip') {
        skipped++;

        // Still create an opportunity record with skip status
        await supabase.from('reddit_agent_opportunities').insert({
          scanned_post_id: candidate.scanned_post_id,
          reddit_post_id: candidate.reddit_post_id,
          subreddit: candidate.subreddit,
          title: candidate.title,
          permalink: candidate.permalink,
          author: candidate.author,
          opportunity_type: 'pain_point', // Default for skipped
          layer1_score: candidate.layer1_score,
          status: 'skipped',
          skip_reason: result.skip_reason,
          agent_loop_iterations: result.iterations,
          agent_loop_tools_used: result.tools_used,
          agent_investigation_summary: result.investigation_summary,
        });

        continue;
      }

      // Submit path — validate draft response if present
      let draftResponse = result.draft_response || null;
      let qualityCheck = null;
      let promotionalScore = null;

      if (draftResponse) {
        // Post-loop safety net validation
        const validation = await validateDraftResponse(draftResponse, result.promotional_score);
        qualityCheck = validation.qualityCheck;
        promotionalScore = validation.promotionalScore;

        if (!validation.passed) {
          // Draft failed safety net — still create opportunity but without draft
          draftResponse = null;
          qualityCheck = {
            ...validation.qualityCheck,
            safetyNetBlocked: true,
            violations: validation.violations,
          };
        }
      }

      const l2Score = result.layer2_score || 50;
      const combined = combinedScore(candidate.layer1_score, l2Score);

      // Create opportunity
      const { data: opp } = await supabase
        .from('reddit_agent_opportunities')
        .insert({
          scanned_post_id: candidate.scanned_post_id,
          reddit_post_id: candidate.reddit_post_id,
          subreddit: candidate.subreddit,
          title: candidate.title,
          permalink: candidate.permalink,
          author: candidate.author,
          opportunity_type: result.opportunity_type || 'pain_point',
          layer1_score: candidate.layer1_score,
          layer2_score: l2Score,
          combined_score: combined,
          intent_analysis: result.intent_analysis,
          key_signals: result.key_signals,
          agent_loop_iterations: result.iterations,
          agent_loop_tools_used: result.tools_used,
          agent_investigation_summary: result.investigation_summary,
          status: draftResponse ? 'response_drafted' : 'new',
        })
        .select()
        .single();

      if (opp) {
        opportunities.push(opp as Opportunity);

        // If we have a valid draft, add to decision queue
        if (draftResponse) {
          await supabase.from('reddit_agent_decision_queue').insert({
            opportunity_id: opp.id,
            reddit_post_id: candidate.reddit_post_id,
            subreddit: candidate.subreddit,
            post_title: candidate.title,
            post_permalink: candidate.permalink,
            action_type: 'draft_response',
            action_summary: `Draft response for "${candidate.title}" in r/${candidate.subreddit}`,
            action_detail: {
              intent_analysis: result.intent_analysis,
              key_signals: result.key_signals,
              investigation_summary: result.investigation_summary,
            },
            draft_response: draftResponse,
            response_style: result.response_style,
            opportunity_type: result.opportunity_type,
            combined_score: combined,
            confidence: l2Score / 100,
            quality_check: qualityCheck,
            promotional_score: promotionalScore,
            risk_level: combined >= 70 ? 'low' : combined >= 50 ? 'medium' : 'high',
            priority: Math.min(10, Math.ceil(combined / 10)),
          });

          // Emit signal for high-scoring opportunities
          if (combined >= 70) {
            await emitSignal('reddit_opportunity_found', {
              postId: candidate.reddit_post_id,
              subreddit: candidate.subreddit,
              type: result.opportunity_type,
              score: combined,
              title: candidate.title,
            });
          }

          await emitSignal('reddit_response_drafted', {
            opportunityId: opp.id,
            subreddit: candidate.subreddit,
            responseStyle: result.response_style,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Agent loop failed for ${candidate.reddit_post_id}:`, message);

      // Log the failure
      await supabase.from('reddit_agent_change_log').insert({
        action_type: 'agent_investigation',
        action_detail: `Agent loop failed for "${candidate.title}" in r/${candidate.subreddit}`,
        data_used: { error: message, reddit_post_id: candidate.reddit_post_id },
        reason: `Error: ${message}`,
        outcome: 'rejected',
      });

      // Mark as analyzed so we don't retry indefinitely
      await supabase
        .from('reddit_agent_scanned_posts')
        .update({ layer2_analyzed: true })
        .eq('id', candidate.scanned_post_id);
    }
  }

  return { processed: toProcess.length, opportunities, skipped };
}
