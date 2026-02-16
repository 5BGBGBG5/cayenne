import { getAccessToken } from './auth';

const USER_AGENT = 'web:cayenne-salt:v1.0 (by /u/inecta_salt)';
const REDDIT_DATA_BASE = 'https://oauth.reddit.com';
const REDDIT_ADS_BASE = 'https://ads-api.reddit.com/api/v3';

// ============================================================================
// Shared rate limiter — 60 requests/minute budget
// Used by BOTH Layer 1 scan AND agent loop tool calls
// ============================================================================

interface RateLimitState {
  remaining: number;
  reset: number;       // Unix timestamp (seconds) when the window resets
  used: number;
}

const rateLimitState: RateLimitState = {
  remaining: 60,
  reset: 0,
  used: 0,
};

/**
 * Wait if we're near the rate limit. Returns when it's safe to make a request.
 * Conservative: leaves a 5-request buffer.
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now() / 1000;

  // If we've passed the reset window, reset the counter
  if (now >= rateLimitState.reset) {
    rateLimitState.remaining = 60;
    rateLimitState.used = 0;
    rateLimitState.reset = now + 60;
  }

  // If we're near the limit, wait until the window resets
  if (rateLimitState.remaining <= 5) {
    const waitMs = Math.max(0, (rateLimitState.reset - now) * 1000) + 100;
    await new Promise(resolve => setTimeout(resolve, waitMs));
    rateLimitState.remaining = 60;
    rateLimitState.used = 0;
    rateLimitState.reset = Date.now() / 1000 + 60;
  }
}

/**
 * Update rate limit state from Reddit response headers.
 */
function updateRateLimitFromHeaders(headers: Headers): void {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const used = headers.get('x-ratelimit-used');

  if (remaining !== null) {
    rateLimitState.remaining = parseFloat(remaining);
  }
  if (reset !== null) {
    rateLimitState.reset = Date.now() / 1000 + parseFloat(reset);
  }
  if (used !== null) {
    rateLimitState.used = parseInt(used, 10);
  }
}

/**
 * Get current rate limit state — for logging / diagnostics.
 */
export function getRateLimitState(): Readonly<RateLimitState> {
  return { ...rateLimitState };
}

// ============================================================================
// Reddit Data API client (oauth.reddit.com)
// ============================================================================

export async function redditGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  await waitForRateLimit();

  const token = await getAccessToken();
  const url = new URL(`${REDDIT_DATA_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });

  updateRateLimitFromHeaders(res.headers);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit API ${path} failed: ${res.status} — ${text}`);
  }

  return res.json() as Promise<T>;
}

// ============================================================================
// Reddit Ads API v3 client (ads-api.reddit.com)
// ============================================================================

export async function adsGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  await waitForRateLimit();

  const token = await getAccessToken();
  const url = new URL(`${REDDIT_ADS_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });

  updateRateLimitFromHeaders(res.headers);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit Ads API ${path} failed: ${res.status} — ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function adsPost<T>(path: string, body: unknown): Promise<T> {
  await waitForRateLimit();

  const token = await getAccessToken();

  const res = await fetch(`${REDDIT_ADS_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  updateRateLimitFromHeaders(res.headers);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit Ads API POST ${path} failed: ${res.status} — ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function adsPatch<T>(path: string, body: unknown): Promise<T> {
  await waitForRateLimit();

  const token = await getAccessToken();

  const res = await fetch(`${REDDIT_ADS_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  updateRateLimitFromHeaders(res.headers);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit Ads API PATCH ${path} failed: ${res.status} — ${text}`);
  }

  return res.json() as Promise<T>;
}
