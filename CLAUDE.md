# Cayenne — SALT Crew Reddit Marketing Intelligence Agent

Reddit marketing intelligence agent with AI-powered organic opportunity detection (agent loop) and Reddit Ads management for Inecta, a food & beverage ERP company.

## Stack

Next.js 15.5 (App Router) · React 18 · TypeScript · Tailwind CSS 4 · Supabase (AiEO project) · Claude Sonnet 4.5 · Reddit API · Reddit Ads API v3 · Vercel (Hobby plan) · Recharts · Framer Motion

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Health check — returns `{ status, agent, timestamp }` |
| `/api/status` | GET | Agent status — last run, active proposals, active campaigns |
| `/api/trigger` | POST | Manual trigger — runs main scan + agent loop |
| `/api/reddit-agent/run` | POST/GET | Cron 1 — Layer 1 scan + Layer 2 agent loop + ads performance sync |
| `/api/reddit-agent/digest` | POST/GET | Cron 2 — mini-scan + trend analysis + ad recommendation loop + daily digest |
| `/api/reddit-agent/decide` | POST | Approve/reject proposals (responses AND ads) |
| `/api/reddit-agent/overview` | GET | Dashboard overview data |
| `/api/reddit-agent/opportunities` | GET | List opportunities with filtering |
| `/api/reddit-agent/trends` | GET | Trend data for dashboard |
| `/api/reddit-agent/ads/create` | POST | Create campaign via Reddit Ads API |
| `/api/reddit-agent/ads/performance` | GET/POST | GET returns stored data; POST pulls fresh from Reddit |
| `/api/reddit-agent/ads/pause` | POST | Pause a campaign |
| `/api/reddit-agent/ads/resume` | POST | Resume a campaign |
| `/api/auth/reddit/callback` | GET | Reddit OAuth callback |

## Database Tables (AiEO Supabase project: zqvyaxexfbgyvebfnudz)

- `reddit_agent_config` — Agent configuration (key-value)
- `reddit_agent_reddit_auth` — Reddit OAuth tokens (single row, rotated on refresh)
- `reddit_agent_monitored_subreddits` — Which subreddits to watch (3 tiers)
- `reddit_agent_keywords` — Keyword lists with weights (high/medium/low/competitor)
- `reddit_agent_scanned_posts` — Every post fetched from Reddit (dedup registry)
- `reddit_agent_opportunities` — Scored and classified opportunities (with agent loop metadata)
- `reddit_agent_decision_queue` — Pending proposals for human approval
- `reddit_agent_change_log` — Audit trail of all actions (including agent investigations)
- `reddit_agent_notifications` — Alerts and messages
- `reddit_agent_guardrails` — Safety rules (frequency, content, freshness, quality, safety, ads, anti-drift)
- `reddit_agent_daily_digest` — End-of-day summaries
- `reddit_agent_trend_snapshots` — Topic/keyword trends over time
- `reddit_agent_ad_campaigns` — Campaign lifecycle tracking (linked to organic signals)
- `reddit_agent_ad_performance` — Daily performance data from Reddit Ads API
- `reddit_agent_ad_signal_correlation` — Tracks which organic signals produce best ad ROI

## Cron Schedule

| Schedule | Route | Description |
|----------|-------|-------------|
| `0 14 * * *` | `/api/reddit-agent/run` | 2 PM UTC — Layer 1 scan + Layer 2 agent loop (1 candidate) + ads performance sync |
| `0 22 * * *` | `/api/reddit-agent/digest` | 10 PM UTC — mini-scan + trends + ad recommendation loop + daily digest |

## Architecture

### Two-Layer Analysis
- **Layer 1** (deterministic): Keyword matching + scoring (0-100). Threshold: 40.
- **Layer 2** (agent loop): Claude investigates with 9 tools, max 8 calls, max 45s. Scores 0-100.
- **Combined score**: `(L1 * 0.3) + (L2 * 0.7)`

### Agent Loop Tools
| Tool | Purpose |
|------|---------|
| `read_post_comments` | Fetch comment thread |
| `check_user_history` | Get author's recent posts |
| `search_related_posts` | Find related scanned posts |
| `check_competitor_mentions` | Query competitor mentions |
| `get_active_campaigns` | Check running ad campaigns |
| `check_signal_bus` | Cross-agent intelligence |
| `evaluate_draft` | Validate draft against guardrails |
| `submit_opportunity` | **Terminal** — submit opportunity |
| `skip_opportunity` | **Terminal** — skip with reason |

### Closed-Loop Correlation
Organic signals → ad recommendations → performance tracking → ROI correlation → smarter future recommendations.

## Standard Endpoints

- `GET /api/health` — Returns `{ status: "healthy", agent: "cayenne" }`
- `GET /api/status` — Returns `{ agent, lastRun, lastAction, activeProposals, activeCampaigns, status }`
- `POST /api/trigger` — Manually triggers main scan + agent loop

## Signal Bus Events

Cayenne writes to `shared_agent_signals` with `source_agent: 'cayenne'`:

| Event Type | Trigger |
|---|---|
| `reddit_opportunity_found` | High-scoring opportunity (combined >= 70) |
| `reddit_response_drafted` | New response ready for review |
| `reddit_trending_topic` | Topic frequency spikes above baseline |
| `reddit_competitor_mention` | Competitor mentioned 3+ times in a day |
| `reddit_scan_complete` | Scan finished |
| `reddit_digest_complete` | Digest finished |
| `reddit_ad_recommended` | Ad recommendation generated |
| `reddit_ad_performance` | Campaign performance update |
| `reddit_ad_created` | Campaign created via Reddit Ads API |
| `reddit_ad_auto_paused` | Campaign auto-paused by CPC guardrail |

## Key Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Environment Variables

```bash
NEXT_PUBLIC_AIEO_SUPABASE_URL=      # AiEO Supabase project URL
NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY= # AiEO anon key (browser-side auth)
AIEO_SUPABASE_SERVICE_KEY=          # Service role key (server-side)
REDDIT_APP_ID=                      # Reddit OAuth2 app ID
REDDIT_APP_SECRET=                  # Reddit OAuth2 app secret
REDDIT_REDIRECT_URI=                # OAuth callback URL
ANTHROPIC_API_KEY=                  # Claude API key
CRON_SECRET=                        # Vercel cron auth token
```

## Conventions

- This agent is part of the SALT Crew network. See Saffron repo for shared patterns.
- Cayenne reads/writes to the same AiEO Supabase project as Saffron — no separate database.
- All tables prefixed `reddit_agent_*`, always scoped by subreddit context.
- `maxDuration = 120` on all API routes (Vercel Hobby plan ceiling).
- Reddit API: native `fetch()`, zero SDK dependencies. Rate limited at 60 req/min (shared across L1 scan + agent loop).
- Reddit tokens rotate on every refresh — stored in Supabase, NOT env vars.
- Cookie-based SSO on `.inecta-salt.com` domain (shared with SALT hub and Saffron).
- Responses NEVER mention Inecta by name. Human approval required for all actions.
- Agent loop defaults to 1 candidate per cron run (tunable after observing execution times).
- Claude prompts return strict JSON — use `parseClaudeJson()` if needed.

## Gotchas

- **ESLint = build-breaking**: Vercel treats lint warnings as errors. Always `npm run lint` before push.
- **Hobby plan limits**: Max 2 crons (both used), 120s function timeout.
- **Reddit token rotation**: Refresh tokens become invalid after one use. Must store the new token immediately.
- **Shared rate limiter**: Agent loop tools and L1 scan share the same 60 req/min budget in `client.ts`.
- **Decision queue expiry**: 48 hours. Visual warning at 24h in the dashboard.
- **Reddit Ads API v3**: Base URL `ads-api.reddit.com/api/v3`. Budgets in cents. $5/day minimum.
- **Dashboard is single-file**: ~900 lines. Handle with care.
- **No database migrations tool**: Schema changes are manual SQL. Check `sql/` for history.
- **`campaigns: []` TypeScript trap**: Empty arrays infer `never[]`. Always cast: `[] as string[]`.
