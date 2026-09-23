# MOIL Intelligence — Production Deployment Guide

*Audience: MOIL IT / NIC engineers deploying the system beyond the SIH prototype.
Everything below was verified against the running prototype; the two steps that
cannot be exercised inside the hackathon sandbox (Docker build, Postgres cutover)
are marked and are standard procedures.*

---

## 1. What ships today

| Component | State | Notes |
|---|---|---|
| Next.js 16 dashboard (5 tabs + Scenario Lab) | ✅ running | validated, cached, rate-limited APIs |
| Module A artifacts | ✅ persisted | `models/prospectivity/` — sha256 registry, 5-model honest leaderboard (LightGBM 0.9023 champion) |
| Module B + risk bands | ✅ running | Ridge R² 0.928, per-mine conformal P10–P90, coverage 79.2%/80% |
| RBAC auth | ✅ running | scrypt hashes, HMAC-signed HttpOnly cookie, roles admin/officer/viewer, `/login` |
| ERP ingestion connector | ✅ running | `POST /api/ingest/production` (session-gated, upsert, audited) + `GET /api/ingest/spec` |
| Field-validation loop | ✅ running | `POST/GET /api/prospectivity/feedback` + UI panel on the map tab |
| Drift monitor | ✅ running | `GET /api/drift` (PSI, live from warehouse) + Model Health card |
| Tests / CI | ✅ green | 28 TS tests, 19 Python artifact tests, GitHub Actions `.github/workflows/ci.yml` |
| Docker packaging | ✅ files ready | `Dockerfile`, `docker-compose.yml`, `.env.example` (⚠️ build not executable in the hackathon sandbox — standard `docker build` on any host) |
| Postgres path | ✅ prepared | compose `--profile pg` + §3 migration steps (⚠️ cutover to be run at MOIL/NIC) |
| Prithvi-EO-2.0 fine-tune | 📋 documented | GPU-required; exact TerraTorch commands in §5 — honest scope: the sandbox has no GPU, the leaderboard's neural baseline (MLP AUC 0.8795) is real |

## 2. Deploy (SQLite pilot — single node)

```bash
cp .env.example .env          # set SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build  # app + volume on :3000
curl http://localhost:3000/api/health   # expect status:healthy
```

First boot runs `prisma db push` automatically. Seed users exist with demo
passwords — **change them on day one**:

```bash
# Inside the container, generate a scrypt hash:
bun -e 'import {hashPassword} from "./src/lib/auth"; console.log(hashPassword("NEW_PASSWORD"))'
# Then update the row (or re-run seed with new passwords):
sqlite3 /app/db/custom.db "UPDATE User SET passwordHash='<hash>' WHERE email='admin@moil.gov.in';"
```

Demo accounts: `admin@moil.gov.in` · `geologist@moil.gov.in` (officer) ·
`viewer@moil.gov.in` — passwords in `prisma/seed.ts` §10.

## 3. Postgres cutover (production)

1. `docker compose --profile pg up -d` (adds Postgres 16 + volume).
2. In `prisma/schema.prisma` change `provider = "sqlite"` → `"postgresql"`.
3. `DATABASE_URL=postgresql://moil_app:***@postgres:5432/moil`.
4. `bunx prisma db push` (fresh) — or migrate data: `sqlite3 db/custom.db .dump > d.sql`
   and replay through a converter (pgloader handles the SQLite→PG path directly).
5. Why it matters: concurrent ministry users, point-in-time recovery, PostGIS
   spatial joins for the 22,420-cell grid, connection pooling for ingest bursts.

## 4. Scheduled retraining + monitoring

- **Retrain (Module A):** `TRAIN_PHASE=A python3 scripts/real-pipeline/train_prospectivity.py`
  then `TRAIN_PHASE=B …` (two-phase, foreground-safe — see script header). Cron
  example: `0 2 * * 0` (weekly Sunday 02:00). Each run rewrites the sha256
  registry; `tests/python/test_pipeline.py` re-verifies integrity after every run.
- **Retrain (Module B):** deterministic ridge — re-run `bun prisma/seed.ts`
  training section or hit the seed train path; sub-second, seed-42 reproducible.
- **Drift:** `GET /api/drift` → alert when `verdict: "significant"` or
  `retrainRecommended: true` (PSI > 0.25). Wire to NIC monitoring (Prometheus
  blackbox + JSON path, or the existing `/api/health` payload which already
  exposes artifact ages).
- **Logs:** every API call emits one structured JSON line (route, status,
  duration, request-id) — ship stdout to any log aggregator.

## 5. Deep-learning stretch (GPU host) — honest scope

The neural baseline shipped today is an sklearn MLP (honest spatial block-CV
AUC 0.8795, artifact `mlp.joblib` in the registry). The literature-backed
ceiling experiment is a Prithvi-EO-2.0 fine-tune; it requires a GPU host
(≥16 GB VRAM) and is fully scripted as:

```bash
pip install torch terratorch  # on the GPU host
git clone https://github.com/NASA-IMPACT/Prithvi-EO-2.0
# Fine-tune on our cached 22,420-cell grid (12-band config, block-split):
#   configs/ → prithvi_eo_v2_300m, bands B02..B12, tiles 0.1° blocks,
#   labels = MRDS proximity (same rule, same seed 42) — then export ONNX
#   and register in models/prospectivity/ alongside the existing artifacts.
```

Do NOT claim this is done until its artifact + honest block-CV metrics appear
in `model_registry.json` — the registry is the single source of truth.

## 6. Security posture & honest limits

- Auth is **demo-grade RBAC** (signed cookie, 12 h TTL, brute-force rate limit).
  Government production path: NIC SSO / OIDC (e.g., Parichay) — swap
  `src/lib/auth.ts` session issuance, keep `requireRole` call sites unchanged.
- All mutating endpoints require officer/admin; every mutation is appended to
  `AuditLog` (actor, action, payload summary).
- Known limits (disclosed, not hidden): Module B operational rows are a
  calibrated digital twin until MOIL connects the real ERP feed via
  `/api/ingest`; Module A labels are MRDS-proximity, scores are exploration
  priority — never certified reserves; 1:2M lithology is regional.
- Sentinel-2/Copernicus, USGS MRDS (public domain), ERA5 (CC-BY-4.0), GSI
  1:2M Open Series — licensing documented in `research/MODEL_CARD.md`.
