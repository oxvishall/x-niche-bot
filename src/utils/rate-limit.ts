export interface Cap {
  /** Maximum actions allowed in the window. */
  limit: number;
  /** Actions already taken in the window. */
  used: number;
}

/** Remaining actions allowed across several caps (the tightest one wins). */
export function remainingBudget(...caps: Cap[]): number {
  return Math.max(0, Math.min(...caps.map((c) => c.limit - c.used)));
}

/** The stricter of a global cap and an optional per-niche cap. */
export function effectiveLimit(globalLimit: number, nicheLimit?: number): number {
  return nicheLimit === undefined ? globalLimit : Math.min(globalLimit, nicheLimit);
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
