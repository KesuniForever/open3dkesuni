// The customer portal (/request/<code>): what its tabs show next to the order form, shaped on the server.
// Every field is picked by name (an allow-list), as on the Live studio page: the printers without their orders, files
// or people; the official price per gram without Kesuni's cost or margin; the token research gates without evidence,
// reviewers or thresholds. Pure (rows in, view out) apart from the defaults that read the server's settings.
import { MATERIALS, priceByWeight, pricingConfig, pricingFor, toMaterial, type PricingConfig } from "./pricing";
import { idrToMicro } from "./costing";
import { ownerRules, type OwnerRules } from "./owner-rules";
import { microToUsdc } from "./policy";
import type { T } from "../i18n/core";
import type { LiveView } from "./live";
import type { Tone } from "./machines";
import type { GateStatus, Readiness } from "./token-research";
import type { Material } from "./types";

// ---------- Price calculator ----------

/** The calculator's form fields as the URL gives them (?g=16&q=2&m=PETG). */
export interface PortalPriceQuery {
  g?: string | string[];
  q?: string | string[];
  m?: string | string[];
}

export type PortalPriceResult =
  | { ok: true; gramsPerUnit: number; quantity: number; pricePerGramIdr: number; unitPriceIdr: number; totalIdr: number; usdc: string }
  | { ok: false; reasons: string[] };

export interface PortalPrice {
  material: Material;
  /** Kesuni's official selling price per gram of each material. Never the cost. */
  perGram: Record<Material, number>;
  /** The price per piece is rounded up to this. */
  roundIdr: number;
  /** Orders under this total, or above approvalAboveIdr, wait for the owner's approval before Kesuni can price them
   *  (src/lib/owner-rules.ts). */
  minOrderIdr: number;
  approvalAboveIdr: number;
  /** What the visitor typed, to fill the form again. */
  input: { grams: string; quantity: string };
  /** null until grams are given. */
  result: PortalPriceResult | null;
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";
/**
 * Grams as people type them: "12,5" (Indonesian) and "12.5" are twelve and a half; "1.000" and "1,000" are a thousand
 * (groups of three digits); "16 g" and "16 gram" are 16.
 */
export function gramsTyped(s: string): number {
  const v = s.trim().replace(/\s*(g|gr|gram|grams)\.?$/i, "");
  if (/^[1-9]\d{0,2}([.,]\d{3})+$/.test(v)) return Number(v.replace(/[.,]/g, ""));
  return /^\d*([.,]\d*)?$/.test(v) ? Number(v.replace(",", ".")) : Number.NaN;
}
const NOT_A_NUMBER = "Enter the grams per piece as a number, for example 16";

/**
 * The official price for a weight, exactly as an order is priced (agreement.ts setSlicerGrams): grams per piece ×
 * the material's price per gram, rounded up per piece, × quantity; USDC as the quote would hold it. The colour mode
 * never changes the price per gram, so it is left out. With the owner's minimum order and approval limit, so the page can
 * say when a total that small or that large waits for approval. (The USDC stays for the API; the page shows rupiah.)
 */
export function portalPrice(
  query: PortalPriceQuery, cfg: PricingConfig = pricingConfig(), rules: Pick<OwnerRules, "minOrderIdr" | "approvalAboveIdr"> = ownerRules(),
): PortalPrice {
  const material = toMaterial(first(query.m)) ?? "PLA";
  const grams = first(query.g).trim().slice(0, 12);
  const quantity = first(query.q).trim().slice(0, 6) || "1";
  const perGram = Object.fromEntries(MATERIALS.map((m) => [m, pricingFor(cfg, m).pricePerGramIdr])) as Record<Material, number>;
  let result: PortalPriceResult | null = null;
  if (grams) {
    const g = gramsTyped(grams);
    const r = priceByWeight(g, Number(quantity), "single", pricingFor(cfg, material));
    result = r.ok
      ? {
        ok: true, gramsPerUnit: r.price.gramsPerUnit, quantity: r.price.quantity, pricePerGramIdr: r.price.pricePerGramIdr,
        unitPriceIdr: r.price.unitPriceIdr, totalIdr: r.price.totalIdr, usdc: microToUsdc(idrToMicro(r.price.totalIdr)),
      }
      // Not a number at all: say what to type, not that the number is out of range.
      : { ok: false, reasons: r.reasons.map((x) => (Number.isNaN(g) && x.startsWith("Grams per piece") ? NOT_A_NUMBER : x)) };
  }
  return { material, perGram, roundIdr: cfg.roundIdr, minOrderIdr: rules.minOrderIdr, approvalAboveIdr: rules.approvalAboveIdr, input: { grams, quantity }, result };
}

// ---------- Machines ----------

export interface PortalSpool {
  key: string;
  type: string | null;     // "PLA"
  name: string | null;     // English colour name; the page translates it
  color: string | null;    // "#RRGGBB"
  colors: string[];
  active: boolean;         // in the toolhead now
}

export interface PortalPrinter {
  id: string;
  name: string;
  online: boolean;
  /** What it is doing, in the page's language: "Free", "Printing 45%", "Offline". */
  state: { tone: Tone; text: string };
  /** Bambu's own stage words, only while a print runs or when a person is needed. */
  stage: { text: string; needsPerson: boolean } | null;
  /** remaining: "42m"; doneAt: "13:42" WIB (null while paused or offline). */
  progress: { percent: number; paused: boolean; remaining: string; doneAt: string | null } | null;
  /** The spools loaded (AMS and the external spool). Empty slots are left out. */
  spools: PortalSpool[];
}

export interface PortalMachines {
  at: string;
  /** The newest printer report ("12 s ago"), null before the first. */
  lastReport: string | null;
  /** No printer online: the studio's connection is down, the numbers are the last known ones. */
  bridgeDown: boolean;
  printers: PortalPrinter[];
}

/**
 * The Live studio's printers (src/lib/live.ts, already allow-listed), lighter: no order, bed, temperatures or faults.
 * With the page's t, an online printer at rest (idle, or a print finished: the "ok" pill) reads "Free" for a customer.
 */
export function portalMachines(v: LiveView, t?: T): PortalMachines {
  const running = new Map(v.overview.printers.running.map((r) => [r.id, r]));
  const printers = v.printers.map((p): PortalPrinter => ({
    id: p.id,
    name: p.name,
    online: p.online,
    state: { tone: p.pill.tone, text: t && p.online && p.pill.tone === "ok" && !p.progress ? t("Free") : p.pill.text },
    stage: p.stage && (p.progress || p.stage.needsPerson) ? { text: p.stage.text, needsPerson: p.stage.needsPerson } : null,
    progress: p.progress
      ? { percent: p.progress.percent, paused: p.progress.paused, remaining: p.remaining, doneAt: running.get(p.id)?.doneAt ?? null }
      : null,
    spools: [
      ...(p.ams?.slots ?? []).filter((s) => !s.empty)
        .map((s) => ({ key: `slot-${s.slot}`, type: s.type, name: s.name, color: s.color, colors: s.colors, active: s.active })),
      ...(p.external ? [{ key: "ext", type: p.external.type, name: p.external.name, color: p.external.color, colors: [], active: p.external.active }] : []),
    ],
  }));
  return {
    at: v.at,
    lastReport: v.lastReport,
    bridgeDown: printers.length > 0 && !printers.some((p) => p.online),
    printers,
  };
}

// ---------- Token research ----------

export interface PortalGate { n: string; id: string; title: string; status: GateStatus; line: string }
export interface PortalToken { overall: Readiness["overall"]; passed: number; total: number; gates: PortalGate[] }

/** The launch gates, one line each: no evidence, reviewer, period or thresholds behind them. */
export const portalToken = (r: Readiness): PortalToken => ({
  overall: r.overall,
  passed: r.passed,
  total: r.total,
  gates: r.gates.map((g) => ({ n: g.n, id: g.id, title: g.title, status: g.status, line: g.line })),
});
