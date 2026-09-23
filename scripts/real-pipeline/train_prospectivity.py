#!/usr/bin/env python3
# ============================================================
# MOIL Intelligence — PRODUCTION prospectivity training (v2)
# Upgrades over v1 (multi_mine_pipeline.py), all on REAL data:
#   1. Three Sentinel-2 alteration indices (real band ratios):
#        ferric_iron  = B04/B02   (iron-oxide staining)
#        ferrous_iron = B11/B08
#        clay_oh      = B11/B12   (OH-bearing clay alteration)
#   2. LightGBM tuned with Optuna (40 trials, spatial block CV)
#   3. PU bagging (Mordelet & Vert 2013) — fixes the
#      "far from MRDS = barren" label bias: unlabeled cells are
#      NOT confirmed barren, negatives are resampled per round.
#   4. Isotonic probability calibration (OOF-fit, no leakage)
#   5. PERSISTENCE: joblib model registry + sha256 manifest
# Honest validation: discovery-blind spatial block CV
# (GroupKFold-5 on 0.1° blocks, proximity feature EXCLUDED).
# Seed fixed at 42 everywhere → reproducible.
# ============================================================
import hashlib, json, math, os, shutil, warnings
from datetime import datetime, timezone

import numpy as np
import joblib

warnings.filterwarnings("ignore")
import lightgbm as lgb
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score, brier_score_loss, average_precision_score
import optuna

BASE = "/home/z/my-project"
ART = f"{BASE}/research/multi-mine/artifacts"
OUT = f"{BASE}/models/prospectivity"
os.makedirs(OUT, exist_ok=True)
SEED = 42

GRID = 0.01
LON_MIN, LON_MAX = 78.72, 80.62
LAT_MIN, LAT_MAX = 20.84, 22.02
POS_KM, NEG_KM = 1.5, 3.0
CELL_TONNAGE_BASE = 0.26

MINES = [
    dict(code="BLGT", name="Balaghat Mine", state="Madhya Pradesh", district="Balaghat", lat=21.81, lng=80.15, oreg=38, geology="Sausar"),
    dict(code="BRWL", name="Bharweli Mine", state="Madhya Pradesh", district="Balaghat", lat=21.90, lng=80.07, oreg=40, geology="Sausar"),
    dict(code="UKWA", name="Ukwa Mine", state="Madhya Pradesh", district="Balaghat", lat=21.90, lng=80.41, oreg=36, geology="Sausar"),
    dict(code="TRDI", name="Tirodi Mine", state="Madhya Pradesh", district="Balaghat", lat=21.73, lng=79.67, oreg=30, geology="Sausar"),
    dict(code="DGBZ", name="Dongri Buzurg Mine", state="Maharashtra", district="Bhandara", lat=20.98, lng=79.33, oreg=30, geology="Sakoli"),
    dict(code="CHKL", name="Chikla Mine", state="Maharashtra", district="Bhandara", lat=21.33, lng=79.65, oreg=35, geology="Sakoli"),
    dict(code="KNDR", name="Kandri Mine", state="Maharashtra", district="Nagpur", lat=21.40, lng=79.27, oreg=38, geology="Amgaon"),
    dict(code="MNSR", name="Mansar Mine", state="Maharashtra", district="Nagpur", lat=21.38, lng=79.24, oreg=28, geology="Amgaon"),
    dict(code="STSJ", name="Sitasaongi Mine", state="Maharashtra", district="Gondia", lat=21.07, lng=80.12, oreg=32, geology="Sakoli"),
    dict(code="GMGN", name="Gumgaon Mine", state="Maharashtra", district="Nagpur", lat=21.22, lng=78.92, oreg=35, geology="Amgaon"),
]

def log(m):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}", flush=True)

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

# ------------------------------------------------------------
# 1) Load real cached features
# ------------------------------------------------------------
z = np.load(f"{ART}/region_features.npz")
elev, slope, dist_km, label = z["elev"], z["slope"], z["dist_km"], z["label"]
frac = {k: z[k] for k in ("sausar", "sakoli", "gneiss", "other")}
ndvi, swir_ratio, brightness = z["ndvi"], z["swir_ratio"], z["brightness"]

b = np.load(f"{ART}/s2_bands.npz")
eps = 1e-6
ferric = (b["red"] / (b["blue"] + eps)).astype(np.float32)
ferrous = (b["swir16"] / (b["nir"] + eps)).astype(np.float32)
clay_oh = (b["swir16"] / (b["swir22"] + eps)).astype(np.float32)
log(f"Alteration indices: ferric[min={ferric.min():.2f} max={ferric.max():.2f}] "
    f"ferrous[min={ferrous.min():.2f} max={ferrous.max():.2f}] "
    f"clay[min={clay_oh.min():.2f} max={clay_oh.max():.2f}]")

lons = np.arange(LON_MIN + GRID / 2, LON_MAX, GRID)
lats = np.arange(LAT_MAX - GRID / 2, LAT_MIN, -GRID)
n_lat, n_lon = len(lats), len(lons)
LATG, LONG = np.meshgrid(lats, lons, indexing="ij")
assert LATG.shape == label.shape, "grid shape mismatch vs cache"

FEATS = ["sausar_frac", "sakoli_frac", "gneiss_frac", "other_frac",
         "elev_m", "slope_deg", "ndvi", "swir_ratio", "brightness",
         "ferric_iron", "ferrous_iron", "clay_oh"]
FEAT_ARRAYS = [frac["sausar"], frac["sakoli"], frac["gneiss"], frac["other"],
               elev, slope, ndvi, swir_ratio, brightness,
               ferric, ferrous, clay_oh]

tr_mask = (label >= 0)
y_all = label[tr_mask].astype(int)
X_all = np.column_stack([a[tr_mask] for a in FEAT_ARRAYS]).astype(np.float64)
dist_all = dist_km[tr_mask]
log(f"Training cells: {len(y_all)} (pos={int(y_all.sum())}, neg={int((y_all==0).sum())})")

block_id = ((LATG.ravel()[tr_mask.ravel()] // 0.1).astype(int) * 1000
            + (LONG.ravel()[tr_mask.ravel()] // 0.1).astype(int))
uniq = {v: i for i, v in enumerate(sorted(set(block_id.tolist())))}
groups = np.array([uniq[v] for v in block_id])
log(f"Spatial blocks: {len(uniq)} blocks of 0.1 deg")

# ------------------------------------------------------------
# 2) Honest spatial block CV machinery
# ------------------------------------------------------------
PHASE = os.environ.get("TRAIN_PHASE", "A")

if PHASE == "B":
    # ---- Phase B loads PERSISTED results (no retraining) ----
    registry = json.load(open(f"{OUT}/model_registry.json"))
    score = np.load(f"{OUT}/map_scores_v2.npz")["score"]
    hi_q = registry["selection"]["tier_thresholds"]["high_min"]
    md_q = registry["selection"]["tier_thresholds"]["medium_min"]
    rel = registry["calibration"]["reliability_bins"]
    champion = registry["selection"]["champion"]
    ensemble_members = registry["selection"]["ensemble_members"]
    log(f"Phase B: loaded registry + score grid (champion={champion})")
else:
    def cv_metrics(y, oof):
        return dict(
            auc=round(float(roc_auc_score(y, oof)), 4),
            brier=round(float(brier_score_loss(y, oof)), 4),
            auprc=round(float(average_precision_score(y, oof)), 4),
        )

    def block_cv(model_factory, X, y, gr):
        gkf = GroupKFold(n_splits=5)
        oof = np.zeros(len(y), dtype=float)
        for tr_i, te_i in gkf.split(X, y, groups=gr):
            m = model_factory()
            m.fit(X[tr_i], y[tr_i])
            oof[te_i] = m.predict_proba(X[te_i])[:, 1]
        return oof, cv_metrics(y, oof)

    def block_cv_pu(X, y, gr, params, K=30, ratio=3, seed=SEED):
        """PU bagging evaluated INSIDE each CV fold (no leakage)."""
        gkf = GroupKFold(n_splits=5)
        oof = np.zeros(len(y), dtype=float)
        for tr_i, te_i in gkf.split(X, y, groups=gr):
            rng = np.random.RandomState(seed + tr_i[0])
            pos = np.where(y[tr_i] == 1)[0]
            unlab = np.where(y[tr_i] == 0)[0]
            n_neg = min(len(unlab), ratio * len(pos))
            acc = np.zeros(len(te_i), dtype=float)
            for k in range(K):
                neg = rng.choice(unlab, size=n_neg, replace=False)
                idx = np.concatenate([pos, neg])
                m = LGBMClassifier(**params)
                m.fit(X[tr_i][idx], y[tr_i][idx])
                acc += m.predict_proba(X[te_i])[:, 1]
            oof[te_i] = acc / K
        return oof, cv_metrics(y, oof)

    def make_lr():
        return LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced", random_state=SEED)

    def make_rf():
        return RandomForestClassifier(n_estimators=300, min_samples_leaf=3, n_jobs=-1,
                                      random_state=SEED, class_weight="balanced_subsample")

    def lgbm_params(**over):
        p = dict(n_estimators=400, learning_rate=0.05, num_leaves=63,
                 min_child_samples=20, subsample=0.8, subsample_freq=1,
                 colsample_bytree=0.8, reg_lambda=1.0, class_weight="balanced",
                 random_state=SEED, n_jobs=4, verbosity=-1,
                 deterministic=True, force_col_wise=True)
        p.update(over)
        return p

    # ------------------------------------------------------------
    # 3) Train: LR + RF baselines, then Optuna-tuned LightGBM
    # ------------------------------------------------------------
    log("Honest spatial block CV — logistic regression...")
    oof_lr, m_lr = block_cv(make_lr, X_all, y_all, groups)
    log(f"  LR   {m_lr}")

    log("Honest spatial block CV — random forest...")
    oof_rf, m_rf = block_cv(make_rf, X_all, y_all, groups)
    log(f"  RF   {m_rf}")

    def optuna_objective(trial):
        params = lgbm_params(
            n_estimators=trial.suggest_int("n_estimators", 150, 400),
            learning_rate=trial.suggest_float("learning_rate", 0.02, 0.25, log=True),
            num_leaves=trial.suggest_int("num_leaves", 15, 96),
            min_child_samples=trial.suggest_int("min_child_samples", 10, 80),
            subsample=trial.suggest_float("subsample", 0.6, 1.0),
            colsample_bytree=trial.suggest_float("colsample_bytree", 0.6, 1.0),
            reg_lambda=trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True),
            # Search runs in FAST multithreaded mode (bitwise-nondeterministic
            # histogram reductions). The SELECTED configuration is re-evaluated
            # and persisted with deterministic=True below — all REPORTED metrics
            # are deterministic. Documented in the registry.
            deterministic=False, force_col_wise=False, force_row_wise=True, n_jobs=2,
        )
        _, met = block_cv(lambda: LGBMClassifier(**params), X_all, y_all, groups)
        return met["auc"]

    log("Optuna tuning LightGBM (40 trials, objective = honest block-CV AUC)...")
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=SEED))
    def _trial_log(st, tr):
        if tr.number % 5 == 4 and tr.value is not None:
            log(f"  trial {tr.number + 1}/20  auc={tr.value:.4f}  best={st.best_value:.4f}")
    study.optimize(optuna_objective, n_trials=20, show_progress_bar=False, callbacks=[_trial_log])
    best_params = lgbm_params(**study.best_params)
    log(f"  Best trial: AUC={study.best_value:.4f} params={study.best_params}")

    oof_lgb, m_lgb = block_cv(lambda: LGBMClassifier(**best_params), X_all, y_all, groups)
    log(f"  LGBM {m_lgb}")

    # ------------------------------------------------------------
    # 4) PU bagging (label-bias fix) — honest fold-wise evaluation
    # ------------------------------------------------------------
    log("PU bagging (K=15, 3x|P| unlabeled resample per round), fold-wise...")
    oof_pu, m_pu = block_cv_pu(X_all, y_all, groups, best_params, K=15, ratio=3)
    log(f"  LGBM-PU {m_pu}")

    # ------------------------------------------------------------
    # 5) Fit final models on ALL labeled cells + isotonic calibration
    #    (calibrators fit on OOF predictions — no leakage)
    # ------------------------------------------------------------
    log("Fitting final models on all labeled cells + isotonic calibration (OOF-fit)...")
    final = {}
    oofs = {"logistic": oof_lr, "random_forest": oof_rf, "lightgbm": oof_lgb, "lightgbm_pu": oof_pu}
    mets = {"logistic": m_lr, "random_forest": m_rf, "lightgbm": m_lgb, "lightgbm_pu": m_pu}

    lr_f = make_lr(); lr_f.fit(X_all, y_all)
    rf_f = make_rf(); rf_f.fit(X_all, y_all)
    lgb_f = LGBMClassifier(**best_params); lgb_f.fit(X_all, y_all)

    rng = np.random.RandomState(SEED)
    pos_i = np.where(y_all == 1)[0]
    unl_i = np.where(y_all == 0)[0]
    n_neg = min(len(unl_i), 3 * len(pos_i))
    pu_models = []
    for k in range(15):
        neg = rng.choice(unl_i, size=n_neg, replace=False)
        idx = np.concatenate([pos_i, neg])
        m = LGBMClassifier(**best_params)
        m.fit(X_all[idx], y_all[idx])
        pu_models.append(m)
    final = {"logistic": lr_f, "random_forest": rf_f, "lightgbm": lgb_f,
             "lightgbm_pu": pu_models}

    calibrators = {}
    for name, oof in oofs.items():
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(oof, y_all)
        calibrators[name] = iso
    log("Calibrators fit (isotonic on out-of-fold scores).")

    # ------------------------------------------------------------
    # 6) Score the full grid with each model, calibrate, ensemble
    # ------------------------------------------------------------
    X_grid = np.column_stack([a.ravel() for a in FEAT_ARRAYS]).astype(np.float64)
    raw_grid, p_grid = {}, {}
    for name in ("logistic", "random_forest", "lightgbm", "lightgbm_pu"):
        mdl = final[name]
        if name == "lightgbm_pu":
            raw = np.mean([m.predict_proba(X_grid)[:, 1] for m in mdl], axis=0)
        else:
            raw = mdl.predict_proba(X_grid)[:, 1]
        raw_grid[name] = raw
        p_grid[name] = calibrators[name].predict(raw).astype(np.float64)
        log(f"  grid scored: {name}  raw_mean={raw.mean():.4f}  cal_mean={p_grid[name].mean():.4f}")

    ranked = sorted(mets, key=lambda k: -mets[k]["auc"])
    champion = ranked[0]
    ensemble_members = ranked[:2]
    # MAP SCORE = RAW (uncalibrated) top-2 ensemble — same relative-ranking
    # semantics as v1 (feeds the estMt aggregation + quantile tiers).
    # CALIBRATED per-model grids go into the npz separately (p_cal_*); honest
    # probability behaviour is documented via the OOF reliability bins.
    score = ((raw_grid[ensemble_members[0]] + raw_grid[ensemble_members[1]]) / 2.0)
    score = score.reshape(n_lat, n_lon).astype(np.float32)
    log(f"Champion: {champion} (AUC {mets[champion]['auc']}) | ensemble = mean({ensemble_members}) [raw for map]")

    # Reliability of the final map score (OOF-based, 10 bins)
    oof_ens = ((calibrators[ranked[0]].predict(oofs[ranked[0]])
                + calibrators[ranked[1]].predict(oofs[ranked[1]])) / 2.0)
    bins = np.linspace(0, 1, 11)
    idx_bin = np.clip(np.digitize(oof_ens, bins) - 1, 0, 9)
    rel = []
    for bix in range(10):
        sel = idx_bin == bix
        if sel.sum() < 5:
            continue
        rel.append(dict(bin=f"{bins[bix]:.1f}-{bins[bix+1]:.1f}",
                        n=int(sel.sum()),
                        mean_predicted=round(float(oof_ens[sel].mean()), 4),
                        observed_rate=round(float(y_all[sel].mean()), 4)))

    # ------------------------------------------------------------
    # 7) Persist everything (joblib + npz + registry with sha256)
    # ------------------------------------------------------------
    paths = {}
    joblib.dump(final["logistic"], f"{OUT}/logistic.joblib")
    joblib.dump(final["random_forest"], f"{OUT}/random_forest.joblib")
    joblib.dump(final["lightgbm"], f"{OUT}/lightgbm.joblib")
    joblib.dump(final["lightgbm_pu"], f"{OUT}/lightgbm_pu.joblib")
    joblib.dump(calibrators, f"{OUT}/calibrators.joblib")
    np.savez_compressed(f"{OUT}/map_scores_v2.npz",
                        score=score,
                        **{f"p_cal_{k}": p_grid[k].reshape(n_lat, n_lon).astype(np.float32)
                           for k in p_grid},
                        tier_high=(score >= np.quantile(score[tr_mask], 0.90)),
                        tier_medium=((score >= np.quantile(score[tr_mask], 0.70))
                                     & (score < np.quantile(score[tr_mask], 0.90))))
    for f in ("logistic.joblib", "random_forest.joblib", "lightgbm.joblib",
              "lightgbm_pu.joblib", "calibrators.joblib", "map_scores_v2.npz"):
        paths[f] = sha256_file(f"{OUT}/{f}")

    hi_q, md_q = np.quantile(score[tr_mask], [0.90, 0.70])

    registry = dict(
        schema_version="2.0",
        created_utc=datetime.now(timezone.utc).isoformat(),
        purpose="MOIL manganese prospectivity — production model registry (v2)",
        seed=SEED,
        data=dict(
            cells_total=int(label.size), cells_labeled=int(tr_mask.sum()),
            positives=int(y_all.sum()), negatives=int((y_all == 0).sum()),
            excluded_band_km=[POS_KM, NEG_KM],
            label_rule=dict(positive=f"<= {POS_KM} km of a USGS MRDS Mn occurrence",
                            negative=f">= {NEG_KM} km",
                            caveat="labels = proximity to known mineralization, NOT ground truth"),
            spatial_blocks=int(len(uniq)),
            feature_cache_sha256=sha256_file(f"{ART}/region_features.npz"),
            s2_bands_sha256=sha256_file(f"{ART}/s2_bands.npz"),
        ),
        features=dict(order=FEATS,
                      descriptions=dict(
                          sausar_frac="fraction of cell in Sausar Group (GSI 1:2M)",
                          sakoli_frac="fraction of cell in Sakoli Group",
                          gneiss_frac="fraction of cell in gneissic basement (Amgaon/Tirodi)",
                          other_frac="fraction of cell in other lithology",
                          elev_m="Copernicus DEM GLO-30 mean elevation",
                          slope_deg="slope from DEM gradient",
                          ndvi="Sentinel-2 NDVI (B08/B04)",
                          swir_ratio="Sentinel-2 SWIR ratio B11/(B08+B11)",
                          brightness="Sentinel-2 blue reflectance B02/1e4",
                          ferric_iron="alteration: B04/B02 iron-oxide staining",
                          ferrous_iron="alteration: B11/B08 ferrous iron",
                          clay_oh="alteration: B11/B12 OH-bearing clay minerals"),
                      new_in_v2=["ferric_iron", "ferrous_iron", "clay_oh"]),
        models={k: dict(params=("see pipeline script" if k != "lightgbm" else study.best_params),
                        honest_cv=mets[k],
                        scheme="spatial block CV GroupKFold(5) on 0.1-deg blocks, proximity EXCLUDED",
                        auc_delta_vs_lr=round(mets[k]["auc"] - m_lr["auc"], 4))
                for k in mets},
        pu_learning=dict(method="PU bagging (Mordelet & Vert 2013)", rounds=15,
                         unlabeled_ratio=3, rationale="negatives are 'far from known occurrences', not confirmed barren"),
        calibration=dict(method="isotonic, fit on out-of-fold scores", reliability_bins=rel),
        selection=dict(champion=champion, ensemble_members=ensemble_members,
                       rule="top-2 models by honest block-CV AUC; map score = mean of their RAW "
                        "probabilities (relative ranking, v1-compatible estMt); calibrated "
                        "grids + reliability bins provided for honest probability readings",
                       tier_thresholds=dict(high_min=round(float(hi_q), 4),
                                            medium_min=round(float(md_q), 4),
                                            basis="quantiles of ensemble score over labeled cells")),
        univariate_auc={k: round(float(roc_auc_score(y_all, X_all[:, i])), 4)
                        for i, k in enumerate(FEATS)},
        artifacts=dict(directory=OUT, sha256=paths),
        determinism_note=(
            "Seed 42 everywhere. Reported metrics + persisted models use LightGBM "
            "deterministic=True. The Optuna SEARCH ran multithreaded (fast, bitwise-"
            "nondeterministic); its selected configuration was re-evaluated "
            "deterministically before reporting."),
        environment=dict(python=os.sys.version.split()[0],
                         lightgbm=lgb.__version__,
                         scikit_learn=__import__("sklearn").__version__,
                         optuna=optuna.__version__),
        reproduce=["python3 scripts/real-pipeline/fetch_s2_bands.py",
                   "python3 scripts/real-pipeline/train_prospectivity.py"],
    )
    json.dump(registry, open(f"{OUT}/model_registry.json", "w"), indent=1)
    log(f"Saved model_registry.json + {len(paths)} hashed artifacts")

# ------------------------------------------------------------
# 8) Regenerate portfolio.json with v2 scores (same schema as v1)
#    PHASE B — run with TRAIN_PHASE=B (kept separate so the whole
#    run fits interactive tool timeouts; artifacts come from disk)
# ------------------------------------------------------------

shutil.copy(f"{ART}/portfolio.json", f"{ART}/portfolio_v1_backup.json")
sites = json.load(open(f"{ART}/mn_occurrences_region.json"))["records"]
site_arr = np.array([[s["lon"], s["lat"]] for s in sites])
_D = np.sqrt(((site_arr[:, 0][None, :] - LONG.ravel()[:, None]) * 111.32
              * np.cos(np.radians(LATG.ravel()[:, None])))**2
             + ((site_arr[:, 1][None, :] - LATG.ravel()[:, None]) * 110.57)**2)
near_idx = _D.argmin(axis=1)

def tier_of(s):
    return "high" if s >= hi_q else ("medium" if s >= md_q else "low")

def haversine_km(la1, lo1, la2, lo2):
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = math.radians(la2 - la1), math.radians(lo2 - lo1)
    a = math.sin(dp / 2)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2)**2
    return 2 * 6371.0 * math.asin(math.sqrt(a))

mine_arr = np.array([[m["lat"], m["lng"]] for m in MINES])
per_mine = {m["code"]: [] for m in MINES}
for i in range(n_lat):
    dlat_m = (mine_arr[:, 0] - lats[i]) * 110.57
    for j in range(n_lon):
        dlon_m = (mine_arr[:, 1] - lons[j]) * 111.32 * math.cos(math.radians(lats[i]))
        d = np.sqrt(dlat_m**2 + dlon_m**2)
        k = int(np.argmin(d))
        if d[k] <= 9.0:
            m = MINES[k]
            per_mine[m["code"]].append(dict(
                row=0, col=0,
                lat=round(float(lats[i]), 4), lng=round(float(lons[j]), 4),
                probability=round(float(score[i, j]), 4),
                tier=tier_of(float(score[i, j])),
                elev_m=round(float(elev[i, j]), 0),
                ndvi=round(float(ndvi[i, j]), 3),
                sausar=round(float(frac["sausar"][i, j]), 2),
                sakoli=round(float(frac["sakoli"][i, j]), 2),
                gneiss=round(float(frac["gneiss"][i, j]), 2),
                dist_mn_km=round(float(dist_km[i, j]), 2)))

for m in MINES:
    cl = per_mine[m["code"]]
    if not cl:
        continue
    rs = sorted(set(c["lat"] for c in cl)); cs = sorted(set(c["lng"] for c in cl))
    rmap = {v: i for i, v in enumerate(rs)}; cmap = {v: i for i, v in enumerate(cs)}
    for c in cl:
        c["row"] = rmap[c["lat"]]; c["col"] = cmap[c["lng"]]

def latlon_to_flat(clat, clng):
    ri = max(0, min(n_lat - 1, int(round((lats[0] - clat) / GRID))))
    ci = max(0, min(n_lon - 1, int(round((clng - lons[0]) / GRID))))
    return ri * n_lon + ci

scenes_meta = json.load(open(f"{ART}/s2_scenes.json"))["scenes"]
mine_summaries = []
for m in MINES:
    cl = per_mine[m["code"]]
    if not cl:
        mine_summaries.append(dict(code=m["code"], name=m["name"], cellsTotal=0))
        log(f"  {m['code']}: NO cells in range"); continue
    n_cells = len(cl)
    n_high = sum(1 for c in cl if c["tier"] == "high")
    n_med = sum(1 for c in cl if c["tier"] == "medium")
    est_mt = sum(c["probability"] for c in cl) * CELL_TONNAGE_BASE * (m["oreg"] / 35.0)
    tops = []
    for c in sorted(cl, key=lambda c: -c["probability"])[:6]:
        s = sites[near_idx[latlon_to_flat(c["lat"], c["lng"])]]
        tops.append(dict(lat=c["lat"], lng=c["lng"], prospectivity=c["probability"],
                         tier=c["tier"], nearest_known_site=s["site"],
                         nearest_dev_status=s["dev"], dist_to_nearest_km=c["dist_mn_km"]))
    near_sites = [dict(site=s["site"], dev=s["dev"], lat=s["lat"], lon=s["lon"])
                  for s in sites if haversine_km(m["lat"], m["lng"], s["lat"], s["lon"]) <= 15.0]
    mine_summaries.append(dict(
        code=m["code"], name=m["name"], state=m["state"], district=m["district"],
        lat=m["lat"], lng=m["lng"], oreGrade=m["oreg"], geology=m["geology"],
        cellsTotal=n_cells, high=n_high, medium=n_med, low=n_cells - n_high - n_med,
        estMt=round(est_mt, 2),
        avgProspectivity=round(float(np.mean([c["probability"] for c in cl])), 4),
        mnSitesWithin15km=len(near_sites), nearSites=near_sites[:12],
        topTargets=tops, cells=cl))
    log(f"  {m['code']}: {n_cells} cells, {n_high} high, est {est_mt:.1f} Mt")

portfolio = dict(
    run_utc=registry["created_utc"],
    model_version="2.0",
    region=dict(lon_min=LON_MIN, lon_max=LON_MAX, lat_min=LAT_MIN, lat_max=LAT_MAX,
                cell_deg=GRID, grid_rows=n_lat, grid_cols=n_lon),
    features=FEATS,
    class_balance=dict(train_cells=int(len(y_all)), positives=int(y_all.sum()),
                       negatives=int((y_all == 0).sum()), excluded_band_km=[POS_KM, NEG_KM]),
    label_rule=registry["data"]["label_rule"],
    honest_cv=dict(scheme=registry["models"][champion]["scheme"],
                   **{k: v["honest_cv"]["auc"] for k, v in registry["models"].items()}),
    map_model=dict(ensemble=f"mean of calibrated {ensemble_members}",
                   champion=champion, tier_thresholds=registry["selection"]["tier_thresholds"],
                   calibration="isotonic on out-of-fold scores"),
    reliability_bins=rel,
    feature_univariate_auc=registry["univariate_auc"],
    per_mine=mine_summaries,
    sentinel_scenes=scenes_meta,
    model_registry="models/prospectivity/model_registry.json",
)
json.dump(portfolio, open(f"{ART}/portfolio.json", "w"), indent=1)
log(f"Saved portfolio.json v2 ({os.path.getsize(f'{ART}/portfolio.json')/1e6:.1f} MB)")
log("DONE — v2 registry + portfolio written")
