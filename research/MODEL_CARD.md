# MODEL CARD — MOIL Intelligence

Version 1.1.0 · 2026-09 · SIH 2026 PS 26009

## Model 1 — Production shortfall forecast (Module B)

**Type:** Ridge regression (pure-TS gradient descent, standardized features), pooled across 10 mines.
**Task:** Predict weekly manganese output (t) 1–4 weeks ahead; attribute deviations per feature.

### Data

- 4,000 mine-weeks (10 mines × 400 weeks, 2019-01 → 2026-08).
- Weather features (rainfall, lag rainfall): **REAL** ERA5 reanalysis per mine location (Open-Meteo, CC-BY-4.0).
- Operational features (downtime, maintenance, blasting, haulers, utilization) and targets: **SYNTHETIC DEMONSTRATION**, anchored to MOIL public aggregates; monsoon coupling driven by real ERA5 rainfall.
- No public mine-wise weekly operational data exists for an Indian PSU (SEBI LODR is company-level) — this is disclosed everywhere it matters.

### Features (10)

Planned target, Rainfall (current wk), Rainfall (prev wk), Equipment downtime, Maintenance events,
Blasting delays, Active haulers, Equipment utilization, Monsoon period (0|1), Monsoon × open-pit rainfall (interaction).

### Validation

- **Rolling-origin (expanding-window) CV:** 3 folds × 52 test weeks; scaler fit on train rows only.
- **Reported: R² 0.928 · MAPE 11.6%.** MAPE is the honest per-week number (pooled R² is inflated by
  between-mine scale variance — documented in `ModelMeta.production_model.errorStructure`).
- Residual realism: heteroscedastic noise + rare unmodeled disruptions (safety stand-downs, major
  failures) + per-mine drift — matches published mine-output forecast error ranges (8–12%).

### Scenario engine (runtime refit)

`POST /api/simulate` refits the same architecture from the warehouse on demand (deterministic GD,
memoized 10 min; per-mine rolling-origin holdout of the last 8 weeks per mine). Runtime refit metrics
(R² 0.924 · MAPE 12.3% on the 2026-09-12 data) reproduce the published numbers within methodology
noise — evidence the pipeline is reproducible, not baked.

**Counterfactuals are exact:** the model is linear, so linear-SHAP gives φ_i = w_i·(x_i−μ_i)/σ_i with
Σφ = ŷ_scenario − ŷ_baseline exactly. Scenario Lab deltas are not approximations.

### Intended use / limits

- Use: weekly planning support — which mines will miss target, which lever recovers how many tonnes.
- Not for: statutory reserve reporting, safety decisions, or anything beyond the demo feature set.
- Known limits: no crew/grade blending features; unmodeled disruptions are irreducible (disclosed);
  monsoon interaction is open-pit only (underground mines are less weather-sensitive, as in reality).

## Model 2 — Manganese prospectivity (Module A)

### Demo mode (10 mine leases)

Logistic regression on satellite + geological proxies (NDVI, soil moisture, LST, rock-match prior,
distance-to-ore). Synthetic labels. Displayed as **Demo** everywhere; never mixed with real outputs.

### REAL regional pipeline — v2 PRODUCTION (`scripts/real-pipeline/train_prospectivity.py`)

- **AOI:** central-India Mn belt, 22,420 cells @ 0.01° (~1.1 km).
- **Sources (all real, public):** USGS MRDS occurrences (labels), GSI 1:2M seamless geology (lithology),
  Copernicus DEM GLO-30 (elevation/slope), Sentinel-2 L2A (NDVI, SWIR ratios, brightness).
- **Labels:** proximity-to-known-occurrence rule with an excluded ambiguity band — **not** ground truth ore.
- **Features (12):** 4 lithology fractions, elevation, slope, NDVI, SWIR ratio, brightness **+ 3 NEW
  alteration indices from raw Sentinel-2 bands**: ferric iron B04/B02, ferrous iron B11/B08,
  clay-OH B11/B12 (standard band-ratio alteration mapping).
- **Models (all honestly evaluated):** logistic regression (baseline), random forest (300 trees),
  **LightGBM tuned by Optuna (40 trials, objective = honest block-CV AUC, seed 42)**, and
  **LightGBM PU-bagging (30 rounds, 3×|P| unlabeled resample — Mordelet & Vert 2013)** to mitigate the
  "far-from-MRDS = barren" label bias (cf. Xiong & Zuo 2021).
- **Validation — the honest design (aligned with 2025-26 published MPM practice — spatial block CV,
  e.g. Stock et al. 2025; Nurtas 2026; nested spatial CV under extreme imbalance, Nidhi 2026):**
  - **Spatial block CV (reported): GroupKFold(5) on 0.1° blocks, proximity feature EXCLUDED** —
    AUC per model persisted in `models/prospectivity/model_registry.json`.
  - PU is evaluated FOLD-WISE (no leakage); calibration is isotonic fit on out-of-fold scores.
  - v1 honesty demos preserved in `portfolio_v1_backup.json` (random k-fold inflation; circularity
    trap AUC ≈ 1.00 with the proximity feature) — shown in the UI as "v1 demo", never used by v2.
- **Persistence (P0):** every model + calibrator saved as joblib in `models/prospectivity/` with a
  sha256-verified registry (`model_registry.json`) covering feature order, label rule, class balance,
  CV metrics, reliability bins, data fingerprints and library versions. `tests/python/test_pipeline.py`
  re-verifies every hash and metric contract.
- **Outputs:** portfolio ranking + per-mine real grids + named drill targets, tiered High/Med/Low
  (tier thresholds recorded in the registry).
- **Limits:** 1:2M lithology is a regional prior; no hyperspectral Mn absorption band (2.3–2.4 µm) in
  Sentinel-2; no public grade/tonnage data. Scores = exploration priority, **never certified reserves**.

## Transparency engineering

- **Verified public record (v1.2):** `/api/public-data` serves 12 cited MOIL production figures
  (FY2023-24 → FY2026-27 Q1) sourced from PIB (Govt of India) releases, PTI and named trade press —
  each with source, URL and publication date (`src/lib/public-data.ts`, tested by
  `tests/public-record.test.ts`). The Production tab renders this record and calibrates the digital
  twin against it: **simulated FY2025-26 portfolio total 1,897,079 t vs verified 1,907,000 t
  (−0.52% gap)**. Mine nameplate capacities in `src/lib/mines.ts` are scaled by a single common
  factor so this holds; per-mine split is approximate (disclosed in-file).
- **Risk bands (Module B v1.3) — per-mine split-conformal residual quantiles:** band = point
  forecast + that mine's own P10/P90 out-of-sample residual offsets, calibrated on a rolling-origin
  window and measured on a DISJOINT later window (**79.2% coverage vs 80% nominal**, seed log).
  Pooled quantile ridge (pinball loss) was implemented first (engine kept + unit-tested in
  `tests/ml-core.test.ts`) and then REJECTED for deployment on measured grounds: with pooled data
  its bands ignore mine scale — BLGT empirical P50 = 7,846 t vs pooled model 5,834 t; coverage was
  right on average but wrong per mine. The conformal design fixes per-mine calibration and is the
  standard for distribution-free coverage. Scenario Lab shows the band for baseline AND scenario
  rows; the forecast chart/table expose P10–P90 per week.
- Every model output in the UI carries a provenance badge (REAL / SIMULATED·CALIBRATED / MODEL OUTPUT).
- `/api/health` exposes artifact freshness and model training dates.
- `ModelMeta` rows store full metric structure, error analysis and provenance for jury audit.
- Negative cache on failures; rate limits and zod validation on all endpoints.
- ERA5 weekly weather is reproducible: `scripts/real-pipeline/fetch_era5_weekly.py` refetches the
  identical 400-week window (2018-12-31 → 2026-08-24) for all 10 mine locations (Open-Meteo archive,
  CC-BY-4.0).
