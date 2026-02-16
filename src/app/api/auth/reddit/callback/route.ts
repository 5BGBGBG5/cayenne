import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/reddit/auth';

export const dynamic = 'force-dynamic';

/**
 * Reddit OAuth callback — exchanges authorization code for tokens.
 * One-time flow: visit the auth URL, authorize, Reddit redirects here.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.json(
      { error: `Reddit OAuth error: ${error}` },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 }
    );
  }

  try {
    const tokens = await exchangeCode(code);

    return NextResponse.json({
      success: true,
      message: 'Reddit OAuth tokens stored successfully',
      scopes: tokens.scope,
      state,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Token exchange failed: ${message}` },
      { status: 500 }
    );
  }
}
