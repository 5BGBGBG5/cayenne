import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Manual trigger — runs the main scan + agent loop on demand.
 * Optionally accepts a specific post ID for targeted processing.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetPostId = (body as Record<string, unknown>).postId as string | undefined;

    // Call the main run route internally
    const runUrl = new URL('/api/reddit-agent/run', request.url);
    const res = await fetch(runUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.get('Authorization') || '',
      },
      body: JSON.stringify({ manual: true, targetPostId }),
    });

    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Manual trigger failed: ${message}` },
      { status: 500 }
    );
  }
}
