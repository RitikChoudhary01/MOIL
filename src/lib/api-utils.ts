// Shared helpers for API route handlers
import type { Prisma } from "@prisma/client";

export interface Factor {
  name: string;
  value: number;
  unit: string;
  contribution: number;
  direction: "negative" | "positive";
}

export function parseFactors(json: string): Factor[] {
  try {
    const parsed = JSON.parse(json) as Factor[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const monthKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export const monthLabel = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

export const weekLabel = (d: Date): string =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** Tonnage estimate per reserve cell, scaled by ore grade (transparent heuristic).
 *  Calibrated so total portfolio estimate lands near MOIL's published
 *  reserve base (~154 Mt) — clearly labeled as model-based, not certified. */
export const cellTonnage = (oreGrade: number): number =>
  0.26 * (oreGrade / 35); // Mt per fully-prospective cell

export type MineSelect = {
  id: true;
  code: true;
  name: true;
  state: true;
  district: true;
  lat: true;
  lng: true;
  type: true;
  oreGrade: true;
  annualCapacity: true;
};

export const mineSelect: MineSelect = {
  id: true,
  code: true,
  name: true,
  state: true,
  district: true,
  lat: true,
  lng: true,
  type: true,
  oreGrade: true,
  annualCapacity: true,
};

export function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}
