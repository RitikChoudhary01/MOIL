#!/usr/bin/env python3
# ============================================================
# MOIL Intelligence — fetch RAW Sentinel-2 band mosaics
# (B02 blue, B04 red, B08 nir, B11 swir16, B12 swir22)
# Needed for mineral alteration indices:
#   ferric iron  = B04 / B02   (iron-oxide staining)
#   ferrous iron = B11 / B08
#   clay-OH      = B11 / B12   (hydroxyl / clay alteration)
# Saves: s2_bands.npz + s2_scenes.json  (reproducible, real data)
# ============================================================
import json, os, time
from datetime import datetime

import numpy as np
import requests
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.transform import from_bounds as transform_from_bounds

BASE = "/home/z/my-project"
OUT = f"{BASE}/research/multi-mine/artifacts"
os.makedirs(OUT, exist_ok=True)
GRID = 0.01
LON_MIN, LON_MAX = 78.72, 80.62
LAT_MIN, LAT_MAX = 20.84, 22.02
n_lat = int(round((LAT_MAX - LAT_MIN) / GRID))
n_lon = int(round((LON_MAX - LON_MIN) / GRID))
BANDS = {"blue": "B02", "red": "B04", "nir": "B08", "swir16": "B11", "swir22": "B12"}


def log(m):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}", flush=True)


def fetch_scenes():
    body = dict(
        collections=["sentinel-2-l2a"],
        bbox=[LON_MIN, LAT_MIN, LON_MAX, LAT_MAX],
        datetime="2025-11-01T00:00:00Z/2026-09-01T00:00:00Z",
        query={"eo:cloud_cover": dict(lt=8)},
        limit=60,
    )
    log("Searching Sentinel-2 L2A scenes (element84 STAC)...")
    r = requests.post("https://earth-search.aws.element84.com/v1/search",
                      json=body, timeout=90)
    r.raise_for_status()
    feats = r.json().get("features", [])
    by_tile = {}
    for f in feats:
        t = f["properties"].get("grid:code", f["id"].split("_")[0])
        dt = f["properties"].get("datetime", "")
        if t not in by_tile or dt > by_tile[t][0]:
            by_tile[t] = (dt, f)
    scenes = {t: v[1] for t, v in by_tile.items()}
    log(f"S2: {len(feats)} scenes found, using {len(scenes)} tiles: {sorted(scenes)}")
    return scenes


def band_url(item, band):
    href = item["assets"][band]["href"]
    if href.startswith("s3://sentinel-cogs"):
        href = href.replace("s3://sentinel-cogs",
                            "https://sentinel-cogs.s3.us-west-2.amazonaws.com")
    return href


def rasterize_to_grid(src_path):
    dst = np.full((n_lat, n_lon), np.nan, dtype=np.float64)
    try:
        with rasterio.open(src_path) as src:
            dst_tr = transform_from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX,
                                           n_lon, n_lat)
            reproject(source=rasterio.band(src, 1), destination=dst,
                      src_transform=src.transform, src_crs=src.crs,
                      dst_transform=dst_tr, dst_crs="EPSG:4326",
                      src_nodata=src.nodata if src.nodata is not None else 0,
                      dst_nodata=np.nan, resampling=Resampling.average)
    except Exception as e:
        log(f"  WARN tile failed ...{src_path[-45:]}: {type(e).__name__}")
    return dst


def mosaic_band(scenes, band_key):
    acc = np.full((n_lat, n_lon), np.nan, dtype=np.float64)
    cov = np.zeros((n_lat, n_lon), dtype=np.int16)
    for t, item in scenes.items():
        assets = item["assets"]
        asset_name = band_key if band_key in assets else BANDS[band_key]
        part = rasterize_to_grid(band_url(item, asset_name))
        good = ~np.isnan(part)
        acc[good] = part[good]
        cov[good] += 1
    acc[cov == 0] = np.nan
    log(f"  {band_key}: max tile coverage={cov.max()}")
    return acc


if __name__ == "__main__":
    npz_path = f"{OUT}/s2_bands.npz"
    meta_path = f"{OUT}/s2_scenes.json"
    scenes = fetch_scenes()
    scene_meta = []
    for t, item in scenes.items():
        p = item["properties"]
        scene_meta.append(dict(tile=t, scene=item["id"],
                               date=p.get("datetime", "")[:10],
                               cloud_pct=round(p.get("eo:cloud_cover", -1), 2)))
    band_data = {}
    t0 = time.time()
    for b in BANDS:
        band_data[b] = mosaic_band(scenes, b)
    for b, arr in band_data.items():
        n_nan = int(np.isnan(arr).sum())
        if n_nan:
            log(f"  {b}: {n_nan} NaN cells → filled with scene mean")
            arr[np.isnan(arr)] = np.nanmean(arr)
    np.savez_compressed(npz_path, **{b: band_data[b].astype(np.float32) for b in BANDS})
    json.dump(dict(fetched_utc=datetime.utcnow().isoformat() + "Z",
                   scenes=scene_meta,
                   bands={v: k for k, v in BANDS.items()}),
              open(meta_path, "w"), indent=1)
    log(f"Saved {npz_path} ({os.path.getsize(npz_path)/1e6:.1f} MB) + {meta_path} "
        f"({time.time()-t0:.0f}s total)")
    log("DONE")
