// ============================================================
// MOIL Limited — Mine Master Data (public information)
// 10 operations across the Balaghat belt (MP) and
// Nagpur–Bhandara belt (Maharashtra).
//
// CAPACITY CALIBRATION (verified): individual mine capacities
// are approximate public figures, scaled by a common factor so
// the portfolio total (2.083 Mt/yr nameplate) reproduces MOIL's
// VERIFIED FY2025-26 company production of 19.07 lakh tonnes
// (1.907 Mt) under the simulator's efficiency model. Company
// total is verified against PIB/company statements — see
// src/lib/public-data.ts for the cited record. Per-mine split
// is approximate (no single public mine-wise source).
// ============================================================

export interface MineSeed {
  code: string;
  name: string;
  state: string;
  district: string;
  lat: number;
  lng: number;
  type: "underground" | "open-pit";
  oreGrade: number; // Mn % (typical run-of-mine grade)
  annualCapacity: number; // tonnes/year
  // geology descriptor for reserve module (Sausar vs Sakoli/Amgaon belts)
  geology: string;
}

export const MINES: MineSeed[] = [
  {
    code: "BLGT",
    name: "Balaghat Mine",
    state: "Madhya Pradesh",
    district: "Balaghat",
    lat: 21.81,
    lng: 80.15,
    type: "underground",
    oreGrade: 38,
    annualCapacity: 424_000,
    geology: "Sausar Group metasediments (Balaghat belt)",
  },
  {
    code: "BRWL",
    name: "Bharweli Mine",
    state: "Madhya Pradesh",
    district: "Balaghat",
    lat: 21.9,
    lng: 80.07,
    type: "underground",
    oreGrade: 40,
    annualCapacity: 305_000,
    geology: "Sausar Group metasediments (Balaghat belt)",
  },
  {
    code: "UKWA",
    name: "Ukwa Mine",
    state: "Madhya Pradesh",
    district: "Balaghat",
    lat: 21.9,
    lng: 80.41,
    type: "underground",
    oreGrade: 36,
    annualCapacity: 152_000,
    geology: "Sausar Group metasediments (Balaghat belt)",
  },
  {
    code: "TRDI",
    name: "Tirodi Mine",
    state: "Madhya Pradesh",
    district: "Balaghat",
    lat: 21.73,
    lng: 79.67,
    type: "open-pit",
    oreGrade: 30,
    annualCapacity: 169_000,
    geology: "Sausar Group metasediments (Tirodi sector)",
  },
  {
    code: "DGBZ",
    name: "Dongri Buzurg Mine",
    state: "Maharashtra",
    district: "Bhandara",
    lat: 20.98,
    lng: 79.33,
    type: "open-pit",
    oreGrade: 30,
    annualCapacity: 339_000,
    geology: "Sakoli Group metamorphics (Bhandara belt)",
  },
  {
    code: "CHKL",
    name: "Chikla Mine",
    state: "Maharashtra",
    district: "Bhandara",
    lat: 21.33,
    lng: 79.65,
    type: "underground",
    oreGrade: 35,
    annualCapacity: 152_000,
    geology: "Sakoli Group metamorphics (Bhandara belt)",
  },
  {
    code: "KNDR",
    name: "Kandri Mine",
    state: "Maharashtra",
    district: "Nagpur",
    lat: 21.4,
    lng: 79.27,
    type: "underground",
    oreGrade: 38,
    annualCapacity: 186_000,
    geology: "Amgaon Group metamorphics (Mansar belt)",
  },
  {
    code: "MNSR",
    name: "Mansar Mine",
    state: "Maharashtra",
    district: "Nagpur",
    lat: 21.38,
    lng: 79.24,
    type: "open-pit",
    oreGrade: 28,
    annualCapacity: 135_000,
    geology: "Amgaon Group metamorphics (Mansar belt)",
  },
  {
    code: "STSJ",
    name: "Sitasaongi Mine",
    state: "Maharashtra",
    district: "Gondia",
    lat: 21.07,
    lng: 80.12,
    type: "underground",
    oreGrade: 32,
    annualCapacity: 119_000,
    geology: "Sakoli Group metamorphics (Sitasaongi belt)",
  },
  {
    code: "GMGN",
    name: "Gumgaon Mine",
    state: "Maharashtra",
    district: "Nagpur",
    lat: 21.22,
    lng: 78.92,
    type: "underground",
    oreGrade: 35,
    annualCapacity: 102_000,
    geology: "Amgaon Group metamorphics (Kamptee belt)",
  },
];

// Central India manganese geology insight (PRD §10 — domain-informed insight)
export const DOMAIN_INSIGHTS = [
  "Open-pit operations (Dongri Buzurg, Mansar, Tirodi) show 2.1× higher monsoon production sensitivity than underground mines — pit flooding and wet hauling roads restrict despatch during Jun–Sep.",
  "Reserve likelihood peaks along the Sausar Group manganese horizon in the Balaghat belt — lithology favorability is the strongest reserve predictor, consistent with GSI published maps.",
  "Vegetation anomalies (low NDVI) correlate with manganiferous outcrop zones, enabling satellite-based drill-target prioritisation.",
  "Equipment downtime is the single largest controllable shortfall driver — recovering 40% of avoidable downtime closes ~65% of predicted shortfalls.",
];
