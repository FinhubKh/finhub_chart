# FinHub Chart — Full GCP Stack Design

**Date:** 2026-10-09  
**Status:** Approved for planning  
**Approach:** B — Cloud SQL + Firebase Auth + Cloud Run API + Firebase Hosting (phased)

## Context

- Chart API already runs on **GCP Cloud Run** (`finhub-chart-api`, `asia-southeast1`, project `project-d0cd5eb1-dc1d-4138-ba9`).
- OHLC candles are on **Cloudflare R2** (keep for now).
- App data (auth, strategies, drawings, Pine, backtests) used **Supabase**. The configured project host `jqtxgolxlgdeucdnmxcy.supabase.co` returns **NXDOMAIN** — DB/auth is dead.
- Goal: move **DB + auth + (later) hosting** onto GCP so the stack is one vendor. Candles may move to GCS later; not required for v1.

## Architecture

```
Browser (Firebase Hosting later; Vercel OK in phase 1–3)
    │  Firebase Auth (ID token)
    ▼
Cloud Run API (finhub-chart-api)
    ├── public: health, candles, timeframes, instruments, engine list, backtest run
    └── authed: user strategies, drawings, pine, overlays, backtest history
            │
            ├── R2 (OHLC CSVs)
            └── Cloud SQL Postgres (via Cloud SQL connector / private IP)
```

**Rules:**

- Browser never connects to Postgres. Only Cloud Run does.
- Firebase Auth replaces Supabase Auth. `user_id` = Firebase UID (`text`).
- No Supabase client and no Postgres RLS. Ownership enforced in the API (`WHERE user_id = current_uid`).
- CORS remains restricted to known chart origins.

## Data model (Cloud SQL)

Same logical tables as `supabase/migrations/001_strategies.sql` and `002_pine_scripts.sql`, adapted for Firebase:

| Table | Purpose |
|--------|---------|
| `profiles` | `id` (Firebase UID, text PK), email, `created_at` |
| `strategies` | Named chart workspaces |
| `strategy_drawings` | One JSON payload per strategy |
| `backtest_runs` | Saved backtest results |
| `pine_scripts` | User Pine library |
| `strategy_pine_overlays` | Scripts attached to a strategy |
| `instruments` | Optional catalog; may stay hardcoded in API for v1 |

**Schema differences vs Supabase:**

- Drop FKs to `auth.users`; use `profiles(id)` or plain `user_id text`.
- Drop RLS policies and `auth.uid()`.
- Keep `jsonb` for drawings, engine params, and backtest results.
- Migrations live in-repo (e.g. `db/migrations/`) and apply via Cloud SQL / CI.

**Out of scope for SQL:** OHLC candle files (R2).

**Data migration:** Dead Supabase project has no recoverable DNS; start with a clean DB unless an offline dump exists.

## Auth + API surface

### Auth

- Firebase Authentication (Identity Platform-compatible): email/password; Google sign-in optional later.
- Web SDK obtains ID token; private API calls send `Authorization: Bearer <id_token>`.
- Cloud Run verifies the token (Firebase Admin / Google certs).
- On first authenticated request, upsert `profiles` from token claims (uid, email).

### Public routes (no token)

- `/api/health`
- `/api/instruments`
- `/api/timeframes`
- `/api/candles`
- `/api/range`
- `/api/strategies` (built-in engine catalog)
- `/api/backtest` (engine execution; may require auth in a later tightening)

### Private routes (token required)

Replace current Supabase client usage (`strategiesApi`, `pineApi`, drawings, backtest history):

- `GET/POST/PATCH/DELETE /api/user/strategies`
- Drawings, pine scripts, overlays, backtest history under `/api/user/...`

### Frontend

- Remove `@supabase/supabase-js` for app data.
- Login → Firebase Auth.
- Strategy/Pine APIs → `fetch` to Cloud Run with bearer token.
- Env: Firebase config + `VITE_API_URL` (Cloud Run URL). No `VITE_SUPABASE_*`.

### Security

- CORS locked to chart origins.
- Cloud SQL only reachable from Cloud Run.
- DB credentials only in Secret Manager / Cloud Run env — never in the browser.

## Deploy and operations

**GCP (same project/region as today):**

- Cloud SQL Postgres (small instance, `asia-southeast1`)
- Secret Manager: `DATABASE_URL` (and Firebase admin material if not file-mounted)
- Cloud Run: attach Cloud SQL connection; set Firebase project id
- Firebase project for Auth (and Hosting in a later phase)
- GitHub Actions: extend deploy-api (or add migrate job) to apply SQL migrations

**Failure modes:**

| Failure | Behavior |
|---------|----------|
| Cloud SQL down | Private `/api/user/*` → 503; public candle routes still work via R2 |
| Missing/expired token | 401 |
| Wrong user accessing row | 404 or 403 (prefer not leaking existence) |

## Phased rollout

1. **Infra + schema** — Create Cloud SQL, apply migrations, verify API connectivity.
2. **API private routes + Firebase verify** — Implement `/api/user/*`; stop depending on Supabase server-side.
3. **Web switch** — Firebase login + Cloud Run private APIs (frontend may remain on Vercel).
4. **Hosting** — Move site to Firebase Hosting; remove Supabase and unused Vercel projects when ready.
5. **Optional** — Move OHLC from R2 to GCS.

Redeploy the stale Cloud Run image (currently v1.0.0, Aug 2026) as part of phases 1–2 so multi-pair / instruments code ships with the DB work.

## Test plan

- Public: health, timeframes, candles (XAUUSD and at least one other pair after multi-pair deploy).
- Auth: sign up, sign in, token refresh.
- Private: create strategy, save drawings, list/save pine, save backtest run.
- Isolation: user A cannot read or mutate user B’s rows.
- Regression: chart load and replay still work without login.

## Non-goals (v1)

- Migrating historical Supabase rows (project unreachable).
- Putting OHLC into Postgres or Firestore.
- Replacing R2 with GCS before hosting migration.
- Firestore as primary app DB.
