"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  Moon,
  Sun,
  Mountain,
  Circle,
} from "lucide-react";
import { TabErrorBoundary } from "@/components/dashboard/error-boundary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/use-api";
import { TabSkeleton, ErrorCard } from "@/components/dashboard/shared";
import { OverviewTab } from "@/components/dashboard/overview-tab";
import { ReserveMapTab } from "@/components/dashboard/reserve-map-tab";
import { ProductionTab } from "@/components/dashboard/production-tab";
import { RisksTab } from "@/components/dashboard/risks-tab";
import { ModelHealthTab } from "@/components/dashboard/model-health-tab";
import type {
  OverviewData,
  ReserveMapData,
  ProductionData,
  RiskItem,
  RecommendationItem,
  Mine,
} from "@/lib/types";

// --- Health indicator ---
function HealthDot() {
  const [status, setStatus] = useState<"ok" | "degraded" | "loading">("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => setStatus(r.ok ? "ok" : "degraded"))
      .catch(() => setStatus("degraded"));
    const iv = setInterval(() => {
      fetch("/api/health")
        .then((r) => setStatus(r.ok ? "ok" : "degraded"))
        .catch(() => setStatus("degraded"));
    }, 120_000);
    return () => clearInterval(iv);
  }, []);

  if (status === "loading") return null;

  return (
    <div className="flex items-center gap-1.5" title={status === "ok" ? "All models healthy" : "Model degraded — check Health tab"}>
      <span className={`relative flex h-2 w-2`}>
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
            status === "ok" ? "animate-ping bg-green-400" : "bg-red-400"
          }`}
        />
        <Circle
          className={`relative h-2 w-2 fill-current ${
            status === "ok" ? "text-green-500" : "text-red-500"
          }`}
        />
      </span>
      <span className="text-[11px] text-muted-foreground hidden sm:inline">
        {status === "ok" ? "Model healthy" : "Degraded"}
      </span>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Toggle light/dark theme"
    >
      <Sun className="h-4 w-4 dark:hidden" aria-hidden="true" />
      <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
    </button>
  );
}

export function DashboardShell() {
  const [activeTab, setActiveTab] = useState("overview");
  const overview = useApi<OverviewData>("/api/overview");
  const reserve = useApi<ReserveMapData>("/api/reserve-map");
  const production = useApi<ProductionData>("/api/production");
  const risks = useApi<{ risks: RiskItem[] }>("/api/risks");
  const recs = useApi<{ recommendations: RecommendationItem[] }>("/api/recommendations");
  const mines = useApi<{ mines: Mine[] }>("/api/mines");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white shadow-sm">
            <Mountain className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight tracking-tight">
              MOIL Intelligence
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Manganese operations decision support · SIH 2026 · PS SIH26-26009
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Live health indicator */}
            <HealthDot />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ---------- Tabs ---------- */}
      <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1 sm:w-auto">
            <TabsTrigger value="overview" className="px-4 py-2 text-sm">
              Overview
            </TabsTrigger>
            <TabsTrigger value="reserve" className="px-4 py-2 text-sm">
              Prospectivity Map
            </TabsTrigger>
            <TabsTrigger value="production" className="px-4 py-2 text-sm">
              Production Forecast
            </TabsTrigger>
            <TabsTrigger value="risks" className="px-4 py-2 text-sm">
              Risks &amp; Actions
            </TabsTrigger>
            <TabsTrigger value="health" className="px-4 py-2 text-sm">
              Model &amp; Data Health
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="tab-in">
            <TabErrorBoundary>
              {overview.loading ? (
                <TabSkeleton />
              ) : overview.error || !overview.data ? (
                <ErrorCard message={overview.error ?? "Failed to load"} onRetry={overview.reload} />
              ) : (
                <OverviewTab
                  data={overview.data}
                  production={production.data ?? null}
                  recs={recs.data?.recommendations ?? null}
                  mines={mines.data?.mines ?? []}
                  onNavigate={setActiveTab}
                />
              )}
            </TabErrorBoundary>
          </TabsContent>

          <TabsContent value="reserve" className="tab-in">
            <TabErrorBoundary>
              {reserve.loading ? (
                <TabSkeleton cards={2} />
              ) : reserve.error || !reserve.data ? (
                <ErrorCard message={reserve.error ?? "Failed to load"} onRetry={reserve.reload} />
              ) : (
                <ReserveMapTab data={reserve.data} />
              )}
            </TabErrorBoundary>
          </TabsContent>

          <TabsContent value="production" className="tab-in">
            <TabErrorBoundary>
              {production.loading ? (
                <TabSkeleton cards={2} />
              ) : production.error || !production.data ? (
                <ErrorCard
                  message={production.error ?? "Failed to load"}
                  onRetry={production.reload}
                />
              ) : (
                <ProductionTab data={production.data} />
              )}
            </TabErrorBoundary>
          </TabsContent>

          <TabsContent value="risks" className="tab-in">
            <TabErrorBoundary>
              {risks.loading || recs.loading || mines.loading ? (
                <TabSkeleton cards={3} />
              ) : risks.error || recs.error || mines.error || !risks.data || !recs.data || !mines.data ? (
                <ErrorCard
                  message={risks.error ?? recs.error ?? mines.error ?? "Failed to load"}
                  onRetry={() => {
                    risks.reload();
                    recs.reload();
                    mines.reload();
                  }}
                />
              ) : (
                <RisksTab
                  risks={risks.data.risks}
                  recommendations={recs.data.recommendations}
                  mines={mines.data.mines}
                  onNavigate={setActiveTab}
                />
              )}
            </TabErrorBoundary>
          </TabsContent>

          <TabsContent value="health" className="tab-in">
            <TabErrorBoundary>
              {production.loading || reserve.loading ? (
                <TabSkeleton cards={2} />
              ) : production.error || reserve.error || !production.data || !reserve.data ? (
                <ErrorCard
                  message={production.error ?? reserve.error ?? "Failed to load"}
                  onRetry={() => {
                    production.reload();
                    reserve.reload();
                  }}
                />
              ) : (
                <ModelHealthTab
                  production={production.data}
                  reserve={reserve.data}
                />
              )}
            </TabErrorBoundary>
          </TabsContent>
        </Tabs>
      </main>

      {/* ---------- Footer (sticky bottom) ---------- */}
      <footer className="mt-auto border-t bg-muted/40">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 text-[11px] text-muted-foreground sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <p className="max-w-3xl leading-relaxed">
            Weather real (ERA5 2019–2026) · site-level ops labeled synthetic · Balaghat pipeline
            real public data (MRDS · GSI · Copernicus · Sentinel-2) — full audit under Model &amp;
            Data Health. Prospectivity ≠ certified reserves.
          </p>
          <p className="leading-relaxed lg:whitespace-nowrap">
            SIH 2026 · PS SIH26-26009 · Modules A / B / C · Ministry of Steel
          </p>
        </div>
      </footer>
    </div>
  );
}
