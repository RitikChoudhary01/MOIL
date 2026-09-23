#!/usr/bin/env python3
# ============================================================
# MOIL Intelligence — Multi-Mine REAL prospectivity pipeline
# Extends the validated Balaghat pipeline (research/real-pipeline)
# to ALL 10 MOIL mines using only REAL public data:
#   - USGS MRDS (manganese occurrence labels, public domain)
#   - GSI 1:2M geology via Esri India Living Atlas (lithology)
#   - Copernicus DEM GLO-30 (elevation, slope)
#   - Sentinel-2 L2A (NDVI, SWIR ratio, brightness)
# Labels = proximity to known mineralization (NOT ground truth).
# Honest validation = discovery-blind spatial block CV,
# proximity feature EXCLUDED from the map model.
# ============================================================
import json, math, os, sys, time, warnings
from datetime import datetime, timezone

import numpy as np
import requests

warnings.filterwarnings("ignore")
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.transform import from_bounds as transform_from_bounds
import rasterio
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score

BASE = "/home/z/my-project"
OUT = f"{BASE}/research/multi-mine/artifacts"
os.makedirs(OUT, exist_ok=True)

GRID = 0.01  # deg, ~1.1 km cells (same as Balaghat pipeline)
LON_MIN, LON_MAX = 78.72, 80.62
LAT_MIN, LAT_MAX = 20.84, 22.02

# ---- Mine master data (mirrors src/lib/mines.ts exactly) ----
MINES = [
    dict(code="BLGT", name="Balaghat Mine",    state="Madhya Pradesh", district="Balaghat",  lat=21.81, lng=80.15, oreg=38, geology="Sausar"),
    dict(code="BRWL", name="Bharweli Mine",    state="Madhya Pradesh", district="Balaghat",  lat=21.90, lng=80.07, oreg=40, geology="Sausar"),
    dict(code="UKWA", name="Ukwa Mine",        state="Madhya Pradesh", district="Balaghat",  lat=21.90, lng=80.41, oreg=36, geology="Sausar"),
    dict(code="TRDI", name="Tirodi Mine",      state="Madhya Pradesh", district="Balaghat",  lat=21.73, lng=79.67, oreg=30, geology="Sausar"),
    dict(code="DGBZ", name="Dongri Buzurg Mine", state="Maharashtra",  district="Bhandara",  lat=20.98, lng=79.33, oreg=30, geology="Sakoli"),
    dict(code="CHKL", name="Chikla Mine",      state="Maharashtra",    district="Bhandara",  lat=21.33, lng=79.65, oreg=35, geology="Sakoli"),
    dict(code="KNDR", name="Kandri Mine",      state="Maharashtra",    district="Nagpur",    lat=21.40, lng=79.27, oreg=38, geology="Amgaon"),
    dict(code="MNSR", name="Mansar Mine",      state="Maharashtra",    district="Nagpur",    lat=21.38, lng=79.24, oreg=28, geology="Amgaon"),
    dict(code="STSJ", name="Sitasaongi Mine",  state="Maharashtra",    district="Gondia",    lat=21.07, lng=80.12, oreg=32, geology="Sakoli"),
    dict(code="GMGN", name="Gumgaon Mine",     state="Maharashtra",    district="Nagpur",    lat=21.22, lng=78.92, oreg=35, geology="Amgaon"),
]
CELL_TONNAGE_BASE = 0.26  # Mt per fully-prospective cell (matches api-utils)

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

# ------------------------------------------------------------
# 1) Grid: cell centers over the full mining region
# ------------------------------------------------------------
lons = np.arange(LON_MIN + GRID/2, LON_MAX, GRID)
lats = np.arange(LAT_MAX - GRID/2, LAT_MIN, -GRID)  # north→south rows
n_lat, n_lon = len(lats), len(lons)
log(f"Region grid: {n_lat} rows x {n_lon} cols = {n_lat*n_lon} cells @ {GRID} deg")
LATG, LONG = np.meshgrid(lats, lons, indexing="ij")

# ------------------------------------------------------------
# 2) USGS MRDS occurrences (labels) — one regional WFS query
# ------------------------------------------------------------
def fetch_mrds():
    url = ("https://mrdata.usgs.gov/wfs/mrds?SERVICE=WFS&REQUEST=GetFeature"
           "&TYPENAME=mrds&VERSION=1.0.0&maxFeatures=3000"
           f"&BBOX={LON_MIN-0.2},{LAT_MIN-0.2},{LON_MAX+0.2},{LAT_MAX+0.2}")
    log("Fetching USGS MRDS occurrences (regional bbox)...")
    r = requests.get(url, timeout=180, headers={"User-Agent": "MOIL-Intelligence-SIH/1.0"})
    r.raise_for_status()
    txt = r.text
    import re
    feats = []
    for m in re.finditer(r"<gml:featureMember[^>]*>(.*?)</gml:featureMember>", txt, re.S):
        blk = m.group(1)
        def tag(t, ns="ms"):
            mm = re.search(rf"<{ns}:{t}[^>]*>(.*?)</{ns}:{t}>", blk, re.S)
            return mm.group(1).strip() if mm else ""
        # commodity filter: code_list must mention MN (e.g. " MN")
        code_list = tag("code_list").upper()
        if "MN" not in code_list:
            continue
        # coordinates live in gml:Point/gml:coordinates as "lon,lat"
        pt = re.search(r"<gml:Point[^>]*>\s*<gml:coordinates>\s*([-\d.]+)[,\s]+([-\d.]+)", blk, re.S)
        if not pt:
            continue
        lon, lat = float(pt.group(1)), float(pt.group(2))
        if not (LAT_MIN - 0.2 <= lat <= LAT_MAX + 0.2 and LON_MIN - 0.2 <= lon <= LON_MAX + 0.2):
            continue
        feats.append(dict(
            site=tag("site_name") or "Unnamed site",
            dev=tag("dev_stat") or "Unknown",
            oper=tag("oper_type") or "",
            ored=tag("ore") or "Mn",
            lat=lat, lon=lon,
        ))
    return feats

t0 = time.time()
sites = fetch_mrds()
log(f"MRDS: {len(sites)} Mn records in region ({time.time()-t0:.0f}s)")
if len(sites) < 20:
    sys.exit("FATAL: too few MRDS records — WFS parse failed")
json.dump(dict(count=len(sites), records=sites), open(f"{OUT}/mn_occurrences_region.json", "w"), indent=1)

site_arr = np.array([[s["lon"], s["lat"]] for s in sites])

def dist_to_nearest_site_km(plat, plon):
    dlon = (site_arr[:, 0] - plon) * 111.32 * math.cos(math.radians(plat))
    dlat = (site_arr[:, 1] - plat) * 110.57
    d = np.sqrt(dlon**2 + dlat**2)
    i = int(np.argmin(d))
    return float(d[i]), i

# -----------------------------------------------------------
# Cache: raw region features (so re-runs skip all downloads)
# -----------------------------------------------------------
CACHE = f"{OUT}/region_features.npz"
sites_meta = [dict(site=s["site"], dev=s["dev"], lat=s["lat"], lon=s["lon"]) for s in sites]

if os.path.exists(CACHE):
    log(f"Loading cached region features from {CACHE}")
    z = np.load(CACHE)
    elev = z["elev"]; slope = z["slope"]; dist_km = z["dist_km"]; label = z["label"]
    frac = {k: z[k] for k in ("sausar", "sakoli", "gneiss", "other")}
    ndvi = z["ndvi"]; swir_ratio = z["swir_ratio"]; brightness = z["brightness"]
else:
    pass  # falls through to full fetch below

if not os.path.exists(CACHE):
    # (full fetch path — steps 3-6 inline)
    pass

def fetch_geology():
    url = ("https://livingatlas.esri.in/server1/rest/services/Geology/Geology/MapServer/0/query"
           f"?where=1%3D1&geometry={LON_MIN},{LAT_MIN},{LON_MAX},{LAT_MAX}"
           "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"
           "&outFields=*&returnGeometry=true&outSR=4326&f=json&resultRecordCount=2000")
    log("Fetching GSI 1:2M geology polygons (regional envelope)...")
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    js = r.json()
    polys = []
    for f in js.get("features", []):
        geom = f.get("geometry", {})
        attrs = f.get("attributes", {})
        name = str(attrs.get("GROUP", attrs.get("Group", "") or
                             attrs.get("LITH_GROUP", "") or
                             attrs.get("LITHOLOGY", "") or "")).upper()
        if not name:
            name = str(next((v for v in attrs.values() if isinstance(v, str)), "")).upper()
        if "rings" in geom:
            try:
                g = shape({"type": "Polygon", "coordinates": geom["rings"]})
                if not g.is_valid:
                    g = g.buffer(0)
                if not g.is_empty:
                    polys.append((name, g))
            except Exception:
                continue
    return polys

def litho_group(name):
    if "SAUSAR" in name: return "sausar"
    if "SAKOLI" in name: return "sakoli"
    if any(k in name for k in ("AMGAON", "TIRODI", "BETAGUL", "GNEISS")): return "gneiss"
    return "other"

CACHE = f"{OUT}/region_features.npz"
if os.path.exists(CACHE):
    log(f"Loading cached region features — skipping ALL downloads")
    z = np.load(CACHE)
    elev, slope, dist_km, label = z["elev"], z["slope"], z["dist_km"], z["label"]
    frac = {k: z[k] for k in ("sausar", "sakoli", "gneiss", "other")}
    ndvi, swir_ratio, brightness = z["ndvi"], z["swir_ratio"], z["brightness"]
    polys, groups, scene_meta = [], {}, []  # placeholders (manifest may re-fill)
else:
    t0 = time.time()
    polys = fetch_geology()
    groups = {}
    for name, _ in polys:
        g = litho_group(name)
        groups[g] = groups.get(g, 0) + 1
    log(f"Geology: {len(polys)} polygons, group parts {groups} ({time.time()-t0:.0f}s)")

    # lithology fractions per cell: 3x3 sub-samples per cell
    SUB = 3
    offs = np.linspace(-GRID/2 + GRID/(2*SUB), GRID/2 - GRID/(2*SUB), SUB)
    frac = {k: np.zeros((n_lat, n_lon), dtype=np.float32) for k in ("sausar", "sakoli", "gneiss", "other")}
    if polys:
        geo_geoms = [g for _, g in polys]
        geo_names = [litho_group(n) for n, _ in polys]
        geo_tree = STRtree(geo_geoms)
        for i, la in enumerate(lats):
            for j, lo in enumerate(lons):
                cnt = {"sausar": 0, "sakoli": 0, "gneiss": 0, "other": 0}
                for dla in offs:
                    for dlo in offs:
                        p = Point(lo + dlo, la + dla)
                        hit = "other"
                        cand = geo_tree.query(p)
                        for ci in np.atleast_1d(cand):
                            if geo_geoms[int(ci)].contains(p):
                                hit = geo_names[int(ci)]; break
                        cnt[hit] += 1
                for k in frac:
                    frac[k][i, j] = cnt[k] / (SUB*SUB)
        if i % 30 == 0:
            log(f"  lithology row {i+1}/{n_lat}")
    log("Lithology fractions computed (3x3 sub-sampling)")

# ------------------------------------------------------------
# 4) Copernicus DEM GLO-30 → elevation + slope
# ------------------------------------------------------------
def dem_tiles():
    tiles = []
    for lat_i in (20, 21, 22):
        for lon_i in range(78, 82):
            tiles.append(f"https://copernicus-dem-30m.s3.amazonaws.com/"
                         f"Copernicus_DSM_COG_10_N{lat_i:02d}_00_E{lon_i:03d}_00_DEM/"
                         f"Copernicus_DSM_COG_10_N{lat_i:02d}_00_E{lon_i:03d}_00_DEM.tif")
    return tiles

def rasterize_to_grid(src_path):
    dst = np.full((n_lat, n_lon), np.nan, dtype=np.float32)
    try:
        with rasterio.open(src_path) as src:
            dst_transform = transform_from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, n_lon, n_lat)
            reproject(
                source=rasterio.band(src, 1),
                destination=dst,
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=dst_transform, dst_crs="EPSG:4326",
                src_nodata=src.nodata if src.nodata is not None else -32768.0,
                dst_nodata=np.nan,
                resampling=Resampling.average,
            )
    except Exception as e:
        log(f"  WARN tile failed ...{src_path[-45:]}: {type(e).__name__}")
    return dst

# ------------------------------------------------------------
# 4+5) DEM + Sentinel-2 (only when not loaded from cache)
# ------------------------------------------------------------
if not os.path.exists(CACHE):
  log("Fetching Copernicus DEM GLO-30 tiles (windowed average to grid)...")
  t0 = time.time()
  elev = np.full((n_lat, n_lon), np.nan, dtype=np.float32)
  for t in dem_tiles():
      part = rasterize_to_grid(t)
      good = ~np.isnan(part)
      elev[good] = part[good]
  n_dem = int((~np.isnan(elev)).sum())
  log(f"DEM coverage: {n_dem}/{n_lat*n_lon} cells ({time.time()-t0:.0f}s)")
  if n_dem < n_lat * n_lon * 0.5:
      sys.exit("FATAL: DEM coverage too low")
  if np.isnan(elev).any():
      elev[np.isnan(elev)] = np.nanmean(elev)
  gy, gx = np.gradient(elev, GRID*111.32, GRID*111.32*math.cos(math.radians(21.5)))
  slope = np.degrees(np.arctan(np.sqrt(gy**2 + gx**2))).astype(np.float32)

# ------------------------------------------------------------
# 5) Sentinel-2 L2A — latest low-cloud scene per MGRS tile
# ------------------------------------------------------------
S2_BANDS = {"blue": "B02", "red": "B04", "nir": "B08", "swir16": "B11"}

def fetch_s2():
    body = dict(
        collections=["sentinel-2-l2a"],
        bbox=[LON_MIN, LAT_MIN, LON_MAX, LAT_MAX],
        datetime="2025-11-01T00:00:00Z/2026-09-01T00:00:00Z",
        query={"eo:cloud_cover": dict(lt=8)},
        limit=60,
    )
    log("Searching Sentinel-2 L2A scenes (STAC)...")
    r = requests.post("https://earth-search.aws.element84.com/v1/search", json=body, timeout=90)
    r.raise_for_status()
    feats = r.json().get("features", [])
    by_tile = {}
    for f in feats:
        t = f["properties"].get("grid:code", f["id"].split("_")[0])
        dt = f["properties"].get("datetime", "")
        if t not in by_tile or dt > by_tile[t][0]:
            by_tile[t] = (dt, f)
    scenes = {t: v[1] for t, v in by_tile.items()}
    log(f"S2: {len(feats)} scenes found, using {len(scenes)} tiles: {list(scenes)}")
    return scenes

def band_url(scene_item, band):
    href = scene_item["assets"][band]["href"]
    if href.startswith("s3://sentinel-cogs"):
        href = href.replace("s3://sentinel-cogs", "https://sentinel-cogs.s3.us-west-2.amazonaws.com")
    return href

def mosaic_band(band_key):
    # element84 earth-search v1 uses common asset names: blue, red, nir, swir16
    acc = np.full((n_lat, n_lon), np.nan, dtype=np.float64)
    cov = np.zeros((n_lat, n_lon), dtype=np.int16)
    for t, item in scenes.items():
        assets = item["assets"]
        # resolve asset name robustly
        asset_name = band_key if band_key in assets else S2_BANDS[band_key]
        part = rasterize_to_grid(band_url(item, asset_name))
        good = ~np.isnan(part)
        acc[good] = part[good]; cov[good] += 1
    acc[cov == 0] = np.nan
    log(f"  {band_key}: max tile coverage={cov.max()}")
    return acc

if not os.path.exists(CACHE):
  t0 = time.time()
  scenes = fetch_s2()
  scene_meta = []
  for t, item in scenes.items():
      p = item["properties"]
      scene_meta.append(dict(tile=t, scene=item["id"], date=p.get("datetime", "")[:10],
                             cloud_pct=round(p.get("eo:cloud_cover", -1), 2)))
  band_data = {}
  for b in ("blue", "red", "nir", "swir16"):
      band_data[b] = mosaic_band(b)
  for b, arr in band_data.items():
      if np.isnan(arr).any():
          arr[np.isnan(arr)] = np.nanmean(arr)
  log(f"Sentinel-2 mosaics done ({time.time()-t0:.0f}s)")

  ndvi = ((band_data["nir"] - band_data["red"]) / (band_data["nir"] + band_data["red"] + 1e-9)).astype(np.float32)
  swir_ratio = (band_data["swir16"] / (band_data["nir"] + band_data["swir16"] + 1e-9)).astype(np.float32)
  brightness = (band_data["blue"] / 10000.0).astype(np.float32)

  # distances + labels
  site_lon = site_arr[:, 0][None, :]
  site_lat = site_arr[:, 1][None, :]
  latc_col = LATG.ravel()[:, None]; lonc_col = LONG.ravel()[:, None]
  dlon_km = (site_lon - lonc_col) * 111.32 * np.cos(np.radians(latc_col))
  dlat_km = (site_lat - latc_col) * 110.57
  D = np.sqrt(dlon_km**2 + dlat_km**2)          # (n_cells, n_sites)
  dist_km = D.min(axis=1).reshape(n_lat, n_lon).astype(np.float32)
  near_idx = D.argmin(axis=1)

  POS_KM, NEG_KM = 1.5, 3.0
  label = np.full((n_lat, n_lon), -1, dtype=np.int8)
  label[dist_km <= POS_KM] = 1
  label[dist_km >= NEG_KM] = 0

  np.savez_compressed(
      CACHE, elev=elev, slope=slope, dist_km=dist_km, label=label,
      sausar=frac["sausar"], sakoli=frac["sakoli"], gneiss=frac["gneiss"], other=frac["other"],
      ndvi=ndvi, swir_ratio=swir_ratio, brightness=brightness,
  )
  log(f"Cached region features → {CACHE}")
else:
  near_idx = None

# near_idx is always recomputable in ~1s (needed for per-mine top-target annotation)
site_lon_all = site_arr[:, 0][None, :]
site_lat_all = site_arr[:, 1][None, :]
_latc = LATG.ravel()[:, None]; _lonc = LONG.ravel()[:, None]
_dlon = (site_lon_all - _lonc) * 111.32 * np.cos(np.radians(_latc))
_dlat = (site_lat_all - _latc) * 110.57
_D = np.sqrt(_dlon**2 + _dlat**2)
near_idx = _D.argmin(axis=1)

feats = {
    "sausar_frac": frac["sausar"], "sakoli_frac": frac["sakoli"],
    "gneiss_frac": frac["gneiss"], "other_frac": frac["other"],
    "elev_m": elev, "slope_deg": slope,
    "ndvi": ndvi.astype(np.float32), "swir_ratio": swir_ratio.astype(np.float32),
    "brightness": brightness.astype(np.float32),
}
FEAT_ORDER = ["sausar_frac", "sakoli_frac", "gneiss_frac", "other_frac",
              "elev_m", "slope_deg", "ndvi", "swir_ratio", "brightness"]

tr_mask = (label >= 0)
y_all = label[tr_mask].astype(int)
X_all = np.column_stack([feats[k][tr_mask] for k in FEAT_ORDER]).astype(np.float64)
dist_all = dist_km[tr_mask]
log(f"Training cells: {len(y_all)} (pos={int(y_all.sum())}, neg={int((y_all==0).sum())})")

block_id = ((LATG.ravel()[tr_mask.ravel()] // 0.1).astype(int) * 1000 + (LONG.ravel()[tr_mask.ravel()] // 0.1).astype(int))
uniq = {b: i for i, b in enumerate(sorted(set(block_id.tolist())))}
groups = np.array([uniq[b] for b in block_id])

def block_cv(model_fn, X, y, gr):
    gkf = GroupKFold(n_splits=5)
    oof = np.zeros_like(y, dtype=float)
    for tr_i, te_i in gkf.split(X, y, groups=gr):
        m = model_fn()
        m.fit(X[tr_i], y[tr_i])
        oof[te_i] = m.predict_proba(X[te_i])[:, 1]
    return float(roc_auc_score(y, oof))

def make_lr(): return LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced")
def make_rf(): return RandomForestClassifier(n_estimators=300, min_samples_leaf=3, n_jobs=-1, random_state=42, class_weight="balanced_subsample")

log("Training: honest spatial block CV (no proximity feature)...")
auc_lr = block_cv(make_lr, X_all, y_all, groups)
auc_rf = block_cv(make_rf, X_all, y_all, groups)
log(f"  HONEST  AUC logistic={auc_lr:.3f}  rf={auc_rf:.3f}")

X_circ = np.column_stack([X_all, dist_all])
auc_lr_c = block_cv(make_lr, X_circ, y_all, groups)
auc_rf_c = block_cv(make_rf, X_circ, y_all, groups)
log(f"  CIRCULAR (with dist_km) AUC logistic={auc_lr_c:.3f}  rf={auc_rf_c:.3f}")

from sklearn.model_selection import cross_val_score
auc_lr_rand = float(cross_val_score(make_lr(), X_all, y_all, cv=5, scoring="roc_auc").mean())
auc_rf_rand = float(cross_val_score(make_rf(), X_all, y_all, cv=5, scoring="roc_auc").mean())
log(f"  RANDOM k-fold (inflated) AUC logistic={auc_lr_rand:.3f}  rf={auc_rf_rand:.3f}")

lr = make_lr(); lr.fit(X_all, y_all)
rf = make_rf(); rf.fit(X_all, y_all)

# ------------------------------------------------------------
# 7) Score every cell → per-mine lease grids
# ------------------------------------------------------------
X_grid = np.column_stack([feats[k].ravel() for k in FEAT_ORDER]).astype(np.float64)
p_lr = lr.predict_proba(X_grid)[:, 1].reshape(n_lat, n_lon).astype(np.float32)
p_rf = rf.predict_proba(X_grid)[:, 1].reshape(n_lat, n_lon).astype(np.float32)
score = ((p_lr + p_rf) / 2).astype(np.float32)

hi_q, md_q = np.quantile(score[tr_mask], [0.90, 0.70])
def tier_of(s): return "high" if s >= hi_q else ("medium" if s >= md_q else "low")

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
                dist_mn_km=round(float(dist_km[i, j]), 2),
            ))

for m in MINES:
    cl = per_mine[m["code"]]
    if not cl: continue
    rs = sorted(set(c["lat"] for c in cl)); cs = sorted(set(c["lng"] for c in cl))
    rmap = {v: i for i, v in enumerate(rs)}; cmap = {v: i for i, v in enumerate(cs)}
    for c in cl:
        c["row"] = rmap[c["lat"]]; c["col"] = cmap[c["lng"]]

def latlon_to_flat(clat, clng):
    ri = int(round((lats[0] - clat) / GRID)); ci = int(round((clng - lons[0]) / GRID))
    ri = max(0, min(n_lat - 1, ri)); ci = max(0, min(n_lon - 1, ci))
    return ri * n_lon + ci

mine_summaries = []
for m in MINES:
    cl = per_mine[m["code"]]
    if not cl:
        mine_summaries.append(dict(code=m["code"], name=m["name"], cellsTotal=0))
        log(f"  {m['code']}: NO cells in range — check coords"); continue
    n_cells = len(cl)
    n_high = sum(1 for c in cl if c["tier"] == "high")
    n_med = sum(1 for c in cl if c["tier"] == "medium")
    est_mt = sum(c["probability"] for c in cl) * CELL_TONNAGE_BASE * (m["oreg"] / 35.0)
    top = sorted(cl, key=lambda c: -c["probability"])[:6]
    tops = []
    for c in top:
        s = sites[near_idx[latlon_to_flat(c["lat"], c["lng"])]]
        tops.append(dict(lat=c["lat"], lng=c["lng"], prospectivity=c["probability"],
                         tier=c["tier"], nearest_known_site=s["site"],
                         nearest_dev_status=s["dev"],
                         dist_to_nearest_km=c["dist_mn_km"]))
    near_sites = [dict(site=s["site"], dev=s["dev"], lat=s["lat"], lon=s["lon"])
                  for s in sites if haversine_km(m["lat"], m["lng"], s["lat"], s["lon"]) <= 15.0]
    mine_summaries.append(dict(
        code=m["code"], name=m["name"], state=m["state"], district=m["district"],
        lat=m["lat"], lng=m["lng"], oreGrade=m["oreg"], geology=m["geology"],
        cellsTotal=n_cells, high=n_high, medium=n_med, low=n_cells - n_high - n_med,
        estMt=round(est_mt, 2),
        avgProspectivity=round(float(np.mean([c["probability"] for c in cl])), 4),
        mnSitesWithin15km=len(near_sites), nearSites=near_sites[:12],
        topTargets=tops,
        cells=cl,
    ))
    log(f"  {m['code']}: {n_cells} cells, {n_high} high, est {est_mt:.1f} Mt, {len(near_sites)} Mn sites nearby")

uni = {}
for fi, k in enumerate(FEAT_ORDER):
    v = X_all[:, fi]
    uni[k] = round(float(roc_auc_score(y_all, v)) if len(set(v)) > 1 else 0.5, 4)
uni["dist_mn_km"] = round(float(roc_auc_score(y_all, -dist_all)), 4)

rf_imp = {k: round(float(v), 4) for k, v in zip(FEAT_ORDER, rf.feature_importances_)}
lr_coef = {k: round(float(v), 4) for k, v in zip(FEAT_ORDER, lr.coef_[0])}

results = dict(
    run_utc=datetime.now(timezone.utc).isoformat(),
    region=dict(lon_min=LON_MIN, lon_max=LON_MAX, lat_min=LAT_MIN, lat_max=LAT_MAX,
                cell_deg=GRID, grid_rows=n_lat, grid_cols=n_lon),
    features=FEAT_ORDER,
    class_balance=dict(train_cells=int(len(y_all)), positives=int(y_all.sum()),
                       negatives=int((y_all == 0).sum()),
                       excluded_band_km=[POS_KM, NEG_KM]),
    label_rule=dict(positive=f"<= {POS_KM} km of a USGS MRDS Mn occurrence",
                    negative=f">= {NEG_KM} km", excluded=f"{POS_KM}-{NEG_KM} km (ambiguous)",
                    caveat="labels = proximity to known mineralization (USGS MRDS), NOT ground-truth ore"),
    honest_cv=dict(logistic_auc=round(auc_lr, 4), random_forest_auc=round(auc_rf, 4),
                   scheme="spatial block CV, GroupKFold(5) on 0.1-deg blocks, proximity feature EXCLUDED"),
    circular_cv=dict(logistic_auc=round(auc_lr_c, 4), random_forest_auc=round(auc_rf_c, 4),
                     warning="WITH distance-to-occurrence feature — circular because labels are distance rings; shown only to demonstrate the trap"),
    random_kfold=dict(logistic_auc=round(auc_lr_rand, 4), random_forest_auc=round(auc_rf_rand, 4),
                      note="inflated by spatial autocorrelation — shown for contrast"),
    map_model=dict(ensemble="mean of logistic + random forest, trained on all labeled cells",
                   tier_thresholds=dict(high_min=round(float(hi_q), 4), medium_min=round(float(md_q), 4),
                                        basis="quantiles of ensemble score over labeled cells (relative ranking)")),
    feature_univariate_auc=uni,
    rf_importances=rf_imp, lr_coefficients=lr_coef,
    per_mine=mine_summaries,
    sentinel_scenes=scene_meta,
)
json.dump(results, open(f"{OUT}/portfolio.json", "w"), indent=1)
sz = os.path.getsize(f"{OUT}/portfolio.json") / 1e6
log(f"Saved portfolio.json ({sz:.1f} MB)")

manifest = dict(
    generated_utc=results["run_utc"],
    region_aoi=results["region"],
    sources=dict(
        mrds=dict(name="USGS Mineral Resources Data System (MRDS)",
                  url="https://mrdata.usgs.gov/wfs/mrds (regional bbox query)",
                  license="USGS public domain", records=len(sites)),
        gsi_geology_2M=dict(name="Geology of India 1:2M seamless (GSI via Esri India Living Atlas)",
                            url="https://livingatlas.esri.in/server1/rest/services/Geology/Geology/MapServer/0/query",
                            license="GSI via NDSAP — visualization + regional analysis permitted",
                            polygons=len(polys), groups=groups),
        copernicus_dem_glo30=dict(name="Copernicus DEM GLO-30", license="ESA Copernicus, CC-BY-4.0",
                                  url="https://copernicus-dem-30m.s3.amazonaws.com/ (windowed COG reads)"),
        sentinel_2_l2a=dict(name="Sentinel-2 L2A (Copernicus, element84 earth-search COGs)",
                            url="https://earth-search.aws.element84.com/v1/search",
                            license="Copernicus (free, open)", scenes=scene_meta),
    ),
    methodology=dict(labels=results["label_rule"], validation=results["honest_cv"]["scheme"],
                     circularity_check="reported side-by-side as an honesty demo",
                     tonnage="estMt = sum(cell prospectivity) x 0.26 Mt x (oreGrade/35) — matches app formula"),
)
json.dump(manifest, open(f"{OUT}/manifest.json", "w"), indent=1)
log("DONE — all artifacts saved")
