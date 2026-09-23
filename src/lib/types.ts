// Shared API response types (matches backend contracts in worklog.md)

export interface Mine {
  id: string;
  code: string;
  name: string;
  state: string;
  district: string;
  lat: number;
  lng: number;
  type: "underground" | "open-pit" | string;
  oreGrade: number;
  annualCapacity: number;
}

export interface Factor {
  name: string;
  value: number;
  unit: string;
  contribution: number;
  direction: "negative" | "positive";
}

export interface FeatureImportance {
  name: string;
  weight: number;
  absImportance: number;
  unit?: string;
  /** Optional data provenance tag ("REAL" | "SYNTHETIC") — may be absent on older seeds. */
  provenance?: string;
}

export interface ProductionModelMeta {
  algorithm: string;
  metrics: {
    r2: number;
    mae: number;
    mape: number;
    trainSamples: number;
    testSamples: number;
  };
  features: FeatureImportance[];
  attribution: string;
  trainedAt: string;
  horizonWeeks: number;
  backtestNote: string;
}

export interface ReserveModelMeta {
  algorithm: string;
  auc: number;
  accuracy: number;
  trainCells: number;
  features: FeatureImportance[];
  trainedAt: string;
}

export interface TopRisk {
  id: string;
  mineCode: string;
  mineName: string;
  weekStart: string;
  horizon: number;
  predicted: number;
  target: number;
  gap: number;
  gapPct: number;
  confidence: number;
  status: string;
  factors: Factor[];
}

export interface OverviewData {
  kpis: {
    lastMonthActual: number;
    lastMonthTarget: number;
    lastMonthAchievementPct: number;
    nextMonthPredicted: number;
    nextMonthTarget: number;
    atRiskMines: number;
    totalMines: number;
    activeRisks: number;
    watchCount: number;
    proposedRecs: number;
    potentialRecovery: number;
    highPotentialCells: number;
    totalCells: number;
    estReserveMt: number;
  };
  monthly: {
    month: string;
    key: string;
    actual: number;
    target: number;
    fitted: number;
    rainfall: number;
  }[];
  forecastMonths: {
    month: string;
    key: string;
    predicted: number;
    target: number;
    actual: null;
  }[];
  topRisks: TopRisk[];
  insights: string[];
  modelPerformance: ProductionModelMeta | null;
  reserveModel: ReserveModelMeta | null;
  provenance: { real: string[]; synthetic: string[] } | null;
}

export interface ReserveCellDto {
  row: number;
  col: number;
  lat: number;
  lng: number;
  ndvi: number;
  soilMoisture: number;
  lst: number;
  rockMatch: number;
  distToOre: number;
  probability: number;
}

export interface DrillTarget {
  row: number;
  col: number;
  lat: number;
  lng: number;
  probability: number;
  rockMatch: number;
  distToOre: number;
  ndvi: number;
}

export interface ReserveMineData extends Mine {
  cells: ReserveCellDto[];
  stats: {
    totalCells: number;
    highPotential: number;
    avgProb: number;
    estMt: number;
    drillTargets: DrillTarget[];
  };
}

export interface ReserveMapData {
  mines: ReserveMineData[];
  modelInfo: ReserveModelMeta | null;
}

export interface WeeklyPoint {
  weekStart: string;
  target: number;
  actual: number;
  fitted: number | null;
  rainfall: number;
  downtime: number;
}

export interface ForecastPoint {
  weekStart: string;
  horizon: number;
  predicted: number;
  target: number;
  confidence: number;
  status: string;
  shortfall: number;
  factors: Factor[];
  p10?: number | null; // quantile ridge 80% band, lower edge (tonnes)
  p90?: number | null; // quantile ridge 80% band, upper edge (tonnes)
}

export interface ProductionMineData extends Mine {
  weekly: WeeklyPoint[];
  forecast: ForecastPoint[];
  last12AchievementPct: number;
}

export interface ProductionData {
  mines: ProductionMineData[];
  modelPerformance: ProductionModelMeta | null;
}

export interface RiskItem {
  id: string;
  mineId: string;
  mineCode: string;
  mineName: string;
  state: string;
  mineType: string;
  weekStart: string;
  horizon: number;
  predicted: number;
  target: number;
  gap: number;
  gapPct: number;
  confidence: number;
  status: string;
  factors: Factor[];
}

export interface RecommendationItem {
  id: string;
  mineId: string;
  mineCode: string;
  mineName: string;
  mineType: string;
  weekStart: string;
  type: string;
  title: string;
  description: string;
  impactTonnes: number;
  effort: "low" | "medium" | "high" | string;
  priority: number;
  rationale: string;
  status: "proposed" | "applied" | string;
}

// ---------- REAL Balaghat pipeline (/api/real-pipeline) ----------

export interface RealPipelineSource {
  name: string;
  url?: string;
  fetched_utc?: string;
  license?: string;
  note?: string;
  records?: number | string;
}

export interface RealPipelineBinaryMetrics {
  roc_auc: number;
  pr_auc: number;
  brier: number | null;
}

export interface RealPipelineMetrics {
  honest: {
    label: string;
    logistic: RealPipelineBinaryMetrics;
    randomForest: RealPipelineBinaryMetrics;
  };
  circularityTrap: {
    label: string;
    logistic: RealPipelineBinaryMetrics;
    randomForest: RealPipelineBinaryMetrics;
    warning: {
      issue: string;
      what_we_claim: string;
      honest_metrics: {
        logistic_block_cv: RealPipelineBinaryMetrics;
        random_forest_block_cv: RealPipelineBinaryMetrics;
      };
    };
  };
  priorOnly: {
    roc_auc: number;
    pr_auc: number;
    brier: null;
    note: string;
  };
  classBalance: {
    positive: number;
    negative: number;
    ambiguous_excluded: number;
  };
}

export interface RealPipelineModel {
  mapModel: string;
  featureUnivariateAuc: Record<string, number>;
  logisticCoefficients: Record<string, number>;
  randomForestImportances: Record<string, number>;
  tierThresholds: {
    high_min: number;
    medium_min: number;
    basis: string;
  };
}

export interface RealPipelineTarget {
  lon: number;
  lat: number;
  prospectivity: number;
  tier: string;
  nearest_known_site: string;
  nearest_dev_status: string;
  dist_to_nearest_km: number;
  host_litho: string;
  elev_m: number;
  novelty: string;
}

export interface RealPipelineData {
  provenance: { data: string; scores: string; metrics: string };
  studyArea: {
    name: string;
    aoi: { lon_min: number; lon_max: number; lat_min: number; lat_max: number };
    cellSizeDeg: number;
  };
  metrics: RealPipelineMetrics;
  model: RealPipelineModel;
  grid: {
    cell_deg: number;
    aoi: { lon_min: number; lon_max: number; lat_min: number; lat_max: number };
    cells_total: number;
    high: number;
    medium: number;
    low: number;
  };
  topTargets: RealPipelineTarget[];
  labels: {
    positive_rule: string;
    negative_rule: string;
    excluded_band: string;
    caveat: string;
  };
  validation: { spatial_block_cv: string; why: string };
  sources: Record<string, RealPipelineSource>;
  limitations: string[];
  runUtc: string;
}

// ---------- Formatting helpers ----------

export const fmtT = (n: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));

export const fmtSignedT = (n: number): string =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtT(Math.abs(n))}`;

export const fmtPct = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
