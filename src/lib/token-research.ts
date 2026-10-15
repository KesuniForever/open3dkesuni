// Token research (/token): the launch gates. Research only: no token exists and none is issued here.
// Kesuni's stance: a token would only ever be offered in countries where crypto transactions are allowed, never in
// Indonesia. All current customers are in Indonesia, so all money stays on Arc Testnet (test USDC).
// Two gates are computed live from real store data (traction and reputation; simulated orders never count).
// The other six are fixed until there is real evidence for them. Issuance stays blocked unless every gate is PASS,
// and even then the next step is a legal review, never an issue. Thresholds are Kesuni's internal draft, not a regulator's rule.
import { traction } from "./traction";
import { reputation } from "./reputation";
import { makeT, type T } from "../i18n/core";

/** The gate texts are English unless the page passes its t() (src/i18n). Status words stay English (the page translates them). */
const EN: T = makeT("en", {});

export type GateStatus = "PASS" | "NOT YET" | "BLOCKED" | "UNKNOWN";

export interface GateCheck {
  label: string;
  short: string;             // label under the number on the gate card
  value: number | null;      // null = no data yet
  target: number;
  unit: "" | "%";
  ok: boolean;
}

export interface Gate {
  n: string;                 // "01" … "08"
  id: string;
  title: string;
  status: GateStatus;
  line: string;              // one short sentence
  why?: string;              // behind the ⓘ
  evidence: string;
  reviewer: string;
  period: string;
  live: boolean;             // computed from store data on every page load
  checks?: GateCheck[];
}

export interface Readiness {
  gates: Gate[];
  passed: number;
  total: number;
  overall: "ISSUANCE BLOCKED" | "READY FOR LEGAL REVIEW";
}

/** Real-data facts the live gates need. Built from traction() and reputation(), which count real orders only. */
export interface GateFacts {
  realOrders: number;
  realCustomers: number;
  verifiedOnArc: number;
  mismatchOnArc: number;
  finished: number;
  onTimePct: number | null;
  firstPassPct: number | null;
}

/** Internal draft thresholds (Kesuni's own policy idea, not a legal requirement). */
export const THRESHOLDS = {
  realOrders: 30,
  realCustomers: 10,
  verifiedOnArc: 30,
  finished: 10,
  onTimePct: 90,
  firstPassPct: 95,
} as const;

export const WHY = {
  indonesia:
    "Indonesia: payments must be in Rupiah (Law 7/2011 Art. 21); stablecoins are not a means of payment (Law 4/2026); " +
    "businesses may buy crypto only as an investment (OJK POJK 27/2024 Art. 80(7)).",
  jurisdiction: "Only where crypto transactions are allowed, never Indonesia. All current customers are in Indonesia, so everything stays on Arc Testnet.",
  treasury: "Token funds would need their own wallets and keys, apart from customer escrow and studio money.",
} as const;

const min = (label: string, short: string, value: number | null, target: number, unit: "" | "%" = ""): GateCheck =>
  ({ label, short, value, target, unit, ok: value !== null && value >= target });

export function evaluateGates(f: GateFacts, t: T = EN): Readiness {
  const NONE = { evidence: t("none"), reviewer: t("none"), period: "—" };
  const business = [
    min(t("Real orders"), t("orders"), f.realOrders, THRESHOLDS.realOrders),
    min(t("Real customers"), t("customers"), f.realCustomers, THRESHOLDS.realCustomers),
    min(t("Verified on Arc"), t("Arc-verified"), f.verifiedOnArc, THRESHOLDS.verifiedOnArc),
  ];
  const businessPass = business.every((c) => c.ok) && f.mismatchOnArc === 0;

  const service = [
    min(t("Finished real orders"), t("finished"), f.finished, THRESHOLDS.finished),
    min(t("On time"), t("on time"), f.onTimePct, THRESHOLDS.onTimePct, "%"),
    min(t("Passed QC first time"), t("QC first pass"), f.firstPassPct, THRESHOLDS.firstPassPct, "%"),
  ];
  const servicePass = service.every((c) => c.ok);

  const gates: Gate[] = [
    {
      n: "01", id: "legal", title: t("Legal & instrument rights"), status: "BLOCKED", live: false,
      line: t("Blocked in Indonesia. Other jurisdictions not reviewed."), why: t(WHY.indonesia), ...NONE,
    },
    {
      n: "02", id: "jurisdiction", title: t("Jurisdiction filter"), status: "NOT YET", live: false,
      line: t("Offer only where crypto is allowed. Not built."), why: t(WHY.jurisdiction), ...NONE,
    },
    {
      n: "03", id: "treasury", title: t("Security & treasury separation"), status: "UNKNOWN", live: false,
      line: t("Separation not demonstrated."), why: t(WHY.treasury), ...NONE,
    },
    {
      n: "04", id: "business", title: t("Business evidence"), status: businessPass ? "PASS" : "NOT YET", live: true,
      line: f.mismatchOnArc > 0
        ? t(f.mismatchOnArc === 1 ? "{n} transfer does not match on Arc." : "{n} transfers do not match on Arc.", { n: f.mismatchOnArc })
        : businessPass ? t("Real usage meets the draft thresholds.") : t("Below the draft thresholds."),
      evidence: t("real orders, Arc checks"), reviewer: t("code"), period: t("all time"), checks: business,
    },
    {
      n: "05", id: "service", title: t("Service health"), status: servicePass ? "PASS" : "NOT YET", live: true,
      line: f.finished < THRESHOLDS.finished
        ? t("Too few finished real orders.")
        : servicePass ? t("On time and QC meet the draft.") : t("On time or QC below the draft."),
      evidence: t("acceptance, QC records"), reviewer: t("code"), period: t("all time"), checks: service,
    },
    {
      n: "06", id: "demand", title: t("Demand outside Indonesia"), status: "UNKNOWN", live: false,
      line: t("No customer evidence yet."), ...NONE,
    },
    {
      n: "07", id: "audit", title: t("Audit & recovery"), status: "NOT YET", live: false,
      line: t("No audit or recovery drill done."), ...NONE,
    },
    {
      n: "08", id: "signoff", title: t("Owner sign-off"), status: "NOT YET", live: false,
      line: t("Not given."), ...NONE,
    },
  ];

  const passed = gates.filter((g) => g.status === "PASS").length;
  return { gates, passed, total: gates.length, overall: passed === gates.length ? "READY FOR LEGAL REVIEW" : "ISSUANCE BLOCKED" };
}

/** Reads the store (read-only): real traction and reputation only. */
export function gateFacts(): GateFacts {
  const t = traction();
  const r = reputation();
  return {
    realOrders: t.realOrders,
    realCustomers: t.realCustomers,
    verifiedOnArc: t.arcTxs.verifiedOnArc,
    mismatchOnArc: t.arcTxs.mismatchOnArc,
    finished: r.finished,
    onTimePct: r.onTimePct,
    firstPassPct: r.firstPassPct,
  };
}

export const tokenReadiness = (t: T = EN): Readiness => evaluateGates(gateFacts(), t);
