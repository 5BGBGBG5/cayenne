import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { emitSignal } from '@/lib/signals';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface DecideBody {
  decisionId: string;
  action: 'approve' | 'reject';
  reviewedBy?: string;
  reviewNotes?: string;
}

/**
 * Approve or reject proposals from the decision queue.
 * Handles both draft_response and ad_recommendation action types.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as DecideBody;
    const { decisionId, action, reviewedBy, reviewNotes } = body;

    if (!decisionId || !action) {
      return NextResponse.json(
        { error: 'Missing decisionId or action' },
        { status: 400 }
      );
    }

    // Fetch the decision queue item
    const { data: decision, error } = await supabase
      .from('reddit_agent_decision_queue')
      .select('*')
      .eq('id', decisionId)
      .single();

    if (error || !decision) {
      return NextResponse.json(
        { error: 'Decision not found' },
        { status: 404 }
      );
    }

    if (decision.status !== 'pending') {
      return NextResponse.json(
        { error: `Decision already ${decision.status}` },
        { status: 400 }
      );
    }

    // Update decision status
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await supabase
      .from('reddit_agent_decision_queue')
      .update({
        status: newStatus,
        reviewed_by: reviewedBy || 'human',
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes || null,
      })
      .eq('id', decisionId);

    // Handle by action type
    if (decision.action_type === 'draft_response') {
      return handleResponseDecision(decision, action, reviewedBy);
    }

    if (decision.action_type === 'ad_recommendation') {
      return handleAdDecision(decision, action, reviewedBy, request);
    }

    // For ad_pause, ad_resume, trend_alert — just log and return
    await supabase.from('reddit_agent_change_log').insert({
      action_type: `${decision.action_type}_${action}ed`,
      action_detail: decision.action_summary,
      data_used: decision.action_detail,
      reason: reviewNotes || `${action}ed by ${reviewedBy || 'human'}`,
      outcome: action === 'approve' ? 'approved' : 'rejected',
      executed_by: reviewedBy || 'human',
      executed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Decision failed: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * Handle approval/rejection of a draft response.
 */
async function handleResponseDecision(
  decision: Record<string, unknown>,
  action: 'approve' | 'reject',
  reviewedBy?: string
) {
  if (decision.opportunity_id) {
    const newStatus = action === 'approve' ? 'approved' : 'new';
    await supabase
      .from('reddit_agent_opportunities')
      .update({ status: newStatus })
      .eq('id', decision.opportunity_id);
  }

  await supabase.from('reddit_agent_change_log').insert({
    action_type: `draft_response_${action}ed`,
    action_detail: decision.action_summary as string,
    data_used: {
      opportunity_id: decision.opportunity_id,
      subreddit: decision.subreddit,
      post_title: decision.post_title,
      response_style: decision.response_style,
    },
    reason: `${action}ed by ${reviewedBy || 'human'}`,
    outcome: action === 'approve' ? 'approved' : 'rejected',
    executed_by: reviewedBy || 'human',
    executed_at: new Date().toISOString(),
  });

  return NextResponse.json({
    success: true,
    action_type: 'draft_response',
    status: action === 'approve' ? 'approved' : 'rejected',
    message: action === 'approve'
      ? 'Response approved. Copy and post it manually on Reddit.'
      : 'Response rejected.',
  });
}

/**
 * Handle approval/rejection of an ad recommendation.
 * If approved, triggers campaign creation via the ads/create endpoint.
 */
async function handleAdDecision(
  decision: Record<string, unknown>,
  action: 'approve' | 'reject',
  reviewedBy?: string,
  request?: NextRequest
) {
  if (action === 'reject') {
    await supabase.from('reddit_agent_change_log').insert({
      action_type: 'ad_recommendation_rejected',
      action_detail: decision.action_summary as string,
      data_used: decision.action_detail as Record<string, unknown>,
      reason: `Rejected by ${reviewedBy || 'human'}`,
      outcome: 'rejected',
      executed_by: reviewedBy || 'human',
      executed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      action_type: 'ad_recommendation',
      status: 'rejected',
    });
  }

  // Approved — create campaign via ads/create
  const detail = decision.action_detail as Record<string, unknown> || {};

  try {
    const createUrl = new URL('/api/reddit-agent/ads/create', request?.url || 'http://localhost');
    const createRes = await fetch(createUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignName: detail.campaign_name || detail.headline || 'Cayenne Ad',
        objective: detail.objective || 'traffic',
        dailyBudget: detail.daily_budget || 5,
        durationDays: detail.duration_days || 7,
        targetingSubreddits: detail.targeting_subreddits || [],
        targetingKeywords: detail.targeting_keywords || [],
        adHeadline: detail.headline || '',
        adBody: detail.body || '',
        adCta: detail.cta || 'LEARN_MORE',
        sourceSignalType: detail.source_signal_type || 'organic',
        sourceSignalDetail: detail.source_signal_detail || {},
        decisionId: decision.id,
      }),
    });

    const createResult = await createRes.json() as Record<string, unknown>;

    if (!createRes.ok) {
      throw new Error((createResult.error as string) || 'Campaign creation failed');
    }

    await emitSignal('reddit_ad_created', {
      campaignId: createResult.campaignId,
      redditCampaignId: createResult.redditCampaignId,
      sourceSignal: detail.source_signal_type,
    });

    return NextResponse.json({
      success: true,
      action_type: 'ad_recommendation',
      status: 'approved',
      campaignId: createResult.campaignId,
      redditCampaignId: createResult.redditCampaignId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    await supabase.from('reddit_agent_change_log').insert({
      action_type: 'ad_creation_failed',
      action_detail: `Failed to create ad for: ${decision.action_summary}`,
      data_used: { error: message, detail },
      reason: message,
      outcome: 'rejected',
    });

    return NextResponse.json(
      { error: `Ad creation failed: ${message}` },
      { status: 500 }
    );
  }
}
