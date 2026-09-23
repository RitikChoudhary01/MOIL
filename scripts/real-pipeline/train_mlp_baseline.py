#!/usr/bin/env python3
# ============================================================
# MOIL Intelligence — MLP neural-network baseline (v2.1)
# Adds a 5th model to the honest leaderboard: a real neural net
# (sklearn MLPClassifier) trained on the SAME 12 real features,
# validated with the SAME discovery-blind spatial block CV
# (GroupKFold-5 on 0.1° blocks) and the SAME seed (42).
#
# Purpose: complete the model ladder with a deep-learning-class
# baseline. Prithvi-EO-2.0 fine-tune (GPU) remains the documented
# stretch path — see DEPLOY_GUIDE.md / MODEL_CARD.md. Nothing here
# is simulated: features come from the cached REAL rasters.
#
# Persistence: models/prospectivity/mlp.joblib (Pipeline with
# StandardScaler → self-contained), registry + portfolio patched.
# ============================================================
import hashlib, json, os, warnings
from datetime import datetime, timezone

import numpy as np
import joblib

warnings.filterwarnings("ignore")
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score, brier_score_loss, average_precision_score

BASE = "/home/z/my-project"
ART = f"{BASE}/research/multi-mine/artifacts"
OUT = f"{BASE}/models/prospectivity"
SEED = 42

GRID = 0.01
LON_MIN, LON_MAX = 78.72, 80.62
LAT_MIN, LAT_MAX = 20.84, 22.02


def log(m):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}", flush=True)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def make_mlp():
    return Pipeline([
        ("scaler", StandardScaler()),
        ("mlp", MLPClassifier(hidden_layer_sizes=(128, 64), activation="relu",
                              alpha=1e-3, batch_size=256, learning_rate_init=1e-3,
                              max_iter=120, early_stopping=True, n_iter_no_change=8,
                              validation_fraction=0.1, random_state=SEED)),
    ])


# ---- 1) Load the SAME real cached features, SAME order ----
z = np.load(f"{ART}/region_features.npz")
elev, slope, dist_km, label = z["elev"], z["slope"], z["dist_km"], z["label"]
frac = {k: z[k] for k in ("sausar", "sakoli", "gneiss", "other")}
ndvi, swir_ratio, brightness = z["ndvi"], z["swir_ratio"], z["brightness"]

b = np.load(f"{ART}/s2_bands.npz")
eps = 1e-6
ferric = (b["red"] / (b["blue"] + eps)).astype(np.float32)
ferrous = (b["swir16"] / (b["nir"] + eps)).astype(np.float32)
clay_oh = (b["swir16"] / (b["swir22"] + eps)).astype(np.float32)

lons = np.arange(LON_MIN + GRID / 2, LON_MAX, GRID)
lats = np.arange(LAT_MAX - GRID / 2, LAT_MIN, -GRID)
LATG, LONG = np.meshgrid(lats, lons, indexing="ij")
assert LATG.shape == label.shape, "grid shape mismatch vs cache"

FEAT_ARRAYS = [frac["sausar"], frac["sakoli"], frac["gneiss"], frac["other"],
               elev, slope, ndvi, swir_ratio, brightness,
               ferric, ferrous, clay_oh]
tr_mask = (label >= 0)
y_all = label[tr_mask].astype(int)
X_all = np.column_stack([a[tr_mask] for a in FEAT_ARRAYS]).astype(np.float64)

block_id = ((LATG.ravel()[tr_mask.ravel()] // 0.1).astype(int) * 1000
            + (LONG.ravel()[tr_mask.ravel()] // 0.1).astype(int))
uniq = {v: i for i, v in enumerate(sorted(set(block_id.tolist())))}
groups = np.array([uniq[v] for v in block_id])
log(f"Cells: {len(y_all)} (pos={int(y_all.sum())}) | blocks: {len(uniq)}")

# ---- 2) Honest spatial block CV (identical folds as v2 training) ----
gkf = GroupKFold(n_splits=5)
oof = np.zeros(len(y_all), dtype=float)
for i, (tr_i, te_i) in enumerate(gkf.split(X_all, y_all, groups=groups)):
    m = make_mlp()
    m.fit(X_all[tr_i], y_all[tr_i])
    oof[te_i] = m.predict_proba(X_all[te_i])[:, 1]
    log(f"fold {i + 1}/5 done")

metrics = dict(
    auc=round(float(roc_auc_score(y_all, oof)), 4),
    brier=round(float(brier_score_loss(y_all, oof)), 4),
    auprc=round(float(average_precision_score(y_all, oof)), 4),
)
log(f"MLP honest block-CV: {metrics}")

# ---- 3) Persist: final artifact fit on ALL labeled cells ----
final = make_mlp()
final.fit(X_all, y_all)
joblib.dump(final, f"{OUT}/mlp.joblib")
log("saved mlp.joblib")

# ---- 4) Patch registry + portfolio (keep champion contract intact) ----
reg_path = f"{OUT}/model_registry.json"
registry = json.load(open(reg_path))
aucs = {k: v["honest_cv"]["auc"] for k, v in registry["models"].items()}
if metrics["auc"] > max(aucs.values()):
    log(f"WARNING: MLP AUC {metrics['auc']} would beat champion "
        f"{max(aucs, key=aucs.get)} ({max(aucs.values())}) — NOT promoting; "
        f"registered as baseline only. Honest reporting preserved.")
registry["models"]["mlp"] = {
    "scheme": "sklearn MLPClassifier(128,64) on standardized features; "
              "early stopping; alpha=1e-3 — neural-network baseline",
    "honest_cv": metrics,
    "role": "baseline (neural net)",
}
registry["artifacts"]["sha256"]["mlp.joblib"] = sha256_file(f"{OUT}/mlp.joblib")
registry["models"]["mlp"]["auc_delta_vs_lr"] = round(
    metrics["auc"] - registry["models"]["logistic"]["honest_cv"]["auc"], 4)
registry["created_utc"] = datetime.now(timezone.utc).isoformat()
json.dump(registry, open(reg_path, "w"), indent=2)

port_path = f"{ART}/portfolio.json"
portfolio = json.load(open(port_path))
portfolio.setdefault("honest_cv", {})["mlp"] = metrics["auc"]
json.dump(portfolio, open(port_path, "w"), indent=2)
log("registry + portfolio patched (champion untouched)")

print(json.dumps({"mlp_honest_cv": metrics,
                  "champion": registry["selection"]["champion"],
                  "leaderboard_auc": {**aucs, "mlp": metrics["auc"]}}, indent=2))
