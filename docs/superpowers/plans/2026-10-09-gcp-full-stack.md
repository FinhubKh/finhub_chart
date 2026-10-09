# GCP Full Stack (Cloud SQL + Firebase Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dead Supabase auth/DB with Firebase Auth + Cloud SQL Postgres behind Cloud Run, then switch the web app and (later) host on Firebase Hosting.

**Architecture:** Browser uses Firebase Auth for ID tokens. Cloud Run verifies tokens and owns all Postgres access via Cloud SQL. Public candle routes keep using R2. No browser→DB. Ownership checks live in the API, not RLS.

**Tech Stack:** Cloud SQL Postgres, Firebase Auth, FastAPI, `asyncpg` or `psycopg[binary]`, Firebase Admin (Python), Firebase JS SDK, Vite/React, existing Cloud Run + GitHub Actions deploy.

**Spec:** `docs/superpowers/specs/2026-10-09-gcp-full-stack-design.md`

**Out of scope for this plan:** Moving OHLC from R2 to GCS (spec phase 5).

---

## File map

| Path | Responsibility |
|------|----------------|
| `db/migrations/001_app_schema.sql` | Cloud SQL schema (Firebase UID text keys) |
| `api/app/db.py` | Connection pool + helpers |
| `api/app/auth_firebase.py` | Verify Bearer ID token; upsert profile |
| `api/app/user_routes.py` | Private `/api/user/*` CRUD |
| `api/app/main.py` | Mount routers; keep public candle routes |
| `api/requirements.txt` | Add postgres + firebase-admin + pytest deps |
| `api/tests/test_auth_dependency.py` | Token verify / 401 behavior (mocked) |
| `api/tests/test_user_strategies.py` | Ownership filtering (mocked DB) |
| `.github/workflows/deploy-api.yml` | Cloud SQL attach, secrets, Firebase env, drop `R2_PREFIX` |
| `web/src/lib/firebase.ts` | Firebase app + Auth client |
| `web/src/lib/auth.tsx` | Replace Supabase session with Firebase user + `getIdToken` |
| `web/src/lib/apiAuth.ts` | `authFetch` helper attaching Bearer token |
| `web/src/lib/strategiesApi.ts` | Call Cloud Run `/api/user/...` |
| `web/src/lib/pineApi.ts` | Same for pine/overlays |
| `web/src/lib/supabase.ts` | Delete after cutover |
| `web/package.json` | Add `firebase`; remove `@supabase/supabase-js` |
| `web/.env.example` | Firebase + `VITE_API_URL` (no Supabase) |
| `web/firebase.json` / `.firebaserc` | Hosting config (Task 10) |

---

### Task 1: Cloud SQL schema migration file

**Files:**
- Create: `db/migrations/001_app_schema.sql`

- [ ] **Step 1: Add migration SQL**

```sql
-- FinHub Chart app schema for Cloud SQL + Firebase Auth UIDs (text).
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id text primary key,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  name text not null,
  pair text not null default 'XAUUSD',
  tf text not null default '1H',
  notes text,
  engine text,
  engine_params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists strategies_user_id_updated_at_idx
  on public.strategies (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strategies_set_updated_at on public.strategies;
create trigger strategies_set_updated_at
  before update on public.strategies
  for each row execute function public.set_updated_at();

create table if not exists public.strategy_drawings (
  strategy_id uuid primary key references public.strategies (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists strategy_drawings_set_updated_at on public.strategy_drawings;
create trigger strategy_drawings_set_updated_at
  before update on public.strategy_drawings
  for each row execute function public.set_updated_at();

create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  engine text not null,
  params jsonb not null default '{}'::jsonb,
  tf text not null,
  start_at timestamptz,
  end_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists backtest_runs_strategy_created_at_idx
  on public.backtest_runs (strategy_id, created_at desc);

create table if not exists public.pine_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  name text not null,
  source text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pine_scripts_user_id_updated_at_idx
  on public.pine_scripts (user_id, updated_at desc);

drop trigger if exists pine_scripts_set_updated_at on public.pine_scripts;
create trigger pine_scripts_set_updated_at
  before update on public.pine_scripts
  for each row execute function public.set_updated_at();

create table if not exists public.strategy_pine_overlays (
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  script_id uuid not null references public.pine_scripts (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (strategy_id, script_id)
);

create index if not exists strategy_pine_overlays_user_id_idx
  on public.strategy_pine_overlays (user_id);
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/001_app_schema.sql
git commit -m "Add Cloud SQL schema migration for Firebase UID ownership."
```

---

### Task 2: Provision Cloud SQL + Firebase (manual GCP)

**Files:** none (ops). Document outcomes in `docs/superpowers/plans/notes-gcp-ids.md` only if needed for the team; prefer GitHub vars/secrets.

- [ ] **Step 1: Create Cloud SQL instance** (project `project-d0cd5eb1-dc1d-4138-ba9`, region `asia-southeast1`)

```bash
gcloud config set project project-d0cd5eb1-dc1d-4138-ba9

gcloud sql instances create finhub-chart-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-southeast1 \
  --storage-size=10GB \
  --storage-auto-increase \
  --availability-type=zonal

gcloud sql databases create finhubkh --instance=finhub-chart-db

gcloud sql users create finhub \
  --instance=finhub-chart-db \
  --password='GENERATE_A_STRONG_PASSWORD'
```

- [ ] **Step 2: Store connection secret**

Use Unix socket form for Cloud Run:

`postgresql://finhub:PASSWORD@/finhubkh?host=/cloudsql/project-d0cd5eb1-dc1d-4138-ba9:asia-southeast1:finhub-chart-db`

```bash
echo -n 'postgresql://finhub:PASSWORD@/finhubkh?host=/cloudsql/project-d0cd5eb1-dc1d-4138-ba9:asia-southeast1:finhub-chart-db' \
  | gcloud secrets create DATABASE_URL --data-file=-
# or: gcloud secrets versions add DATABASE_URL --data-file=-
```

Grant runtime SA access:

```bash
gcloud secrets add-iam-policy-binding DATABASE_URL \
  --member="serviceAccount:finhub-chart-api-sa@project-d0cd5eb1-dc1d-4138-ba9.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding project-d0cd5eb1-dc1d-4138-ba9 \
  --member="serviceAccount:finhub-chart-api-sa@project-d0cd5eb1-dc1d-4138-ba9.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

- [ ] **Step 3: Apply migration** (Cloud SQL Studio, or)

```bash
gcloud sql connect finhub-chart-db --user=finhub --database=finhubkh < db/migrations/001_app_schema.sql
```

- [ ] **Step 4: Create Firebase project + enable Email/Password Auth**

In Firebase console (or `firebase projects:create`), enable Authentication → Email/Password. Note `projectId`, web `apiKey`, `authDomain`, `appId`.

Add GitHub Actions variable later: `FIREBASE_PROJECT_ID`.

- [ ] **Step 5: Commit nothing required** — if you captured IDs in a non-secret doc, commit that; never commit passwords or API keys.

---

### Task 3: API DB pool + pytest harness

**Files:**
- Create: `api/app/db.py`
- Create: `api/tests/conftest.py`
- Create: `api/tests/test_db_url.py`
- Modify: `api/requirements.txt`
- Modify: `api/Dockerfile` (ensure `COPY` includes nothing secret; tests run in CI from repo)

- [ ] **Step 1: Add dependencies**

Append to `api/requirements.txt`:

```
psycopg[binary,pool]==3.2.6
firebase-admin==6.7.0
httpx==0.28.1
pytest==8.3.5
```

- [ ] **Step 2: Write failing test for DATABASE_URL parsing**

Create `api/tests/test_db_url.py`:

```python
import os
from app.db import database_url


def test_database_url_reads_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@/db?host=/cloudsql/x")
    assert database_url() == "postgresql://u:p@/db?host=/cloudsql/x"


def test_database_url_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert database_url() is None
```

- [ ] **Step 3: Run test — expect fail**

```bash
cd api && PYTHONPATH=. pytest tests/test_db_url.py -v
```

Expected: `ModuleNotFoundError` or import error for `app.db`.

- [ ] **Step 4: Implement `api/app/db.py`**

```python
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def database_url() -> str | None:
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    return raw or None


def init_pool() -> ConnectionPool | None:
    global _pool
    url = database_url()
    if not url:
        _pool = None
        return None
    if _pool is None:
        _pool = ConnectionPool(url, min_size=1, max_size=5, kwargs={"row_factory": dict_row})
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connect() -> Iterator:
    pool = init_pool()
    if pool is None:
        raise RuntimeError("DATABASE_URL is not configured")
    with pool.connection() as conn:
        yield conn
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd api && pip install -r requirements.txt && PYTHONPATH=. pytest tests/test_db_url.py -v
```

Expected: PASS

- [ ] **Step 6: Wire lifespan in `api/app/main.py`**

At top, import `close_pool`, `init_pool`. Add:

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_pool()
    yield
    close_pool()

# change FastAPI(...) to include lifespan=lifespan
```

Keep existing routes. Do not remove candle endpoints.

- [ ] **Step 7: Commit**

```bash
git add api/requirements.txt api/app/db.py api/app/main.py api/tests
git commit -m "Add Cloud SQL connection pool and pytest harness."
```

---

### Task 4: Firebase token verification dependency

**Files:**
- Create: `api/app/auth_firebase.py`
- Create: `api/tests/test_auth_dependency.py`

- [ ] **Step 1: Write failing tests**

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.auth_firebase import require_user, AuthedUser


def test_missing_bearer_returns_401(monkeypatch):
    app = FastAPI()

    @app.get("/x")
    def x(user: AuthedUser = __import__("fastapi").Depends(require_user)):
        return {"uid": user.uid}

    client = TestClient(app)
    assert client.get("/x").status_code == 401


def test_valid_token_injects_user(monkeypatch):
    from app import auth_firebase

    def fake_verify(token: str):
        assert token == "good"
        return AuthedUser(uid="uid-1", email="a@b.com")

    monkeypatch.setattr(auth_firebase, "verify_id_token", fake_verify)

    app = FastAPI()

    @app.get("/x")
    def x(user: AuthedUser = __import__("fastapi").Depends(require_user)):
        return {"uid": user.uid, "email": user.email}

    client = TestClient(app)
    r = client.get("/x", headers={"Authorization": "Bearer good"})
    assert r.status_code == 200
    assert r.json() == {"uid": "uid-1", "email": "a@b.com"}
```

- [ ] **Step 2: Run — expect fail**

```bash
cd api && PYTHONPATH=. pytest tests/test_auth_dependency.py -v
```

- [ ] **Step 3: Implement `api/app/auth_firebase.py`**

```python
from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)
_firebase_ready = False


@dataclass(frozen=True)
class AuthedUser:
    uid: str
    email: str | None


def _ensure_firebase() -> None:
    global _firebase_ready
    if _firebase_ready:
        return
    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        # On Cloud Run / GCP: Application Default Credentials
        # Locally: set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON
        project_id = (os.environ.get("FIREBASE_PROJECT_ID") or "").strip() or None
        firebase_admin.initialize_app(
            credentials.ApplicationDefault(),
            options={"projectId": project_id} if project_id else None,
        )
    _firebase_ready = True


def verify_id_token(token: str) -> AuthedUser:
    _ensure_firebase()
    from firebase_admin import auth as fb_auth

    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e
    uid = decoded.get("uid") or decoded.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token claims")
    return AuthedUser(uid=str(uid), email=decoded.get("email"))


def require_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthedUser:
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return verify_id_token(creds.credentials)
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd api && PYTHONPATH=. pytest tests/test_auth_dependency.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/app/auth_firebase.py api/tests/test_auth_dependency.py
git commit -m "Add Firebase ID token verification for private API routes."
```

---

### Task 5: Profile upsert + user strategy routes

**Files:**
- Create: `api/app/user_routes.py`
- Create: `api/tests/test_user_strategies.py`
- Modify: `api/app/main.py` (include router)

- [ ] **Step 1: Write ownership test with mocked connect**

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.auth_firebase import AuthedUser
from app import user_routes


class FakeConn:
    def __init__(self):
        self.rows = [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "user_id": "uid-1",
                "name": "Mine",
                "pair": "XAUUSD",
                "tf": "1H",
                "notes": None,
                "engine": None,
                "engine_params": {},
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ]

    def execute(self, query, params=None):
        class R:
            def __init__(self, rows):
                self._rows = rows

            def fetchall(self):
                return self._rows

            def fetchone(self):
                return self._rows[0] if self._rows else None

        if "from public.strategies" in query.lower() and "user_id" in query.lower():
            uid = params[0] if params else None
            return R([r for r in self.rows if r["user_id"] == uid])
        return R([])


def test_list_strategies_scoped_to_user(monkeypatch):
    fake = FakeConn()

    class CM:
        def __enter__(self):
            return fake

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(user_routes, "connect", lambda: CM())
    monkeypatch.setattr(
        user_routes,
        "require_user",
        lambda: AuthedUser(uid="uid-1", email="a@b.com"),
    )
    # Also stub ensure_profile no-op
    monkeypatch.setattr(user_routes, "ensure_profile", lambda user: None)

    app = FastAPI()
    app.include_router(user_routes.router)
    # Override Depends
    app.dependency_overrides[user_routes.require_user] = lambda: AuthedUser(
        uid="uid-1", email="a@b.com"
    )

    client = TestClient(app)
    r = client.get("/api/user/strategies", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    data = r.json()["strategies"]
    assert len(data) == 1
    assert data[0]["name"] == "Mine"
```

Adjust the fake if implementation uses `with connect() as conn:` and `conn.execute` differently — keep the test asserting **only uid-1 rows** are returned.

- [ ] **Step 2: Run — expect fail** (module missing)

- [ ] **Step 3: Implement `api/app/user_routes.py`**

Minimum surface (expand pine/drawings/backtests in same file in this task):

```python
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth_firebase import AuthedUser, require_user
from .db import connect

router = APIRouter(prefix="/api/user", tags=["user"])


def ensure_profile(user: AuthedUser) -> None:
    with connect() as conn:
        conn.execute(
            """
            insert into public.profiles (id, email)
            values (%s, %s)
            on conflict (id) do update set email = excluded.email
            """,
            (user.uid, user.email),
        )
        conn.commit()


class StrategyCreate(BaseModel):
    name: str
    pair: str = "XAUUSD"
    tf: str = "1H"
    notes: str | None = None
    engine: str | None = None
    engine_params: dict[str, float] = Field(default_factory=dict)


class StrategyPatch(BaseModel):
    name: str | None = None
    pair: str | None = None
    tf: str | None = None
    notes: str | None = None
    engine: str | None = None
    engine_params: dict[str, float] | None = None


@router.get("/strategies")
def list_strategies(user: AuthedUser = Depends(require_user)):
    ensure_profile(user)
    with connect() as conn:
        rows = conn.execute(
            """
            select id, user_id, name, pair, tf, notes, engine, engine_params,
                   created_at, updated_at
            from public.strategies
            where user_id = %s
            order by updated_at desc
            """,
            (user.uid,),
        ).fetchall()
    return {"strategies": rows}


@router.post("/strategies")
def create_strategy(body: StrategyCreate, user: AuthedUser = Depends(require_user)):
    ensure_profile(user)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name required")
    with connect() as conn:
        row = conn.execute(
            """
            insert into public.strategies
              (user_id, name, pair, tf, notes, engine, engine_params)
            values (%s, %s, %s, %s, %s, %s, %s::jsonb)
            returning id, user_id, name, pair, tf, notes, engine, engine_params,
                      created_at, updated_at
            """,
            (
                user.uid,
                name,
                body.pair,
                body.tf,
                body.notes,
                body.engine,
                json.dumps(body.engine_params),
            ),
        ).fetchone()
        conn.commit()
    return row


@router.patch("/strategies/{strategy_id}")
def patch_strategy(
    strategy_id: UUID, body: StrategyPatch, user: AuthedUser = Depends(require_user)
):
    ensure_profile(user)
    fields: list[str] = []
    values: list[Any] = []
    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        if key == "engine_params":
            fields.append("engine_params = %s::jsonb")
            values.append(json.dumps(val))
        else:
            fields.append(f"{key} = %s")
            values.append(val)
    if not fields:
        raise HTTPException(400, "empty patch")
    values.extend([str(strategy_id), user.uid])
    with connect() as conn:
        row = conn.execute(
            f"""
            update public.strategies
            set {", ".join(fields)}
            where id = %s and user_id = %s
            returning id
            """,
            values,
        ).fetchone()
        if not row:
            raise HTTPException(404, "strategy not found")
        conn.commit()
    return {"ok": True}


@router.delete("/strategies/{strategy_id}")
def delete_strategy(strategy_id: UUID, user: AuthedUser = Depends(require_user)):
    ensure_profile(user)
    with connect() as conn:
        row = conn.execute(
            "delete from public.strategies where id = %s and user_id = %s returning id",
            (str(strategy_id), user.uid),
        ).fetchone()
        if not row:
            raise HTTPException(404, "strategy not found")
        conn.commit()
    return {"ok": True}
```

Also add in the same file (same patterns: always `and user_id = %s`):

- `GET/PUT /strategies/{id}/drawings`
- `GET/POST/PATCH/DELETE /pine-scripts` and overlay upsert/delete
- `GET/POST /strategies/{id}/backtest-runs`

Match field names to `web/src/lib/database.types.ts` (`StrategyRow`, etc.).

- [ ] **Step 4: Mount router in `main.py`**

```python
from .user_routes import router as user_router
app.include_router(user_router)
```

- [ ] **Step 5: Fix tests until green**

```bash
cd api && PYTHONPATH=. pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add api/app/user_routes.py api/app/main.py api/tests/test_user_strategies.py
git commit -m "Add private /api/user routes backed by Cloud SQL."
```

---

### Task 6: Ship multi-pair API fixes with deploy config

**Files:**
- Modify: existing local changes under `api/app/*` (instruments, storage keys without `R2_PREFIX`)
- Modify: `.github/workflows/deploy-api.yml`
- Modify: `api/Dockerfile` if needed for deps

- [ ] **Step 1: Ensure deploy workflow attaches Cloud SQL and secrets**

Update Deploy step env/secrets to include (keep R2 secrets; **do not** set `R2_PREFIX`):

```yaml
--add-cloudsql-instances="${PROJECT_ID}:${REGION}:finhub-chart-db" \
--set-env-vars="^|^FINHUB_DATA_SOURCE=r2|APP_ROOT=/app|FIREBASE_PROJECT_ID=${{ vars.FIREBASE_PROJECT_ID }}|CORS_ORIGINS=https://chart.finhubkh.com,https://finhub-chart-sigma.vercel.app" \
--set-secrets="R2_ACCOUNT_ID=R2_ACCOUNT_ID:latest,R2_ACCESS_KEY_ID=R2_ACCESS_KEY_ID:latest,R2_SECRET_ACCESS_KEY=R2_SECRET_ACCESS_KEY:latest,R2_BUCKET=R2_BUCKET:latest,R2_ENDPOINT=R2_ENDPOINT:latest,DATABASE_URL=DATABASE_URL:latest"
```

Also trigger on `db/**` path if you add a migrate step later; for now document that schema is applied manually in Task 2.

- [ ] **Step 2: After merge/push, verify**

```bash
curl -sS "$URL/api/health"
curl -sS "$URL/api/instruments"   # expect 200 after multi-pair ship
# private without token:
curl -sS -o /dev/null -w "%{http_code}\n" "$URL/api/user/strategies"  # expect 401
```

- [ ] **Step 3: Commit API + workflow**

```bash
git add api .github/workflows/deploy-api.yml
git commit -m "Deploy Cloud SQL-backed API and drop R2_PREFIX for multi-pair paths."
```

---

### Task 7: Firebase web client + auth context

**Files:**
- Create: `web/src/lib/firebase.ts`
- Modify: `web/src/lib/auth.tsx`
- Modify: `web/package.json`
- Modify: `web/.env.example`
- Modify: `web/src/vite-env.d.ts`
- Modify: `web/src/components/LoginPage.tsx` (copy that mentions Supabase)
- Modify: `web/src/components/ProtectedRoute.tsx`

- [ ] **Step 1: Install firebase**

```bash
cd web && npm install firebase && npm uninstall @supabase/supabase-js
```

- [ ] **Step 2: Create `web/src/lib/firebase.ts`**

```typescript
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
}

export { app, auth };
```

- [ ] **Step 3: Rewrite `web/src/lib/auth.tsx`** to use `onAuthStateChanged`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signOut` from `firebase/auth`. Expose:

```typescript
type AuthContextValue = {
  ready: boolean;
  configured: boolean;
  user: { uid: string; email: string | null } | null;
  getIdToken: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
```

Remove Supabase `Session` types. `configured` ← `firebaseConfigured`.

- [ ] **Step 4: Update LoginPage / ProtectedRoute strings** to say Firebase env vars (`VITE_FIREBASE_*`).

- [ ] **Step 5: Update `.env.example` and `vite-env.d.ts`**

```env
VITE_API_URL=https://finhub-chart-api-oe2fht4xda-as.a.run.app
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 6: Build**

```bash
cd web && npm run build
```

Expected: TypeScript compile succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/firebase.ts web/src/lib/auth.tsx \
  web/src/components/LoginPage.tsx web/src/components/ProtectedRoute.tsx \
  web/.env.example web/src/vite-env.d.ts
git commit -m "Switch web auth from Supabase to Firebase Auth."
```

---

### Task 8: Point strategies/pine APIs at Cloud Run

**Files:**
- Create: `web/src/lib/apiAuth.ts`
- Modify: `web/src/lib/strategiesApi.ts`
- Modify: `web/src/lib/pineApi.ts`
- Modify: callers that passed `userId` into create/save if token now implies user
- Delete: `web/src/lib/supabase.ts` when unused

- [ ] **Step 1: Add `apiAuth.ts`**

```typescript
import { auth } from "./firebase";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!auth?.currentUser) throw new Error("Not signed in");
  const token = await auth.currentUser.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || res.statusText);
  }
  return res;
}
```

- [ ] **Step 2: Rewrite `listStrategies` example**

```typescript
export async function listStrategies(): Promise<StrategyRow[]> {
  const res = await authFetch("/api/user/strategies");
  const data = await res.json();
  return data.strategies as StrategyRow[];
}
```

Mirror for create/update/delete/drawings/backtests and all of `pineApi.ts` using `/api/user/pine-scripts` and overlay paths matching Task 5.

- [ ] **Step 3: Grep and remove supabase imports**

```bash
rg "supabase" web/src
```

Expected: no matches (except maybe comments). Delete `web/src/lib/supabase.ts`.

- [ ] **Step 4: Manual smoke** (local API with `DATABASE_URL` + Firebase emulator optional, or staging Cloud Run)

1. Sign up on web  
2. Create strategy  
3. Save drawings  
4. Confirm row in Cloud SQL  

- [ ] **Step 5: Commit**

```bash
git add web/src/lib
git commit -m "Route strategy and pine APIs through Cloud Run with Firebase tokens."
```

---

### Task 9: Production env cutover (Vercel still hosting)

**Files:** none (ops)

- [ ] **Step 1: Set Vercel env for production**

`VITE_API_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Remove `VITE_SUPABASE_*`.

- [ ] **Step 2: Set GitHub var `FIREBASE_PROJECT_ID`**

- [ ] **Step 3: Redeploy web + confirm**

```bash
curl -sS https://chart.finhubkh.com/assets/$(curl -sS https://chart.finhubkh.com | sed -n 's/.*src="\/assets\/\([^"]*\.js\)".*/\1/p') \
  | grep -o 'run\.app' | head -1
```

Expected: Cloud Run host present in bundle (or relative API if you intentionally proxy — prefer absolute `VITE_API_URL`).

- [ ] **Step 4: No commit** unless env example docs changed.

---

### Task 10: Firebase Hosting (spec phase 4)

**Files:**
- Create: `web/firebase.json`
- Create: `web/.firebaserc`
- Optional: GitHub workflow `deploy-web.yml`

- [ ] **Step 1: Init hosting**

```bash
cd web
npx firebase-tools login
npx firebase use --add   # select Firebase project
```

`firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "/assets/**",
        "headers": [{ "key": "Cache-Control", "value": "public,max-age=31536000,immutable" }]
      }
    ]
  }
}
```

- [ ] **Step 2: Build and deploy**

```bash
cd web && npm run build && npx firebase deploy --only hosting
```

- [ ] **Step 3: Point `chart.finhubkh.com` DNS to Firebase Hosting; add origin to Cloud Run `CORS_ORIGINS`**

- [ ] **Step 4: Commit hosting config**

```bash
git add web/firebase.json web/.firebaserc
git commit -m "Add Firebase Hosting config for the chart web app."
```

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| Cloud SQL schema (Firebase UIDs) | 1–2 |
| Cloud Run ↔ Cloud SQL | 2, 3, 6 |
| Firebase Auth verify on API | 4–5 |
| Private `/api/user/*` | 5 |
| Public candles stay on R2 | 5–6 (unchanged public routes) |
| Web Firebase login | 7 |
| strategies/pine via API | 8 |
| Vercel cutover | 9 |
| Firebase Hosting | 10 |
| Drop R2_PREFIX / redeploy stale API | 6 |
| GCS OHLC move | Explicitly out of scope |

## Self-review notes

- No TBD placeholders in task steps.
- Route prefix consistently `/api/user/...`.
- `AuthedUser.uid` / `profiles.id` are `text` everywhere.
- Tests mock Firebase and DB; live GCP steps are Task 2/9/10.
