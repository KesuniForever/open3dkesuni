// In-memory store for the prototype. Data is labelled "simulated" until real.
// Replace with a database later; keep the function signatures.
import type { Acceptance, Decision, Evidence, Order, PaymentIntent, Quote, Vendor } from "./types";
import { usdcToMicro } from "./policy";

interface Db {
  orders: Map<string, Order>;
  vendors: Map<string, Vendor>;
  quotes: Map<string, Quote>;
  decisions: Decision[];
  evidence: Evidence[];
  acceptances: Map<string, Acceptance>;
  intents: Map<string, PaymentIntent>;
}

function seed(): Db {
  const db: Db = {
    orders: new Map(), vendors: new Map(), quotes: new Map(),
    decisions: [], evidence: [], acceptances: new Map(), intents: new Map(),
  };
  db.vendors.set("own", { id: "own", name: "Own studio", address: "0x0000000000000000000000000000000000000001", approved: true });
  db.vendors.set("partner-a", { id: "partner-a", name: "Partner printer A (simulated)", address: "0x0000000000000000000000000000000000000002", approved: true });
  db.orders.set("ORD-001", {
    id: "ORD-001", jobId: "JOB-001", product: "Custom lamp side table (3D-printed components)",
    quantity: 1, deadline: "2026-10-08", designVersion: "v1",
    mandateMicro: usdcToMicro("32"), status: "CREATED", label: "simulated",
  });
  // Demo refusal: partner quote 35 exceeds mandate 32.
  db.quotes.set("Q-own", { id: "Q-own", orderId: "ORD-001", vendorId: "own", priceMicro: usdcToMicro("30"), etaHours: 48, source: "own" });
  db.quotes.set("Q-partner", { id: "Q-partner", orderId: "ORD-001", vendorId: "partner-a", priceMicro: usdcToMicro("35"), etaHours: 24, source: "partner" });
  return db;
}

const g = globalThis as unknown as { __kesuniDb?: Db };
export const db: Db = (g.__kesuniDb ??= seed());

export function resetDb(): void {
  g.__kesuniDb = seed();
}
