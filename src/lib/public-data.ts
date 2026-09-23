// ============================================================
// MOIL Limited — VERIFIED public production record
// Every figure below was reported by a named public source
// (Government of India PIB releases, PTI, or the named trade
// press outlet). Absolute tonnes in `tonnes`; 1 lakh = 100,000.
// Nothing in this file is simulated, estimated, or inferred —
// derived/secondary figures carry an explicit `derived` flag.
// Compiled 2026-09-13 for SIH 2026 (PS 26009) government review.
// ============================================================

export type PeriodType = "annual" | "quarter" | "month" | "cumulative";

export interface VerifiedProductionFigure {
  /** Machine-readable period key (ISO-ish). */
  period: string;
  periodType: PeriodType;
  /** Human label, e.g. "FY2025-26 (Apr'25–Mar'26)". */
  label: string;
  /** Verified production in absolute metric tonnes. */
  tonnes: number;
  /** Year-on-year growth %, only when the source reported it. */
  yoyGrowthPct?: number;
  /** Context note as reported (records, milestones). */
  note?: string;
  /** True only for arithmetic derived from a reported figure. */
  derived?: boolean;
  /** Named source: PIB (Govt of India), PTI, or trade press. */
  source: string;
  sourceUrl?: string;
  /** Publication date of the source (ISO). */
  publishedOn: string;
}

const L = 100_000; // 1 lakh tonnes

export const MOIL_VERIFIED_PRODUCTION: VerifiedProductionFigure[] = [
  {
    period: "FY2022-23-Q4",
    periodType: "quarter",
    label: "Q4 FY2022-23 (Jan–Mar '23)",
    tonnes: Math.round(4.02 * L),
    yoyGrowthPct: 7,
    note: "Record Q4 at the time; growth vs corresponding quarter",
    source: "PIB — Press Information Bureau, Government of India",
    sourceUrl: "https://www.pib.gov.in/allreleasesfacility.aspx",
    publishedOn: "2023-05-29",
  },
  {
    period: "FY2023-24",
    periodType: "annual",
    label: "FY2023-24",
    tonnes: Math.round(17.56 * L),
    yoyGrowthPct: 35,
    note: "Record annual production; +35% over FY2022-23",
    source: "MOIL statement as reported by Rediff Money",
    sourceUrl:
      "https://money.rediff.com/news/market/moil-records-record-manganese-ore-production-in-fy24/7831720240",
    publishedOn: "2024-04-02",
  },
  {
    period: "FY2024-25",
    periodType: "annual",
    label: "FY2024-25",
    tonnes: Math.round(18.02 * L),
    yoyGrowthPct: 2.7,
    note: "Second consecutive record year",
    source: "MOIL statement as reported by PSU Watch",
    sourceUrl: "https://psuwatch.com",
    publishedOn: "2025-04-02",
  },
  {
    period: "FY2025-26",
    periodType: "annual",
    label: "FY2025-26",
    tonnes: Math.round(19.07 * L),
    yoyGrowthPct: 5.8,
    note: "Highest-ever annual output (19.07 lakh t vs 18.03 lakh t prior year)",
    source: "MOIL statement as reported by TipRanks / The Globe and Mail",
    sourceUrl:
      "https://www.theglobeandmail.com/investing/markets/markets-news/Tipranks/1151213/",
    publishedOn: "2026-04-05",
  },
  {
    period: "2025-06",
    periodType: "month",
    label: "Jun 2025",
    tonnes: Math.round(1.68 * L),
    yoyGrowthPct: 2,
    note: "Highest-ever June output; best-ever Q1 FY2025-26 quarter",
    source: "MOIL statement as reported by ET Manufacturing",
    sourceUrl:
      "https://manufacturing.economictimes.indiatimes.com/news/industry/",
    publishedOn: "2025-07-03",
  },
  {
    period: "2025-07",
    periodType: "month",
    label: "Jul 2025",
    tonnes: Math.round(1.45 * L),
    yoyGrowthPct: 12,
    note: "Record July; achieved despite heavy rainfall",
    source: "MOIL statement as reported by Fortune India",
    sourceUrl:
      "https://www.fortuneindia.com/business-news/moil-achieves-12-growth-in-manganese-ore-production-in-july/122345",
    publishedOn: "2025-08-04",
  },
  {
    period: "2025-08",
    periodType: "month",
    label: "Aug 2025",
    tonnes: Math.round(1.45 * L),
    yoyGrowthPct: 17,
    note: "17% YoY jump",
    source: "MOIL statement as reported by ET Manufacturing",
    sourceUrl:
      "https://manufacturing.economictimes.indiatimes.com/news/industry/",
    publishedOn: "2025-09-04",
  },
  {
    period: "2025-04_2025-08",
    periodType: "cumulative",
    label: "Apr–Aug 2025 (5 months)",
    tonnes: Math.round(7.24 * L),
    yoyGrowthPct: 7,
    note: "Cumulative Apr–Aug FY2025-26",
    source: "Press Trust of India (PTI)",
    sourceUrl:
      "https://www.ptinews.com/story/business/moil-says-manganese-ore-production-rises-7-pc-to-7-24-lakh-tonnes/2541078",
    publishedOn: "2025-09-03",
  },
  {
    period: "2025-10",
    periodType: "month",
    label: "Oct 2025",
    tonnes: Math.round(1.6 * L),
    note: "Best-ever October production since inception (1976)",
    source: "PIB — Press Information Bureau, Government of India",
    sourceUrl: "https://www.pib.gov.in/allreleasesfacility.aspx",
    publishedOn: "2025-11-05",
  },
  {
    period: "2025-11",
    periodType: "month",
    label: "Nov 2025",
    tonnes: 165_000,
    yoyGrowthPct: 1,
    note: "Sales in the month: 137,000 t",
    source: "SteelOrbis",
    sourceUrl:
      "https://www.steelorbis.com/steel-news/latest-news/indias-moil-limited-sees-1-rise-in-manganese-ore-production-1437381/",
    publishedOn: "2025-12-04",
  },
  {
    period: "FY2025-26-Q3",
    periodType: "quarter",
    label: "Q3 FY2025-26 (Oct–Dec '25)",
    tonnes: Math.round(4.77 * L),
    yoyGrowthPct: 3.7,
    note: "Best-ever Q3 and best-ever 9-month (Apr–Dec) production",
    source: "PIB — Press Information Bureau, Govt of India (PRID 2112159)",
    sourceUrl: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2112159",
    publishedOn: "2026-01-06",
  },
  {
    period: "FY2026-27-Q1",
    periodType: "quarter",
    label: "Q1 FY2026-27 (Apr–Jun '26)",
    tonnes: Math.round(5.08 * L),
    note: "Record Q1; sales 3.68 lakh t in the quarter",
    source: "MOIL statement as reported by Indian Masterminds",
    sourceUrl: "https://www.indianmasterminds.com/",
    publishedOn: "2026-07-04",
  },
];

/** Company-level context facts, each with its source. */
export const MOIL_VERIFIED_CONTEXT = [
  {
    fact: "MOIL is India's largest manganese ore producer — a Miniratna PSU (Ministry of Mines) headquartered in Nagpur.",
    source: "MOIL / public record",
    sourceUrl: "https://en.wikipedia.org/wiki/MOIL",
  },
  {
    fact: "MOIL holds approximately 34% of India's manganese ore reserves and contributes ~45% of domestic production.",
    source: "Company profile as reported by Trendlyne",
    sourceUrl: "https://trendlyne.com/company-profile/",
  },
  {
    fact: "FY2025-26 was MOIL's highest-ever production and sales year, with total income of ₹1,565.88 crore.",
    source: "MOIL Annual Report FY2025-26 (backend.moil.nic.in)",
    sourceUrl: "https://backend.moil.nic.in",
  },
];

/**
 * The single anchor used to calibrate the digital-twin simulator:
 * verified FY2025-26 company production (19.07 lakh tonnes).
 */
export const VERIFIED_FY26_TONNES = Math.round(19.07 * L);

/** FY-start boundary for Indian fiscal year 2025-26 (Apr 1). */
export const FY26_START_ISO = "2025-04-01";
export const FY26_END_EXCL_ISO = "2026-04-01";
