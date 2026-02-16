import { supabase } from '../supabase';

const REDDIT_APP_ID = process.env.REDDIT_APP_ID || '';
const REDDIT_APP_SECRET = process.env.REDDIT_APP_SECRET || '';
const REDDIT_REDIRECT_URI = process.env.REDDIT_REDIRECT_URI || 'https://cayenne.inecta-salt.com/api/auth/reddit/callback';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * Build the Reddit OAuth2 authorization URL.
 * Scopes: read (organic), identity, ads (Reddit Ads API read+write)
 */
export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: REDDIT_APP_ID,
    response_type: 'code',
    state,
    redirect_uri: REDDIT_REDIRECT_URI,
    duration: 'permanent',
    scope: 'read identity ads',
  });
  return `https://www.reddit.com/api/v1/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called once during the OAuth callback flow.
 */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const basicAuth = Buffer.from(`${REDDIT_APP_ID}:${REDDIT_APP_SECRET}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'web:cayenne-salt:v1.0 (by /u/inecta_salt)',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDDIT_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit token exchange failed: ${res.status} — ${text}`);
  }

  const data = await res.json() as TokenResponse;

  // Store tokens in Supabase — single row, upsert
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await storeTokens(data.access_token, data.refresh_token, expiresAt, data.scope);

  return data;
}

/**
 * Get a valid access token. Refreshes automatically if expired.
 * Reddit rotates refresh tokens on every use — we must store the new one.
 */
export async function getAccessToken(): Promise<string> {
  // Load current tokens from Supabase
  const { data: row, error } = await supabase
    .from('reddit_agent_reddit_auth')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !row) {
    throw new Error('No Reddit auth tokens found. Complete OAuth flow first.');
  }

  // Check if token is still valid (with 60s buffer)
  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) {
    return row.access_token;
  }

  // Token expired — refresh it
  return refreshAccessToken(row.refresh_token);
}

/**
 * Refresh the access token using the stored refresh token.
 * Reddit rotates refresh tokens — the old one becomes invalid.
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const basicAuth = Buffer.from(`${REDDIT_APP_ID}:${REDDIT_APP_SECRET}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'web:cayenne-salt:v1.0 (by /u/inecta_salt)',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit token refresh failed: ${res.status} — ${text}`);
  }

  const data = await res.json() as TokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Store the NEW refresh token (old one is now invalid)
  await storeTokens(data.access_token, data.refresh_token, expiresAt, data.scope);

  return data.access_token;
}

/**
 * Store tokens in Supabase. Upserts a single row.
 */
async function storeTokens(
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
  scopes: string
): Promise<void> {
  // Delete all existing rows and insert fresh
  await supabase.from('reddit_agent_reddit_auth').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('reddit_agent_reddit_auth').insert({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    scopes,
    updated_at: new Date().toISOString(),
  });
}
