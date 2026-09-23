# MOIL Intelligence — Manganese Prospectivity & Production Command Center

AI/ML decision-support system for MOIL Limited (Smart India Hackathon 2026 · PS 26009 · Ministry of Steel).

Three modules, one dashboard:

| Module | What it does | Data |
|--------|--------------|------|
| **A — Prospectivity** | Manganese reserve likelihood mapping: demo grid for 10 mine leases **plus** a real multi-mine regional pipeline (22,420 cells) | Demo: satellite proxies + synthetic labels · Real: USGS MRDS, GSI geology, Copernicus DEM, Sentinel-2 |
| **B — Shortfall forecast** | 4-week-ahead weekly production prediction with exact linear-SHAP attribution | Real ERA5 weather (2019–2026) + synthetic ops anchored to MOIL public aggregates |
| **C — Action engine** | Priority-ranked corrective actions (redeploy haulers, blast reschedule, maintenance) derived from B's attributions | Model output |

Plus a **Scenario Lab** (what-if planning): move operational levers (downtime, haulers, utilization,
blasting, rainfall stress) and the model re-scores the week instantly with exact counterfactual SHAP deltas.

## Quickstart

```bash
bun install
bun run db:generate          # prisma client
bun run db:push              # schema → SQLite (db/custom.db)
bun run dev                  # http://localhost:3000
```

Seed (recreates the full demo dataset — careful: wipes current data):

```bash
bunx prisma db push && bunx prisma db seed   # seed.ts — deterministic
```

Real satellite pipeline (re-runs the regional prospectivity model; npz cache makes re-runs fast):

```bash
python3 scripts/real-pipeline/multi_mine_pipeline.py
```

Tests + lint:

```bash
bun test tests/              # ML core + production hardening suites
bun run lint
```

## Architecture

```
Sentinel-2 L2A · GSI 1:2M geology · Copernicus DEM · USGS MRDS   (real, public)
        │
        ▼
scripts/real-pipeline/multi_mine_pipeline.py        research/multi-mine/artifacts/portfolio.json
        (22,420-cell regional grid · spatial block CV · RF + logistic ensemble)
        │
        ▼
Next.js 16 App Router ── /api/prospectivity ──────────────▶ Prospectivity Map tab (REAL/Demo toggle)
Prisma + SQLite        ── /api/overview·mines·production·
 (10 mines · 4,000         risks·recommendations·reserve-map ▶ Overview / Forecast / Risks tabs
  mine-weeks)           ── /api/simulate (POST)  ────────────▶ Scenario Lab (exact counterfactuals)
                        ── /api/export?dataset=… (CSV)  ────▶ Downloads menu
                        ── /api/health                      ▶ liveness + artifact freshness
```

- `src/lib/ml/regression.ts` — pure-TS ridge + logistic with exact linear-SHAP; zero native deps.
- `src/lib/ml/scenario.ts` — server-side model refit (deterministic GD, memoized 10 min) + counterfactual engine.
- `src/lib/{api-cache,rate-limit,validate,csv}.ts` — TTL cache with stampede protection, token-bucket rate limiter, zod request validation, RFC 4180 CSV.
- Security headers, request-ID logging, HTTP cache headers on every GET.

## API reference

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/overview` | GET | KPIs, monthly rollup, top risks, model meta |
| `/api/mines` | GET | 10-mine master data |
| `/api/production?mineId=` | GET | weekly history + 4-wk forecasts (bulk-loaded, 3 queries) |
| `/api/reserve-map?mineId=` | GET | demo-mode reserve grids + drill targets |
| `/api/risks?mineId=` | GET | watch/risk predictions sorted by severity |
| `/api/recommendations` | GET, PATCH | Module C queue; PATCH `{id,status}` updates status |
| `/api/prospectivity?mineCode=` | GET | REAL regional pipeline (portfolio summary / per-mine grid) |
| `/api/simulate` | GET, POST | GET: slider metadata · POST: `{mineId, overrides}` → exact counterfactual |
| `/api/export?dataset=production\|forecasts\|recommendations\|reserves&mineCode=` | GET | CSV download |
| `/api/health` | GET | DB + artifacts + model freshness probe (503 when degraded) |

All query params are zod-validated (`src/lib/validate.ts`); malformed input → `400` with details, never a 500.

## Data provenance (honesty policy)

- **Real:** MOIL annual-report aggregates, ERA5 weather per mine (Open-Meteo, CC-BY-4.0), GSI belt
  geology, USGS MRDS occurrences, Copernicus DEM GLO-30, Sentinel-2 L2A.
- **Synthetic (labeled in-UI):** site-level weekly ops & demo-mode reserve labels — anchored to public
  aggregates; no public mine-wise weekly data exists (SEBI LODR is company-level only).
- **Metrics:** Module B reports rolling-origin CV (R² 0.928 · MAPE 11.6% — 3 folds × 52 test weeks).
  Module A reports discovery-blind **spatial block CV AUC 0.88 (RF)** — the honest number, aligned with
  2025-26 published MPM practice; the circular-trap AUC 1.00 is shown deliberately as a cautionary demo.
- Prospectivity scores are exploration priorities, **never certified reserves**.

## Model card

See [research/MODEL_CARD.md](research/MODEL_CARD.md) for full model documentation (data windows,
features, validation design, limitations, intended use).
