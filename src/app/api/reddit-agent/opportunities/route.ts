import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const subreddit = searchParams.get('subreddit');
    const type = searchParams.get('type');
    const minScore = searchParams.get('minScore');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    let query = supabase
      .from('reddit_agent_opportunities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);
    if (subreddit) query = query.eq('subreddit', subreddit);
    if (type) query = query.eq('opportunity_type', type);
    if (minScore) query = query.gte('combined_score', parseInt(minScore, 10));

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ opportunities: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
