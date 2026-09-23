"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  CalendarClock,
  ArrowRight,
  ClipboardList,
  Wrench,
  Truck,
  TrainFront,
  Zap,
  Ban,
  Undo2,
  AlertTriangle,
  CircleDollarSign,
  ShieldAlert,
  ListChecks,
} from "lucide-react";
import {
  StatusBadge,
  FactorBars,
  ConfidenceMeter,
  MineTypeBadge,
} from "@/components/dashboard/shared";
import type { RiskItem, RecommendationItem, Mine } from "@/lib/types";
import { fmtT, fmtSignedT, fmtDate } from "@/lib/types";

// --------------- Action queue constants (ported from action-center-tab) ---------------

const TYPE_ICON: Record<string, typeof Truck> = {
  redeploy: Truck,
  "blast-schedule": Zap,
  maintenance: Wrench,
  capacity: Truck,
  logistics: TrainFront,
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  proposed: {
    label: "Proposed",
    className: "border-border bg-muted text-muted-foreground",
  },
  accepted: {
    label: "Accepted",
    className:
      "border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400",
  },
  rejected: {
    label: "Rejected",
    className:
      "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  applied: {
    label: "Applied",
    className:
      "border-green-600/40 bg-green-500/15 text-green-700 dark:text-green-400",
  },
};

// --------------- Main component ---------------

export function RisksTab({
  risks,
  recommendations: initialRecs,
  mines,
}: {
  risks: RiskItem[];
  recommendations: RecommendationItem[];
  mines: Mine[];
  onNavigate?: (tab: string) => void;
}) {
  // Sub-view toggle: "risks" | "actions"
  const [subView, setSubView] = useState<"risks" | "actions">("risks");

  // --- Risk analysis state ---
  const [riskMineFilter, setRiskMineFilter] = useState("all");
  const [riskStatusFilter, setRiskStatusFilter] = useState("all");

  const filteredRisks = useMemo(
    () =>
      risks
        .filter(
          (r) =>
            (riskMineFilter === "all" || r.mineId === riskMineFilter) &&
            (riskStatusFilter === "all" || r.status === riskStatusFilter),
        )
        // Sort worst first: risk > watch, then by gap% descending
        .sort((a, b) => {
          if (a.status !== b.status) {
            if (a.status === "risk") return -1;
            if (b.status === "risk") return 1;
          }
          return Math.abs(b.gapPct) - Math.abs(a.gapPct);
        }),
    [risks, riskMineFilter, riskStatusFilter],
  );

  function recsForMine(mineId: string, weekStart: string) {
    return initialRecs.filter(
      (r) => r.mineId === mineId && r.weekStart === weekStart && r.status === "proposed",
    );
  }

  // --- Action queue state ---
  const [recs, setRecs] = useState<RecommendationItem[]>(initialRecs);
  const [actionStatusFilter, setActionStatusFilter] = useState("open");
  const [actionMineFilter, setActionMineFilter] = useState("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { toast } = useToast();

  const actionMines = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; name: string }>();
    for (const r of recs)
      seen.set(r.mineId, { id: r.mineId, code: r.mineCode, name: r.mineName });
    return [...seen.values()];
  }, [recs]);

  const filteredActions = recs.filter((r) => {
    const statusOk =
      actionStatusFilter === "all" ||
      (actionStatusFilter === "open"
        ? r.status === "proposed" || r.status === "accepted"
        : r.status === actionStatusFilter);
    const mineOk = actionMineFilter === "all" || r.mineId === actionMineFilter;
    return statusOk && mineOk;
  });

  const counts = recs.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const openRecs = recs.filter((r) => r.status === "proposed");
  const openRecovery = openRecs.reduce((a, r) => a + r.impactTonnes, 0);

  async function setStatus(rec: RecommendationItem, status: string) {
    setPendingId(rec.id);
    try {
      const res = await fetch("/api/recommendations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rec.id, status }),
      });
      if (!res.ok) throw new Error("Update failed");
      setRecs((prev) =>
        prev.map((r) => (r.id === rec.id ? { ...r, status } : r)),
      );
      const meta = STATUS_META[status];
      toast({
        title: `Action ${meta?.label.toLowerCase() ?? status}`,
        description:
          status === "rejected"
            ? `${rec.title} — removed from the recovery estimate.`
            : `${rec.title} — estimated recovery +${fmtT(rec.impactTonnes)} t at ${rec.mineName}.`,
        variant: status === "rejected" ? "destructive" : undefined,
      });
    } catch {
      toast({
        title: "Could not update action",
        description: "Please retry.",
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ====== View toggle ====== */}
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          value={subView}
          onValueChange={(v) => {
            if (v === "risks" || v === "actions") setSubView(v);
          }}
          variant="outline"
          className="rounded-lg border"
        >
          <ToggleGroupItem
            value="risks"
            aria-label="Risk Analysis view"
            className="gap-1.5 px-4 py-1.5 text-sm data-[state=on]:bg-background"
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Risk Analysis
          </ToggleGroupItem>
          <ToggleGroupItem
            value="actions"
            aria-label="Action Queue view"
            className="gap-1.5 px-4 py-1.5 text-sm data-[state=on]:bg-background"
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Action Queue
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* ====== RISK ANALYSIS VIEW ====== */}
      {subView === "risks" && (
        <>
          {/* Data provenance badge */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25">
              SYNTHETIC OPS DATA
            </Badge>
            <span className="text-xs text-muted-foreground">
              Production &amp; shortfall predictions use synthetic operations data modeled
              on MOIL public aggregates
            </span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={riskMineFilter} onValueChange={setRiskMineFilter}>
              <SelectTrigger className="w-52" aria-label="Filter by mine">
                <SelectValue placeholder="All mines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All mines</SelectItem>
                {mines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.code} — {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={riskStatusFilter} onValueChange={setRiskStatusFilter}>
              <SelectTrigger className="w-40" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="risk">Risk only</SelectItem>
                <SelectItem value="watch">Watch only</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {filteredRisks.length} flagged prediction
              {filteredRisks.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Empty state */}
          {filteredRisks.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                <CheckCircle2
                  className="h-8 w-8 text-green-500"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium">
                  No flagged risks for this filter
                </p>
                <p className="text-xs text-muted-foreground">
                  All predictions within tolerance for the selected scope.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Risk cards */}
          {filteredRisks.map((risk) => {
            const linked = recsForMine(risk.mineId, risk.weekStart);
            const linkedTonnes = linked.reduce(
              (a, r) => a + r.impactTonnes,
              0,
            );
            return (
              <Card key={risk.id} className="overflow-hidden">
                <div
                  className={`h-1 w-full ${risk.status === "risk" ? "bg-red-500" : "bg-yellow-500"}`}
                  aria-hidden="true"
                />
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={risk.status} />
                    <Badge
                      variant="outline"
                      className="text-muted-foreground"
                    >
                      {risk.mineCode}
                    </Badge>
                    <span className="text-sm font-medium">
                      {risk.mineName}
                    </span>
                    <MineTypeBadge type={risk.mineType} />
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      wk of {fmtDate(risk.weekStart)} · H{risk.horizon}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1">
                    <span className="text-sm tabular-nums text-muted-foreground">
                      predicted{" "}
                      <span className="font-semibold text-foreground">
                        {fmtT(risk.predicted)} t
                      </span>
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      target {fmtT(risk.target)} t
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
                      {fmtSignedT(risk.gap)} t ({risk.gapPct}%)
                    </span>
                    <ConfidenceMeter value={risk.confidence} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Contributing factors — why this shortfall is predicted
                    </p>
                    <FactorBars factors={risk.factors} maxRows={5} />
                  </div>

                  {/* Linked recommendations → Action Queue */}
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    {linked.length > 0 ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {linked.length} proposed action
                          {linked.length > 1 ? "s" : ""} ·{" "}
                          <span className="font-medium text-green-600 dark:text-green-400">
                            +{fmtT(linkedTonnes)} t
                          </span>{" "}
                          estimated recovery
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs"
                          onClick={() => setSubView("actions")}
                        >
                          View in Action Queue
                          <ArrowRight
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No proposed actions for this week — residual gap
                        within tolerance.
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Methodology note */}
          <p className="rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium">Methodology:</span> Shortfall
            predictions: Ridge regression with rolling-origin cross-validation
            (expanding window). Factor attribution: exact linear-SHAP
            decomposition. Confidence: 1 − relative MAPE on held-out validation
            window.
          </p>
        </>
      )}

      {/* ====== ACTION QUEUE VIEW ====== */}
      {subView === "actions" && (
        <>
          {/* Recovery CTA */}
          <div className="rounded-xl border border-green-600/30 bg-green-500/8 dark:bg-green-500/5 p-5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-green-700 dark:text-green-400">
              Estimated recovery if all open actions applied
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-green-700 dark:text-green-400">
              +{fmtT(openRecovery)} t
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {openRecs.length} proposed actions · model-derived impact estimates
            </p>
          </div>

          {/* Status summary chips */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">
                Awaiting review
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums">
                {openRecs.length}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">
                Open recovery
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-green-600 dark:text-green-400">
                +{fmtT(openRecovery)} t
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">
                Accepted / applied
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums">
                {(counts.accepted ?? 0) + (counts.applied ?? 0)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">Rejected</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums">
                {counts.rejected ?? 0}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={actionStatusFilter}
              onValueChange={setActionStatusFilter}
            >
              <SelectTrigger
                className="w-44"
                aria-label="Filter by status"
              >
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  Open (proposed + accepted)
                </SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="proposed">Proposed</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={actionMineFilter}
              onValueChange={setActionMineFilter}
            >
              <SelectTrigger
                className="w-52"
                aria-label="Filter by mine"
              >
                <SelectValue placeholder="All mines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All mines</SelectItem>
                {actionMines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.code} — {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {filteredActions.length} of {recs.length} actions
            </span>
          </div>

          {/* Queue */}
          <div className="space-y-2.5">
            {filteredActions.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                  <CheckCircle2
                    className="h-8 w-8 text-green-500"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium">
                    No actions for this filter
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {actionStatusFilter === "open"
                      ? "All actions have been reviewed — nothing awaiting a decision."
                      : "Try a different status or mine filter."}
                  </p>
                </CardContent>
              </Card>
            )}

            {filteredActions.map((rec) => {
              const Icon = TYPE_ICON[rec.type] ?? ClipboardList;
              const meta = STATUS_META[rec.status] ?? STATUS_META.proposed;
              const busy = pendingId === rec.id;
              return (
                <Card key={rec.id} className="overflow-hidden">
                  <div
                    className={`h-0.5 w-full ${
                      rec.status === "rejected"
                        ? "bg-red-500/60"
                        : rec.status === "applied"
                          ? "bg-green-500"
                          : rec.status === "accepted"
                            ? "bg-green-500/70"
                            : "bg-muted-foreground/40"
                    }`}
                    aria-hidden="true"
                  />
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground">
                        <Icon
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                            #{rec.priority}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            {rec.mineCode}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={meta.className}
                          >
                            {meta.label}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {rec.effort} effort · wk of{" "}
                            {fmtDate(rec.weekStart)}
                          </span>
                          <span className="ml-auto text-xs font-semibold tabular-nums text-green-600 dark:text-green-400">
                            +{fmtT(rec.impactTonnes)} t
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium leading-snug">
                          {rec.title}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {rec.description}
                        </p>
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          <AlertTriangle
                            className="mt-0.5 h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            <span className="font-medium">
                              Trigger / rationale:
                            </span>{" "}
                            {rec.rationale}
                          </span>
                        </p>
                        {/* Workflow buttons */}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {rec.status === "proposed" && (
                            <>
                              <Button
                                size="sm"
                                className="h-8 border-green-600/40 bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:text-green-400"
                                variant="outline"
                                onClick={() => setStatus(rec, "accepted")}
                                disabled={busy}
                              >
                                <CheckCircle2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {busy ? "…" : "Accept"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                                onClick={() => setStatus(rec, "rejected")}
                                disabled={busy}
                              >
                                <Ban
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8"
                                onClick={() => setStatus(rec, "applied")}
                                disabled={busy}
                              >
                                <Zap
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {busy ? "…" : "Mark applied"}
                              </Button>
                            </>
                          )}
                          {rec.status === "accepted" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-green-600/40 text-green-700 hover:bg-green-500/10 dark:text-green-400"
                                onClick={() => setStatus(rec, "applied")}
                                disabled={busy}
                              >
                                <CheckCircle2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {busy ? "…" : "Mark applied"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8"
                                onClick={() => setStatus(rec, "proposed")}
                                disabled={busy}
                              >
                                <Undo2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                Reopen
                              </Button>
                            </>
                          )}
                          {(rec.status === "applied" ||
                            rec.status === "rejected") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => setStatus(rec, "proposed")}
                              disabled={busy}
                            >
                              <Undo2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Reopen
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Footer disclaimer */}
          <p className="flex items-start gap-1.5 rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <CircleDollarSign
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            Impact estimates are model-derived (factor contribution ×
            recoverable fraction, capped per shortfall). Accept / Reject /
            Mark applied record the planner&apos;s decision — a real database
            write. Outcome tracking (did the tonnes actually recover?) requires
            MOIL operational data and is not simulated here.
          </p>
        </>
      )}
    </div>
  );
}
