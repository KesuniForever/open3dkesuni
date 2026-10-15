// Token research (/token): the two local simulations, allocation & vesting and the distribution illustration.
// Pure functions, safe to run in the browser: no store, no network, nothing is saved, issued or offered.
// There is no token, ticker, contract, sale or price. Supply is counted in "model units", not tokens.
import { makeT, type T } from "../i18n/core";

/** Errors and labels are English unless the page passes its t() (src/i18n). */
const EN: T = makeT("en", {});

export const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
/** Whole model units with thousands separators: "1,000,000" (pass "id-ID" for "1.000.000"). */
export const units = (n: number, numberLocale = "en") => Math.round(n).toLocaleString(numberLocale);

export const LIMITS = {
  supplyMax: 1_000_000_000_000,
  cliffMax: 48,
  vestingMax: 120,
  profitMax: 10_000_000_000_000, // Rp10 trillion a month: far above anything Kesuni could enter
  holdersMax: 10_000_000,
} as const;

// ---------- allocation & vesting ----------

export interface AllocationInput {
  supply: number;
  communityPct: number;
  teamPct: number;
  treasuryPct: number;
  cliffMonths: number;
  vestingMonths: number;
}

export type SliceId = "community" | "team" | "treasury";
export interface AllocationSlice { id: SliceId; label: string; pct: number; units: number }

export interface AllocationModel {
  ok: boolean;
  errors: string[];
  totalPct: number;
  /** Units per slice; the treasury takes the rounding rest so the slices add up to the supply exactly. Empty when not ok. */
  slices: AllocationSlice[];
  /** The month the team's share is fully unlocked (cliff + vesting). */
  teamFullMonth: number;
}

const isPct = (x: number) => Number.isFinite(x) && x >= 0 && x <= 100;
const isMonths = (x: number, max: number) => Number.isInteger(x) && x >= 0 && x <= max;

export function allocationModel(i: AllocationInput, t: T = EN): AllocationModel {
  const errors: string[] = [];
  if (!Number.isInteger(i.supply) || i.supply < 1 || i.supply > LIMITS.supplyMax) {
    errors.push(t("Supply must be a whole number from 1 to {max}.", { max: units(LIMITS.supplyMax) }));
  }
  const pcts: [string, number][] = [[t("Community"), i.communityPct], [t("Team"), i.teamPct], [t("Treasury"), i.treasuryPct]];
  for (const [label, x] of pcts) if (!isPct(x)) errors.push(t("{label} must be 0–100%.", { label }));
  const totalPct = Math.round((i.communityPct + i.teamPct + i.treasuryPct) * 100) / 100;
  if (pcts.every(([, x]) => isPct(x)) && totalPct !== 100) errors.push(t("Shares add up to {pct}%, not 100%.", { pct: totalPct }));
  if (!isMonths(i.cliffMonths, LIMITS.cliffMax)) errors.push(t("Cliff must be 0–{max} whole months.", { max: LIMITS.cliffMax }));
  if (!isMonths(i.vestingMonths, LIMITS.vestingMax)) errors.push(t("Vesting must be 0–{max} whole months.", { max: LIMITS.vestingMax }));

  const ok = errors.length === 0;
  const community = ok ? Math.floor((i.supply * i.communityPct) / 100) : 0;
  const team = ok ? Math.floor((i.supply * i.teamPct) / 100) : 0;
  return {
    ok,
    errors,
    totalPct: Number.isFinite(totalPct) ? totalPct : 0,
    slices: ok
      ? [
          { id: "community", label: t("Community"), pct: i.communityPct, units: community },
          { id: "team", label: t("Team"), pct: i.teamPct, units: team },
          { id: "treasury", label: t("Treasury"), pct: i.treasuryPct, units: i.supply - community - team },
        ]
      : [],
    teamFullMonth: (Number.isFinite(i.cliffMonths) ? i.cliffMonths : 0) + (Number.isFinite(i.vestingMonths) ? i.vestingMonths : 0),
  };
}

/**
 * Share of the team allocation unlocked after `month` months (0–100): nothing before the cliff ends,
 * then equal monthly steps over the vesting months. With no vesting period it all unlocks at the cliff.
 */
export function teamUnlockedPct(month: number, cliffMonths: number, vestingMonths: number): number {
  if (month < cliffMonths) return 0;
  if (vestingMonths <= 0) return 100;
  return Math.min(100, ((month - cliffMonths) / vestingMonths) * 100);
}

/** Team model units unlocked after `month` months, in whole units (same rule as teamUnlockedPct, no float drift). */
export function teamUnlockedUnits(teamUnits: number, month: number, cliffMonths: number, vestingMonths: number): number {
  if (month < cliffMonths) return 0;
  if (vestingMonths <= 0) return teamUnits;
  return Math.floor((teamUnits * Math.min(month - cliffMonths, vestingMonths)) / vestingMonths);
}

// ---------- distribution illustration ----------

export interface DistributionInput { monthlyProfitIdr: number; sharePct: number; holders: number }

export interface DistributionPreview {
  ok: boolean;
  errors: string[];
  poolIdr: number;
  perHolderIdr: number;
  /** Whole rupiah left in the pool after splitting it evenly. */
  leftoverIdr: number;
}

/** An illustration only: pool = profit × share, split evenly in whole rupiah. Not a claim right, not a declared payout. */
export function distributionPreview(i: DistributionInput, t: T = EN): DistributionPreview {
  const errors: string[] = [];
  if (!Number.isFinite(i.monthlyProfitIdr) || i.monthlyProfitIdr < 0 || i.monthlyProfitIdr > LIMITS.profitMax) {
    errors.push(t("Monthly profit must be Rp0 to {max}.", { max: rp(LIMITS.profitMax) }));
  }
  if (!isPct(i.sharePct)) errors.push(t("Share must be 0–100%."));
  if (!Number.isInteger(i.holders) || i.holders < 1 || i.holders > LIMITS.holdersMax) {
    errors.push(t("Holders must be a whole number from 1 to {max}.", { max: units(LIMITS.holdersMax) }));
  }
  if (errors.length) return { ok: false, errors, poolIdr: 0, perHolderIdr: 0, leftoverIdr: 0 };
  const poolIdr = Math.floor((i.monthlyProfitIdr * i.sharePct) / 100);
  const perHolderIdr = Math.floor(poolIdr / i.holders);
  return { ok: true, errors, poolIdr, perHolderIdr, leftoverIdr: poolIdr - perHolderIdr * i.holders };
}
