#!/usr/bin/env python3
"""
Fetch REAL ERA5 reanalysis weather (via Open-Meteo archive API, CC-BY-4.0)
for the 10 MOIL mine locations and aggregate to ISO weeks (Mon-Sun).

Output: research/real-pipeline/artifacts/era5_weekly_per_mine.json
  { "<MINE_CODE>": { "lat": float, "lon": float,
      "weeks": { "YYYY-MM-DD": { "rainfall_mm": float, "temp_c": float|null,
                                  "soil_moisture": float|null } } } }

Weeks span 2018-12-31 (Mon) .. 2026-08-24 (Mon) = 400 weeks, matching the
seed's calendar. Reproducible: re-run any time — same request window.

Usage: python3 scripts/real-pipeline/fetch_era5_weekly.py
"""

import json
import time
import urllib.request
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Mirrors src/lib/mines.ts (single source of truth in TS; duplicated here
# deliberately so the Python fetch has no TS/Node dependency).
MINES = [
    ("BLGT", 21.81, 80.15),
    ("BRWL", 21.90, 80.07),
    ("UKWA", 21.90, 80.41),
    ("TRDI", 21.73, 79.67),
    ("DGBZ", 20.98, 79.33),
    ("CHKL", 21.33, 79.65),
    ("KNDR", 21.40, 79.27),
    ("MNSR", 21.38, 79.24),
    ("STSJ", 21.07, 80.12),
    ("GMGN", 21.22, 78.92),
]

# 400 consecutive Mondays: first week Mon 2018-12-31, last Mon 2026-08-24
FIRST_MONDAY = date(2018, 12, 31)
N_WEEKS = 400
LAST_MONDAY = FIRST_MONDAY + timedelta(weeks=N_WEEKS - 1)
START = FIRST_MONDAY.isoformat()
END = (LAST_MONDAY + timedelta(days=6)).isoformat()  # Sunday of last week

API = "https://archive-api.open-meteo.com/v1/archive"
OUT = Path(__file__).resolve().parents[2] / "research" / "real-pipeline" / "artifacts" / "era5_weekly_per_mine.json"


def http_get_json(url: str, tries: int = 4):
    last = None
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MOIL-SIH2026/1.0 (research)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * attempt)
    raise RuntimeError(f"failed after {tries} tries: {url} ({last})")


def weekly_mondays():
    d = FIRST_MONDAY
    out = []
    for _ in range(N_WEEKS):
        out.append(d)
        d += timedelta(days=7)
    return out


def aggregate(dates: list[str], precip: list, temp: list, soil: list, mondays: list[dict]):
    """Sum precipitation per week; mean temp & soil moisture (None-aware)."""
    idx = {d: i for i, d in enumerate(dates)}
    weeks = {}
    for wk in mondays:
        days = [ (wk + timedelta(days=k)).isoformat() for k in range(7) ]
        rain = 0.0
        temps, soils = [], []
        for ds in days:
            i = idx.get(ds)
            if i is None:
                continue
            p = precip[i]
            if p is not None:
                rain += float(p)
            if temp[i] is not None:
                temps.append(float(temp[i]))
            if soil[i] is not None:
                soils.append(float(soil[i]))
        weeks[wk.isoformat()] = {
            "rainfall_mm": round(rain, 2),
            "temp_c": round(sum(temps) / len(temps), 2) if temps else None,
            "soil_moisture": round(sum(soils) / len(soils), 5) if soils else None,
        }
    return weeks


def main():
    mondays = weekly_mondays()
    params = {
        "start_date": START,
        "end_date": END,
        "timezone": "UTC",
        "daily": "precipitation_sum,temperature_2m_mean,soil_moisture_0_to_7cm_mean",
    }
    result = {}
    for code, lat, lon in MINES:
        params["latitude"] = lat
        params["longitude"] = lon
        url = f"{API}?{urllib.parse.urlencode(params)}"
        print(f"fetch {code} ({lat},{lon}) {START}..{END} ...", flush=True)
        data = http_get_json(url)
        daily = data["daily"]
        weeks = aggregate(daily["time"], daily["precipitation_sum"],
                          daily["temperature_2m_mean"], daily["soil_moisture_0_to_7cm_mean"], mondays)
        n = len(weeks)
        first, last = sorted(weeks)[0], sorted(weeks)[-1]
        print(f"  {code}: {n} weeks ({first} .. {last})", flush=True)
        result[code] = {"lat": lat, "lon": lon, "weeks": weeks}
        time.sleep(1.2)  # be polite to the free API

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=1))
    print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB)")
    # sanity
    assert len(result["BLGT"]["weeks"]) == N_WEEKS, "week count mismatch"
    total_rain = sum(v["rainfall_mm"] for v in result["BLGT"]["weeks"].values())
    print(f"BLGT total rainfall across {N_WEEKS} wks: {total_rain:.0f} mm (sanity)")


if __name__ == "__main__":
    main()
