"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FlaskConical, Loader2, RotateCcw, TrendingDown, TrendingUp, CloudRain, Zap } from "lucide-react";
import { FactorBars } from "@/components/dashboard/shared";
import { fmtT, fmtDate, type Factor } from "@/lib/types";

// ---------- API contracts (mirror /api/simulate) ----------

interface ScenarioRange {
  min: number;
  max: number;
  step: number;
  unit: string;
  label: string;
}

interface SimulateMineMeta {
  mineId: string;
  code: string;
  name: string;
  type: string;
  baselineWeek: string;
  baselineValues: Record<string, number>;
  ranges: Record<string, ScenarioRange>;
}

interface SimulateMeta {
  mines: SimulateMineMeta[];
  metrics: { holdoutR2: number; holdoutMape: number; trainWeeks: number; testWeeks: number };
}

interface SimulateResult {
  mine: { code: string; name: string; type: string };
  baselineWeek: string;
  baseline: { predicted: number };
  scenario: { predicted: number };
  uncertainty: {
    baseline: { p10: number; p50: number; p90: number };
    scenario: { p10: number; p50: number; p90: number };
    coverage80: number;
    note: string;
  };
  delta: { tonnes: number; pct: number; horizon4wk: number };
  contributions: { name: string; value: number; contribution: number }[];
  model: { holdoutR2: number; holdoutMape: number; trainWeeks: number; testWeeks: number; refitNote: string };
}

const OVERRIDABLE = ["downtimeHours", "maintenanceEvents", "blastingDelays", "haulerCount", "equipmentUtilization", "rainfallMm"] as const;
type OverrideKey = (typeof OVERRIDABLE)[number];

const PRESETS: Record<string, Partial<Record<OverrideKey, number>>> = {
  // Recovery push: halve downtime, +2 haulers, utilization to 0.9
  recovery: { downtimeHours: -50, haulerCount: 2, equipmentUtilization: 0.9 },
  // Monsoon stress: rainfall up to 120 mm (open-pit mines feel this hardest)
  monsoon: { rainfallMm: 120 },
};

export function ScenarioLab({ mineId }: { mineId: string | null }) {
  const [meta, setMeta] = useState<SimulateMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [activeMineId, setActiveMineId] = useState<string | null>(mineId);
  // Sparse override map — absent key = "as recorded". Display values derive
  // from baseline + overrides, so no effect-synced state is needed.
  const [vals, setVals] = useState<Partial<Record<OverrideKey, number>>>({});
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load slider metadata once
  useEffect(() => {
    let cancelled = false;
    fetch("/api/simulate")
      .then((r) => {
        if (!r.ok) throw new Error(`Metadata request failed (${r.status})`);
        return r.json() as Promise<SimulateMeta>;
      })
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((e) => {
        if (!cancelled) setMetaError(e instanceof Error ? e.message : "Unknown error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeMine = useMemo(() => {
    if (!meta) return null;
    const id = activeMineId ?? meta.mines[0]?.mineId;
    return meta.mines.find((m) => m.mineId === id) ?? null;
  }, [meta, activeMineId]);

  // Sparse overrides → any key present (≠ baseline) is dirty.
  const dirtyKeys = useMemo(() => new Set(Object.keys(vals) as OverrideKey[]), [vals]);

  const displayVal = useCallback(
    (key: OverrideKey): number => vals[key] ?? activeMine?.baselineValues[key] ?? 0,
    [vals, activeMine],
  );

  // Debounced simulation call
  const runSim = useCallback(
    (mineIdLocal: string, overrides: Partial<Record<OverrideKey, number>>) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSimulating(true);
      setSimError(null);
      fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mineId: mineIdLocal, overrides }),
        signal: ctrl.signal,
      })
        .then(async (r) => {
          if (!r.ok) {
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Simulation failed (${r.status})`);
          }
          return r.json() as Promise<SimulateResult>;
        })
        .then((res) => {
          setResult(res);
          setSimulating(false);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setSimError(e instanceof Error ? e.message : "Unknown error");
          setSimulating(false);
        });
    },
    [],
  );

  useEffect(() => {
    if (!activeMine) return;
    const t = setTimeout(() => runSim(activeMine.mineId, vals), 450);
    return () => clearTimeout(t);
  }, [activeMine?.mineId, vals, runSim]);

  const applyPreset = (name: keyof typeof PRESETS) => {
    if (!activeMine) return;
    const preset = PRESETS[name];
    const next: Partial<Record<OverrideKey, number>> = {};
    for (const [k, delta] of Object.entries(preset)) {
      const key = k as OverrideKey;
      const range = activeMine.ranges[key];
      const base = activeMine.baselineValues[key];
      let v: number;
      if (key === "haulerCount") v = base + (delta ?? 0); // +2 haulers
      else if (key === "equipmentUtilization") v = delta ?? base; // absolute target
      else if (key === "rainfallMm") v = delta ?? base; // absolute mm
      else v = base + (delta ?? 0); // negative deltas: −50% style offsets
      v = Math.min(range.max, Math.max(range.min, Math.round(v / range.step) * range.step));
      next[key] = v;
    }
    setVals(next);
  };

  const resetAll = () => setVals({});

  if (metaError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Scenario Lab unavailable: {metaError}
        </CardContent>
      </Card>
    );
  }
  if (!meta || !activeMine) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading scenario engine…
        </CardContent>
      </Card>
    );
  }

  const positive = (result?.delta.tonnes ?? 0) >= 0;
  const isDirty = dirtyKeys.size > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Scenario Lab — what-if planning</CardTitle>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            exact counterfactual · linear-SHAP
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={activeMine.mineId}
              onValueChange={(v) => {
                setActiveMineId(v);
                setResult(null);
              }}
            >
              <SelectTrigger className="w-52" aria-label="Scenario mine">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meta.mines.map((m) => (
                  <SelectItem key={m.mineId} value={m.mineId}>
                    {m.code} — {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <CardDescription>
          Move the levers a mine manager actually controls — the model re-scores the week instantly.
          Baseline: week of {fmtDate(activeMine.baselineWeek)} as recorded. Model refit live from the
          warehouse (holdout R² {meta.metrics.holdoutR2.toFixed(2)} · MAPE {meta.metrics.holdoutMape}%).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
          {/* ---------- Levers ---------- */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => applyPreset("recovery")}>
                <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Recovery push
              </Button>
              <Button size="sm" variant="outline" onClick={() => applyPreset("monsoon")}>
                <CloudRain className="h-3.5 w-3.5" aria-hidden="true" /> Monsoon stress (120 mm)
              </Button>
              <Button size="sm" variant="ghost" onClick={resetAll} disabled={!isDirty}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
              </Button>
            </div>
            {OVERRIDABLE.map((key) => {
              const range = activeMine.ranges[key];
              const v = displayVal(key);
              const dirty = dirtyKeys.has(key);
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`slider-${key}`} className="text-xs text-muted-foreground">
                      {range.label}
                      {dirty && <span className="ml-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">changed</span>}
                    </Label>
                    <span className="text-xs font-medium tabular-nums">
                      {key === "equipmentUtilization" ? `${(v * 100).toFixed(0)}%` : `${Number.isInteger(v) ? v : v.toFixed(1)} ${range.unit}`}
                    </span>
                  </div>
                  <Slider
                    id={`slider-${key}`}
                    value={[v]}
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    onValueChange={(nv: number[]) => {
                      const base = activeMine.baselineValues[key];
                      setVals((prev) => {
                        // Snap back to baseline → drop the override entirely
                        if (Math.abs(nv[0] - base) <= range.step / 2) {
                          const { [key]: _dropped, ...rest } = prev;
                          return rest;
                        }
                        return { ...prev, [key]: nv[0] };
                      });
                    }}
                    aria-label={range.label}
                  />
                </div>
              );
            })}
          </div>

          {/* ---------- Outcome ---------- */}
          <div className="space-y-4">
            {simError ? (
              <p className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
                {simError}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 items-center gap-3 rounded-lg border bg-muted/30 p-4">
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Baseline</p>
                    <p className="text-xl font-semibold tabular-nums">{result ? `${fmtT(result.baseline.predicted)} t` : "—"}</p>
                    {result?.uncertainty && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        P10–P90: {fmtT(result.uncertainty.baseline.p10)}–{fmtT(result.uncertainty.baseline.p90)}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground">per week</p>
                  </div>
                  <div className="flex flex-col items-center">
                    {simulating ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <TrendingUp
                        className={`h-5 w-5 ${positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                        aria-hidden="true"
                      />
                    )}
                    <p
                      className={`text-lg font-bold tabular-nums ${
                        simulating
                          ? "text-muted-foreground"
                          : positive
                            ? "text-green-700 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {result && !simulating ? `${positive ? "+" : "−"}${fmtT(Math.abs(result.delta.tonnes))} t` : "…"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {result && !simulating ? `${result.delta.pct > 0 ? "+" : ""}${result.delta.pct}%` : ""}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Scenario</p>
                    <p className="text-xl font-semibold tabular-nums">{result && !simulating ? `${fmtT(result.scenario.predicted)} t` : "…"}</p>
                    {result?.uncertainty && !simulating && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        P10–P90: {fmtT(result.uncertainty.scenario.p10)}–{fmtT(result.uncertainty.scenario.p90)}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground">per week</p>
                  </div>
                </div>

                {result?.uncertainty && !simulating && (
                  <p className="rounded-md border border-dashed bg-muted/20 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Risk band:</span> {result.uncertainty.note} Plan for the
                    P10 case — it is the honest downside, not the average.
                  </p>
                )}

                {result && !simulating && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      4-week horizon impact:{" "}
                      <span className={`font-semibold ${positive ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {result.delta.horizon4wk >= 0 ? "+" : "−"}
                        {fmtT(Math.abs(result.delta.horizon4wk))} t
                      </span>{" "}
                      {result.delta.horizon4wk >= 0 ? "recovered" : "at risk"} across the forecast window ·
                      vs plan target this acts as a recovery/loss lever in the action queue.
                    </p>
                    <div>
                      <p className="mb-1.5 text-xs font-medium">What moved and by how much (SHAP Δ, tonnes)</p>
                      {result.contributions.length > 0 ? (
                        <FactorBars
                          factors={result.contributions.map(
                            (c): Factor => ({
                              name: c.name,
                              value: c.value,
                              unit: "",
                              contribution: Math.round(c.contribution),
                              direction: c.contribution < 0 ? "negative" : "positive",
                            }),
                          )}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No override changes the output — sliders are at baseline. Move a lever or pick a preset.
                        </p>
                      )}
                    </div>
                    <details className="text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">How this works</summary>
                      <p className="mt-1 leading-relaxed">{result.model.refitNote}</p>
                    </details>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
