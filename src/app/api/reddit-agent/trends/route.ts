import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'daily';
    const limit = parseInt(searchParams.get('limit') || '7', 10);

    const { data: snapshots } = await supabase
      .from('reddit_agent_trend_snapshots')
      .select('*')
      .eq('period', period)
      .order('snapshot_date', { ascending: false })
      .limit(limit);

    // Get latest digest for context
    const { data: latestDigest } = await supabase
      .from('reddit_agent_daily_digest')
      .select('*')
      .order('digest_date', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      snapshots: snapshots || [],
      latestDigest: latestDigest || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
