# MOIL Intelligence — Model Research & Production Improvement Plan

*Research date: 2026-09-13 · Sources: 6 literature web-searches (2021–2026 papers) + full codebase audit*

---

## 1. Current State (audited ground truth)

### Module A — Prospectivity (Python, `scripts/real-pipeline/multi_mine_pipeline.py`)
| Aspect | Current |
|---|---|
| Models | LogisticRegression + RandomForest(300) ensemble (mean prob) |
| Features (9) | 4 lithology fracs, elev, slope, NDVI, SWIR ratio, brightness |
| Labels | USGS MRDS proximity (pos ≤1.5 km, neg ≥3 km, band excluded) — 355 pos / 21,200 neg |
| Validation | Spatial block CV (GroupKFold-5, 0.1° blocks) — **RF AUC 0.875, LR 0.805** |
| Artifacts | `portfolio.json` (544 KB grid scores) + `region_features.npz` cache. **No persisted models — fit in memory, discarded after scoring** |

### Module B — Production forecast (TypeScript, `src/lib/ml/regression.ts`)
| Aspect | Current |
|---|---|
| Model | Ridge regression, pure-TS full-batch GD, exact linear-SHAP |
| Features (10) | target, rainfall (t, t−1), downtime, maintenance, blasting, haulers, utilization, monsoon, monsoon×open-pit |
| Validation | Rolling-origin expanding CV, 3 folds × 52 wks — **R² 0.928, MAPE 11.6%** |
| Scenario Lab | Real server-side refit from 4,000-row warehouse, stampede-protected cache, exact counterfactuals |

### Verified infrastructure gaps
1. **No persisted Python model artifacts** (no joblib/ONNX anywhere) — JS side can never re-score the RF ensemble.
2. **No CI** — manifest-serialization bug was fixed by a post-hoc patch script; nothing would catch a regression.
3. **No pytest** — Python pipeline has zero tests (bun tests cover only TS libs).
4. **Label ceiling disclosed but untreated** — MRDS proximity treats all far ground as barren; literature says PU learning fixes this bias.
5. **Probability calibration never measured** (no Brier/reliability curve for Module A).
6. Single-process in-memory caches; SQLite file DB — fine for demo, listed as scaling roadmap.

---

## 2. What the Literature Says (2021–2026)

**Boosting > RF for MPM.** Qiao et al. 2026 (MDPI, Mayoumu area) and Amirajlo et al. 2026 (Nature Sci. Rep., ensemble ML strategies) report XGBoost/LightGBM deliver "high predictive accuracy and robustness" with clear advantages over RF: leaf-wise growth, faster training, lower memory. Daviran et al. 2021 (cited 169×) showed hyperparameter tuning alone materially changes RF/XGB MPM rankings → tune with Optuna.

**PU learning is the methodologically correct fix for proximity labels.** Xiong & Zuo 2021 (Ore Geology Reviews, cited 80×) — PU learning for MPM "delivers a better potential map" by treating non-deposit areas as *unlabeled may-contain-unknowns*, not confirmed barren. Bi et al. 2025 (MDPI) extends PU hybrid models to prospect prediction. Gong et al. 2026 combines dual-relation heterogeneous graphs + PU. **Our current label scheme (neg ≥3 km from MRDS) is exactly the bias PU learning addresses.**

**Deep learning SOTA: CNN-Transformers & U-Net segmentation.** Li et al. 2024 (Ore Geology Reviews) — CNN-Transformer beats plain CNN at 0.92 accuracy by capturing local + global spatial context. A 2026 systematic review (349 studies, 2018–2025) confirms CNN/segmentation dominance on gridded geoscience rasters. U-Net-style encoder-decoders on Sentinel-2 are standard practice for producing spatially coherent masks rather than noisy per-pixel scores.

**Foundation models: Prithvi-EO-2.0 (NASA + IBM).** Open-source transformer geospatial FM on HuggingFace, fine-tuned through TerraTorch (GitHub: NASA-IMPACT/Prithvi-EO-2.0). Accepts Sentinel-2 bands; fine-tuning beats GAN baselines at small sample sizes (Clark U. study). Hsu et al. 2024 (arXiv, cited 57×) benchmarks it on downstream geospatial tasks. **This is the strongest possible "space tech" story for SIH: we fine-tuned the actual NASA-IBM foundation model.**

**Spectral indices are free accuracy.** Shebl et al. 2023 (cited 74×) and Sekandari et al. (cited 208×): Sentinel-2 + ASTER SWIR combos map hydrothermal alteration (iron oxides, OH-bearing clays, carbonates) reliably. Kalkhoran et al. 2026 (Nature) detect Fe²⁺/Fe³⁺ alteration zones from S2 alone. We currently use only NDVI + 1 SWIR ratio + brightness — **we are leaving verified, cheap features on the table.**

**Mining time-series SOTA is LSTM-Transformer hybrids** (Shi 2024, cited 163×; Tao 2026 mine pressure; 2024 mine water inflow) — but those settings have dense sensor streams. For 4,000 weekly rows with near-linear dynamics, honest evidence says gradient boosting + quantiles beats deep nets without the variance.

---

## 3. Model Verdict for THIS Project

### Module A — adopt a 3-tier model ladder
| Tier | Model | Why | Effort |
|---|---|---|---|
| **Adopt now** | **LightGBM (Optuna-tuned, 40–80 trials) inside the existing ensemble** + **PU bagging (spy method)** on labels | Literature-consistent AUC lift; PU fixes our exact label bias; both run on the cached 22k-cell matrix in <2 min | ~1 day |
| **Add features** | Sentinel-2 alteration indices: ferric iron (B4/B2), ferrous iron (B5/B4 + B6/B5), clay-OH (B11/B12 variants), silica-carbonate combos, plus tasseled-cap brightness/greenness/wetness | Cited repeatedly as the biggest data-centric lift on S2; no new downloads (bands already fetched) | ~0.5 day |
| **Ceiling/stretch** | U-Net (patch-based, block-split) or **Prithvi-EO-2.0 fine-tune via TerraTorch** | Spatially coherent maps; NASA-IBM FM = jury-differentiating "space tech" | 2–4 days |

Keep LR + RF as disclosed interpretable baselines — the comparison leaderboard *is* the honesty story.

### Module B — keep Ridge, add uncertainty
| Tier | Model | Why | Effort |
|---|---|---|---|
| **Adopt now** | **LightGBM quantile regression (τ = 0.1/0.5/0.9)**, same 10 features | P10/P50/P90 risk envelope ("80% prediction interval") — jury gold for a *production-gap early-warning* tool; pinball-loss reported honestly | ~1 day |
| Keep | Ridge + exact SHAP (Scenario Lab) | Interpretability + exact counterfactuals; becomes the baseline row in the leaderboard | 0 |
| Stretch | LightGBM with mine-code categorical + temporal lag features | Captures per-mine heterogeneity pooled Ridge can't | ~0.5 day |

---

## 4. Production-Level Improvements (priority order)

**P0 — correctness & trust (do first)**
1. Persist Module A models: `joblib` dump + `model_manifest.json` (sha256, sklearn version, feature order, block-CV metrics, trained-at). Health endpoint checks manifest freshness.
2. `pytest` suite for the pipeline: feature-matrix shape, no-NaN, block-CV group independence, manifest schema, JSON-serializable manifest (regression-test the bug that already bit us).
3. CI (GitHub Actions): bun lint + bun test + pytest smoke on cached `.npz` (no network). One YAML, ~40 lines.

**P1 — model upgrades (the research wins)**
4. LightGBM + Optuna into Module A ensemble (spatial block CV preserved, report honest AUC/PR-AUC/Brier per model).
5. PU-bagged relabeling (spy ≈ 15%, L ⋅ 2.5 unlabeled, 10 bags) — compare vs binary baseline on identical folds.
6. New S2 alteration indices into feature matrix; re-run; feature-importance table becomes a slide.
7. Probability calibration (isotonic on train folds) + reliability diagram rendered in Health tab.
8. Quantile LightGBM for Module B; surface P10/P90 band in Scenario Lab + Prediction cards.

**P2 — differentiators if time remains**
9. Model-leaderboard UI (all models × metrics × one bar chart) — transparency differentiator no other team will have.
10. U-Net or Prithvi-EO-2.0 fine-tune experiment → even a partial result presented as "in-progress extension" wins points.
11. ONNX export of the champion Module A model → JS-side inference → "live prospectivity scoring" in-app.
12. Scaling roadmap doc: Postgres + shared model store + tile server (COG/PMTiles) for multi-replica prod.

---

## 5. Sources (key)
- Qiao et al. 2026, MDPI *Minerals* — XGBoost/LightGBM MPM advantages
- Amirajlo et al. 2026, *Nature Sci. Rep.* — ensemble ML strategies for MPM
- Xiong & Zuo 2021, *Ore Geology Reviews* — PU learning for MPM (cited 80×)
- Bi et al. 2025, MDPI — PU-based hybrid prospect prediction
- Li et al. 2024, *Ore Geology Reviews* — CNN-Transformer MPM (0.92 acc)
- Shebl et al. 2023 / Sekandari et al. — Sentinel-2 + ASTER alteration mapping
- Hsu et al. 2024, arXiv; IBM Research 2025 — Prithvi-EO-2.0 / TerraTorch
- Shi et al. 2024, *Nature Sci. Rep.*; Tao et al. 2026 — LSTM-Transformer mining TS
- Daviran et al. 2021 — MPM hyperparameter tuning (cited 169×)

*Raw search dumps: `scripts/research/*.json`*
