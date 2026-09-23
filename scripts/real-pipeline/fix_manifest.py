#!/usr/bin/env python3
"""Regenerate manifest.json for the multi-mine pipeline (fixes groups var collision)."""
import json, os

OUT = "/home/z/my-project/research/multi-mine/artifacts"
portfolio = json.load(open(f"{OUT}/portfolio.json"))
occ = json.load(open(f"{OUT}/mn_occurrences_region.json"))

# geology group counts from the pipeline run log (2026-09-12):
# {'gneiss': 12, 'sausar': 18, 'other': 24, 'sakoli': 1}
groups = {"gneiss": 12, "sausar": 18, "other": 24, "sakoli": 1}

manifest = dict(
    generated_utc=portfolio["run_utc"],
    region_aoi=portfolio["region"],
    sources=dict(
        mrds=dict(
            name="USGS Mineral Resources Data System (MRDS)",
            url="https://mrdata.usgs.gov/wfs/mrds (regional bbox query)",
            license="USGS public domain",
            records=occ["count"],
            note="Labels = proximity to documented Mn occurrences; USGS coverage of India is partial (a known, disclosed limitation).",
        ),
        gsi_geology_2M=dict(
            name="Geology of India 1:2M seamless (GSI via Esri India Living Atlas)",
            url="https://livingatlas.esri.in/server1/rest/services/Geology/Geology/MapServer/0/query",
            license="GSI via NDSAP — visualization + regional analysis permitted",
            polygons=55,
            groups=groups,
        ),
        copernicus_dem_glo30=dict(
            name="Copernicus DEM GLO-30",
            license="ESA Copernicus, CC-BY-4.0",
            url="https://copernicus-dem-30m.s3.amazonaws.com/ (windowed COG reads)",
        ),
        sentinel_2_l2a=dict(
            name="Sentinel-2 L2A (Copernicus, element84 earth-search COGs)",
            url="https://earth-search.aws.element84.com/v1/search",
            license="Copernicus (free, open)",
            scenes=portfolio["sentinel_scenes"],
        ),
    ),
    methodology=dict(
        labels=portfolio["label_rule"],
        validation=portfolio["honest_cv"]["scheme"],
        honest_auc=portfolio["honest_cv"],
        circularity_check="reported side-by-side as an honesty demo (circular CV AUC 1.00 vs honest 0.81/0.88)",
        tonnage="estMt = sum(cell prospectivity) x 0.26 Mt x (oreGrade/35) — matches app formula",
        cache="region_features.npz stores raw region rasters; re-runs skip all downloads",
    ),
)
json.dump(manifest, open(f"{OUT}/manifest.json", "w"), indent=1)
print("manifest regenerated:", os.path.getsize(f"{OUT}/manifest.json"), "bytes")
