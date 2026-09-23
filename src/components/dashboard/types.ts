// Shared API response types — mirror the live backend contracts exactly.
// Contracts documented in worklog.md Task 2; verified against live endpoints.

export interface Mine {
  id: string;
  code: string;
  name: string;
  state: string;
  district: string;
  lat: number;
  lng: number;
  type: "underground" | "open-pit" | string;
  oreGrade: number; // Mn %
  annualCapacity: number; // tonnes
}

export interface Factor {
  name: string;
  value: number;
  unit: string;
  contribution: number; // tonnes (production model) — negative hurts
  direction: "positive" | "negative" | string;
}

export interface WeightFeature {
  name: string;
  weight: number;
  absImportance: number;
  unit?: string;
}

export interface OverviewKpis {
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
}

export interface MonthlyPoint {
  month: string; // "Aug 2025"
  key: string; // "2025-08"
  actual: number;
  target: number;
  fitted: number;
  rainfall: number;
}

export interface ForecastMonth {
  month: string;
  key: string;
  predicted: number;
  target: number;
  actual: number | null;
}

export interface RiskCard {
  id: string;
  mineCode: string;
  mineName: string;
  weekStart: string; // "2026-08-31"
  horizon: number;
  predicted: number;
  target: number;
  gap: number;
  gapPct: number;
  confidence: number; // 0..1
  status: "ok" | "watch" | "risk" | string;
  factors: Factor[];
}

export interface ModelPerformance {
  algorithm: string;
  metrics: {
    r2: number;
    mae: number;
    mape: number;
    trainSamples: number;
    testSamples: number;
  };
  riskBands?: {
    method: string;
    nominal: number;
    coverage80: number;
    note: string;
  };
  features: WeightFeature[];
  attribution: string;
  trainedAt: string;
  horizonWeeks: number;
  backtestNote: string;
}

export interface OverviewData {
  kpis: OverviewKpis;
  monthly: MonthlyPoint[];
  forecastMonths: ForecastMonth[];
  topRisks: RiskCard[];
  insights: string[];
  modelPerformance: ModelPerformance;
  reserveModel: {
    algorithm: string;
    auc: number;
    accuracy: number;
    trainCells: number;
    features: WeightFeature[];
    trainedAt: string;
  };
  provenance: { real: string[]; synthetic: string[] };
}

export interface ReserveCell {
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

export interface ReserveMine extends Mine {
  cells: ReserveCell[];
  stats: {
    totalCells: number;
    highPotential: number;
    avgProb: number;
    estMt: number;
    drillTargets: DrillTarget[];
  };
}

export interface ReserveMapData {
  mines: ReserveMine[];
  modelInfo: {
    algorithm: string;
    auc: number;
    accuracy: number;
    trainCells: number;
    features: WeightFeature[];
    trainedAt: string;
  };
}

export interface WeeklyRecord {
  weekStart: string; // "2026-08-24"
  target: number;
  actual: number;
  fitted: number;
  rainfall: number;
  downtime: number;
}

export interface ForecastRecord {
  weekStart: string;
  horizon: number;
  predicted: number;
  target: number;
  confidence: number;
  status: "ok" | "watch" | "risk" | string;
  shortfall: number;
  factors: Factor[];
  p10?: number | null; // quantile ridge 80% band, lower edge
  p90?: number | null; // quantile ridge 80% band, upper edge
}

export interface ProductionMine extends Mine {
  weekly: WeeklyRecord[];
  forecast: ForecastRecord[];
  last12AchievementPct: number;
}

export interface ProductionData {
  mines: ProductionMine[];
  modelPerformance: ModelPerformance;
}

export interface Risk extends RiskCard {
  mineId: string;
  state: string;
  mineType: string;
}

export interface RisksData {
  risks: Risk[];
}

export interface Recommendation {
  id: string;
  mineId: string;
  mineCode: string;
  mineName: string;
  mineType: string;
  weekStart: string;
  type: string; // redeploy | blast-schedule | maintenance | capacity | logistics
  title: string;
  description: string;
  impactTonnes: number;
  effort: "low" | "medium" | "high" | string;
  priority: number;
  rationale: string;
  status: "proposed" | "applied" | string;
}

export interface RecommendationsData {
  recommendations: Recommendation[];
}

export interface MinesData {
  mines: Mine[];
}
