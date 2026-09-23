# ============================================================
# MOIL Intelligence — production artifact integrity tests.
# Validates the PERSISTED prospectivity model registry (v2):
# sha256 integrity, honest-CV metric sanity, feature contract,
# calibration reliability structure, and portfolio consistency.
#
# Run: python3 -m pytest tests/python/test_pipeline.py -v
# Tests SKIP (not fail) when artifacts are absent, so CI on a
# fresh checkout without trained models stays green.
# ============================================================
import hashlib
import json
import os

import numpy as np
import pytest

BASE = os.environ.get("MOIL_BASE", "/home/z/my-project")
ART = f"{BASE}/research/multi-mine/artifacts"
MODELS = f"{BASE}/models/prospectivity"
NEW_FEATURES = ["ferric_iron", "ferrous_iron", "clay_oh"]
MODEL_FILES = [
    "logistic.joblib",
    "random_forest.joblib",
    "lightgbm.joblib",
    "lightgbm_pu.joblib",
    "calibrators.joblib",
    "map_scores_v2.npz",
]

pytestmark = pytest.mark.filterwarnings("ignore")


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


requires_registry = pytest.mark.skipif(
    not os.path.exists(f"{MODELS}/model_registry.json"),
    reason="model registry not trained yet (run scripts/real-pipeline/train_prospectivity.py)",
)


# ------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------
@pytest.fixture(scope="module")
def registry():
    with open(f"{MODELS}/model_registry.json") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def portfolio():
    with open(f"{ART}/portfolio.json") as f:
        return json.load(f)


# ------------------------------------------------------------
# Registry integrity
# ------------------------------------------------------------
@requires_registry
class TestRegistryIntegrity:
    def test_schema_version_and_seed(self, registry):
        assert registry["schema_version"] == "2.0"
        assert registry["seed"] == 42, "training must be reproducible (seed 42)"

    def test_artifact_sha256_matches_files(self, registry):
        """Every registered sha256 must match the file on disk — proves the
        registry describes EXACTLY these artifacts (no stale/fake hashes)."""
        hashes = registry["artifacts"]["sha256"]
        for name in MODEL_FILES:
            assert name in hashes, f"{name} missing from registry"
            path = f"{MODELS}/{name}"
            assert os.path.exists(path), f"{name} missing on disk"
            assert sha256_file(path) == hashes[name], f"sha256 mismatch for {name}"

    def test_training_data_fingerprint_registered(self, registry):
        d = registry["data"]
        assert os.path.exists(f"{ART}/region_features.npz")
        assert d["feature_cache_sha256"] == sha256_file(f"{ART}/region_features.npz")
        assert os.path.exists(f"{ART}/s2_bands.npz")
        assert d["s2_bands_sha256"] == sha256_file(f"{ART}/s2_bands.npz")

    def test_feature_contract(self, registry):
        feats = registry["features"]["order"]
        assert len(feats) == len(set(feats)), "duplicate features"
        assert set(NEW_FEATURES).issubset(set(feats)), "alteration indices missing"
        listed = registry["features"]["new_in_v2"]
        assert set(listed) == set(NEW_FEATURES), "new_in_v2 must list the 3 alteration indices"

    def test_class_balance_recorded(self, registry):
        d = registry["data"]
        assert d["positives"] > 0 and d["negatives"] > d["positives"]
        assert d["cells_labeled"] == d["positives"] + d["negatives"]

    def test_label_caveat_present(self, registry):
        """Honesty requirement: proximity labels are NOT ground truth."""
        assert "NOT ground truth" in registry["data"]["label_rule"]["caveat"]


# ------------------------------------------------------------
# Honest-CV metric sanity
# ------------------------------------------------------------
@requires_registry
class TestHonestCV:
    def test_all_models_report_metrics_in_range(self, registry):
        for name, m in registry["models"].items():
            cv = m["honest_cv"]
            assert 0.5 <= cv["auc"] <= 1.0, f"{name} AUC out of range: {cv['auc']}"
            assert 0.0 <= cv["brier"] <= 1.0
            assert 0.0 <= cv["auprc"] <= 1.0

    def test_auprc_beats_random_baseline(self, registry):
        """With ~1.6% positives, AUPRC must beat the prevalence baseline."""
        prev = registry["data"]["positives"] / registry["data"]["cells_labeled"]
        for name, m in registry["models"].items():
            assert m["honest_cv"]["auprc"] > prev, (
                f"{name} AUPRC {m['honest_cv']['auprc']} not better than random {prev:.4f}"
            )

    def test_selection_consistency(self, registry):
        aucs = {k: v["honest_cv"]["auc"] for k, v in registry["models"].items()}
        sel = registry["selection"]
        assert sel["champion"] == max(aucs, key=aucs.get)
        members = sel["ensemble_members"]
        assert len(members) == 2
        assert aucs[members[0]] >= aucs[members[1]]
        # ensemble members must be the top-2 by honest AUC
        top2 = sorted(aucs, key=aucs.get, reverse=True)[:2]
        assert set(members) == set(top2)

    def test_champion_auc_floor(self, registry):
        """Government-grade floor: champion honest AUC >= 0.85."""
        champion = registry["selection"]["champion"]
        assert registry["models"][champion]["honest_cv"]["auc"] >= 0.85


# ------------------------------------------------------------
# Calibration (isotonic) reliability
# ------------------------------------------------------------
@requires_registry
class TestCalibration:
    def test_reliability_bins_well_formed(self, registry):
        bins = registry["calibration"]["reliability_bins"]
        assert len(bins) >= 5, "too few reliability bins to judge calibration"
        for b in bins:
            assert 0.0 <= b["mean_predicted"] <= 1.0
            assert 0.0 <= b["observed_rate"] <= 1.0
            assert b["n"] > 0

    def test_reliability_monotone_overall(self, registry):
        """Predicted probabilities should rank-consistently track observed
        rates across bins (Spearman > 0.8 for a calibrated model)."""
        bins = registry["calibration"]["reliability_bins"]
        pred = [b["mean_predicted"] for b in bins]
        obs = [b["observed_rate"] for b in bins]

        def rank(v):
            order = sorted(range(len(v)), key=lambda i: v[i])
            r = [0.0] * len(v)
            for pos, i in enumerate(order):
                r[i] = pos
            return r

        rp, ro = rank(pred), rank(obs)
        n = len(rp)
        d2 = sum((rp[i] - ro[i]) ** 2 for i in range(n))
        rho = 1 - 6 * d2 / (n * (n * n - 1))
        assert rho > 0.8, f"calibration not monotone (Spearman rho={rho:.3f})"


# ------------------------------------------------------------
# Map scores + portfolio consistency
# ------------------------------------------------------------
@requires_registry
class TestMapAndPortfolio:
    def test_map_scores_in_probability_range(self):
        z = np.load(f"{MODELS}/map_scores_v2.npz")
        for k in z.files:
            if k.startswith("p_") or k == "score":
                v = z[k]
                assert v.min() >= 0.0 and v.max() <= 1.0, f"{k} out of [0,1]"

    def test_tier_masks_consistent(self):
        z = np.load(f"{MODELS}/map_scores_v2.npz")
        hi, md = z["tier_high"], z["tier_medium"]
        assert not (hi & md).any(), "a cell cannot be both high and medium tier"
        assert hi.sum() > 0 and md.sum() > 0

    def test_portfolio_is_v2_with_all_mines(self, portfolio):
        assert portfolio["model_version"] == "2.0"
        assert len(portfolio["per_mine"]) == 10
        codes = {m["code"] for m in portfolio["per_mine"]}
        assert codes == {"BLGT", "BRWL", "UKWA", "TRDI", "DGBZ",
                         "CHKL", "KNDR", "MNSR", "STSJ", "GMGN"}

    def test_cell_probabilities_and_tiers(self, portfolio):
        thr = portfolio["map_model"]["tier_thresholds"]
        for mine in portfolio["per_mine"]:
            for c in mine.get("cells", []):
                p = c["probability"]
                assert 0.0 <= p <= 1.0, f"{mine['code']} cell prob {p}"
                expected = ("high" if p >= thr["high_min"]
                            else "medium" if p >= thr["medium_min"] else "low")
                assert c["tier"] == expected, f"{mine['code']} tier mismatch at {c['lat']},{c['lng']}"

    def test_portfolio_honest_cv_matches_registry(self, portfolio, registry):
        for name, m in registry["models"].items():
            assert portfolio["honest_cv"][name] == m["honest_cv"]["auc"]

    def test_top_targets_cite_real_sites(self, portfolio):
        """Top targets must reference actual USGS MRDS site names.
        Distance to nearest occurrence can be LARGE for top-ranked cells —
        that is the point of PU learning (discovery-frontier targets far
        from known sites) — so only regional sanity bounds apply."""
        occ = json.load(open(f"{ART}/mn_occurrences_region.json"))["records"]
        site_names = {s["site"] for s in occ}
        for mine in portfolio["per_mine"]:
            for t in mine.get("topTargets", []):
                assert t["nearest_known_site"] in site_names
                assert 0.0 <= t["dist_to_nearest_km"] <= 200.0  # region-diagonal sanity; large = discovery frontier

    def test_sentinel_scene_metadata_real(self, portfolio):
        scenes = portfolio["sentinel_scenes"]
        assert len(scenes) >= 1
        for s in scenes:
            assert s["scene"].startswith("S2"), "scene IDs must be real Sentinel-2 IDs"
            assert 0 <= s["cloud_pct"] <= 8
