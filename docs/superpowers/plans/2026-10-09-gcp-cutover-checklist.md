# GCP cutover checklist (manual ops)

Companion to `2026-10-09-gcp-full-stack.md` — **Task 2** (provision Cloud SQL + Firebase) and **Task 9** (production env on Vercel). No secrets in this doc.

---

## Task 2: Cloud SQL + Firebase

### Cloud SQL

- [ ] **Enable APIs** (if not already):

```bash
gcloud config set project project-d0cd5eb1-dc1d-4138-ba9

gcloud services enable sqladmin.googleapis.com secretmanager.googleapis.com
```

- [ ] **Create instance** (region `asia-southeast1`):

```bash
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

- [ ] **Apply schema** from repo root:

```bash
gcloud sql connect finhub-chart-db --user=finhub --database=finhubkh < db/migrations/001_app_schema.sql
```

(Alternatively: Cloud SQL Studio → run `db/migrations/001_app_schema.sql`.)

- [ ] **`DATABASE_URL` secret** (Unix socket form for Cloud Run):

`postgresql://finhub:PASSWORD@/finhubkh?host=/cloudsql/project-d0cd5eb1-dc1d-4138-ba9:asia-southeast1:finhub-chart-db`

```bash
echo -n 'postgresql://finhub:PASSWORD@/finhubkh?host=/cloudsql/project-d0cd5eb1-dc1d-4138-ba9:asia-southeast1:finhub-chart-db' \
  | gcloud secrets create DATABASE_URL --data-file=-
# or: gcloud secrets versions add DATABASE_URL --data-file=-
```

- [ ] **Grant Cloud Run runtime SA**:

```bash
gcloud secrets add-iam-policy-binding DATABASE_URL \
  --member="serviceAccount:finhub-chart-api-sa@project-d0cd5eb1-dc1d-4138-ba9.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding project-d0cd5eb1-dc1d-4138-ba9 \
  --member="serviceAccount:finhub-chart-api-sa@project-d0cd5eb1-dc1d-4138-ba9.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

### Firebase

- [ ] Create or link a Firebase project (placeholder in repo: `finhubkh-chart` in `web/.firebaserc` — change to your real project ID).
- [ ] Firebase console → **Authentication** → Sign-in method → enable **Email/Password**.
- [ ] Project settings → General → Web app → copy:
  - `apiKey` → `VITE_FIREBASE_API_KEY`
  - `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`
  - `projectId` → `VITE_FIREBASE_PROJECT_ID`
  - `appId` → `VITE_FIREBASE_APP_ID`
- [ ] GitHub repository → **Settings → Secrets and variables → Actions → Variables**: set `FIREBASE_PROJECT_ID` to the Firebase `projectId` (for API deploy workflow).

---

## Task 9: Vercel production env (web still on Vercel)

- [ ] **Vercel** → project → Settings → Environment Variables (Production):

| Variable | Action |
|----------|--------|
| `VITE_API_URL` | Set to Cloud Run API URL (e.g. `https://finhub-chart-api-….run.app`) |
| `VITE_FIREBASE_API_KEY` | Set from Firebase web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Set |
| `VITE_FIREBASE_PROJECT_ID` | Set |
| `VITE_FIREBASE_APP_ID` | Set |
| `VITE_SUPABASE_*` | **Remove** (dead after cutover) |

- [ ] **GitHub**: confirm `FIREBASE_PROJECT_ID` variable matches Firebase (see Task 2).

- [ ] **Redeploy** the web app on Vercel (production).

### Post-deploy checks

- [ ] **API bundle points at Cloud Run** (expects `run.app` in the built JS):

```bash
curl -sS https://chart.finhubkh.com/assets/$(curl -sS https://chart.finhubkh.com | sed -n 's/.*src="\/assets\/\([^"]*\.js\)".*/\1/p') \
  | grep -o 'run\.app' | head -1
```

- [ ] **Public health** (adjust host if different):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "https://finhub-chart-api-oe2fht4xda-as.a.run.app/health"
```

Expected: `200` (or your API’s health path).

- [ ] **Smoke test in browser**: sign in with email/password, open Strategies — data loads via Bearer token to `/api/user/*`.

---

## Later: Firebase Hosting (Task 10 config only in repo)

Hosting config lives in `web/firebase.json` and `web/.firebaserc`. Deploy manually when ready:

```bash
cd web && npm run build && npx firebase deploy --only hosting
```

Then point `chart.finhubkh.com` DNS to Firebase Hosting and add that origin to Cloud Run `CORS_ORIGINS`.
