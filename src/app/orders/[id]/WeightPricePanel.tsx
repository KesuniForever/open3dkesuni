"use client";

import { useState } from "react";
import { priceByWeight, type PricingConfig } from "@/lib/pricing";
import type { Order, Quote } from "@/lib/types";

type Act = (url: string, body: unknown, success: string) => Promise<void>;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Kesuni's official price: grams per unit from the slicer × price per gram. Same formula as the server (pricing.ts). */
export default function WeightPricePanel({ order, quotes, pricing, budgetIdr, minMarginPct, busy, act }: {
  order: Order; quotes: Quote[]; pricing: PricingConfig; budgetIdr: number; minMarginPct: number; busy: boolean; act: Act;
}) {
  const w = order.gramPricing;
  const quote = w ? quotes.find((q) => q.id === w.quoteId) : undefined;
  return (
    <section className="card">
      <h2>Price by weight (official)</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {rp(pricing.pricePerGramIdr)} per gram, cost {rp(pricing.costPerGramIdr)} per gram (filament, finishing, print hours, power).
        Unit price rounded up to {rp(pricing.roundIdr)}. Grams per unit come from the slicer (Bambu Studio). The long calculator below is only a check.
      </p>
      {w && (
        <div className="alert ok">
          {quote ? <>Kesuni quote <code>{quote.id}</code></> : <>Earlier by-weight price</>}: {w.gramsPerUnit} g × {rp(w.pricePerGramIdr)} → <b>{rp(w.unitPriceIdr)}</b> per unit
          × {w.quantity} = <b>{rp(w.totalIdr)}</b> · cost {rp(w.costIdr)} · margin {w.totalIdr > 0 ? Math.round(((w.totalIdr - w.costIdr) / w.totalIdr) * 1000) / 10 : 0}%
          {quote && <> · ETA {quote.etaHours} h</>}
          <div className="muted" style={{ fontSize: 13 }}>
            Grams from: {w.source} · priced by {w.by === "agent" ? "the Chief" : "a person"} · {new Date(w.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
          </div>
        </div>
      )}
      {order.slicerGrams && (
        <p className="muted" style={{ fontSize: 13 }}>
          Grams for the Chief: <b>{order.slicerGrams.gramsPerUnit} g</b> per unit ({order.slicerGrams.source}), entered by {order.slicerGrams.by}.
          The Chief prices only with these grams, never with numbers from the customer&apos;s note.
        </p>
      )}
      {order.status === "CREATED" ? (
        <WeightForm key={w?.at ?? "none"} order={order} pricing={pricing} budgetIdr={budgetIdr} minMarginPct={minMarginPct} busy={busy} act={act}
          initialGrams={w ? String(w.gramsPerUnit) : ""} initialSource={w?.source ?? ""} />
      ) : !w && <p className="muted">Quotes are closed once a plan is chosen.</p>}
    </section>
  );
}

function WeightForm({ order, pricing, budgetIdr, minMarginPct, busy, act, initialGrams, initialSource }: {
  order: Order; pricing: PricingConfig; budgetIdr: number; minMarginPct: number; busy: boolean; act: Act;
  initialGrams: string; initialSource: string;
}) {
  const [grams, setGrams] = useState(initialGrams);
  const [source, setSource] = useState(initialSource);
  const [eta, setEta] = useState("");
  const r = grams.trim() ? priceByWeight(Number(grams), order.quantity, pricing) : null;
  const p = r?.ok ? r.price : null;
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      void act(`/api/orders/${order.id}/price-by-weight`, { gramsPerUnit: Number(grams), source, etaHours: eta ? Number(eta) : undefined },
        "Kesuni quote added by weight. Run the agent to choose a plan.");
    }}>
      <div className="row">
        <label style={{ flex: "1 1 140px" }}>Grams per unit (slicer)
          <input type="number" step="0.01" min={0.01} value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="16" disabled={busy} required />
        </label>
        <label style={{ flex: "2 1 240px" }}>Where the grams come from
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Bambu Studio, plate 1, 0.2 mm, 15% infill" disabled={busy} required />
        </label>
        <label style={{ flex: "1 1 110px" }}>ETA (hours, optional)
          <input type="number" min={1} value={eta} onChange={(e) => setEta(e.target.value)} placeholder={p ? String(p.etaHours) : "auto"} disabled={busy} />
        </label>
      </div>
      {r && !r.ok && <div className="alert bad">{r.reasons.join("; ")}</div>}
      {p && (
        <dl className="calc-kv">
          <div><dt>Unit price</dt><dd>{rp(p.unitPriceIdr)} <span className="muted">({p.gramsPerUnit} g × {rp(p.pricePerGramIdr)} = {rp(p.gramsPerUnit * p.pricePerGramIdr)}, rounded up)</span></dd></div>
          <div><dt>Total ({p.quantity} units)</dt><dd>{rp(p.totalIdr)}</dd></div>
          <div><dt>Cost</dt><dd>{rp(p.costIdr)}</dd></div>
          <div><dt>Margin</dt><dd>{p.marginPct}%{p.marginPct < minMarginPct && <span className="badge bad"> under the owner&apos;s {minMarginPct}%</span>}</dd></div>
          <div><dt>ETA</dt><dd>{eta ? Number(eta) : p.etaHours} h <span className="muted">(24 h + {Math.round(p.quantity * p.gramsPerUnit * 100) / 100} g on {pricing.printerCount} printers at ~{pricing.gramsPerHour} g/h)</span></dd></div>
          <div><dt>Customer budget</dt><dd>{rp(budgetIdr)}{p.totalIdr > budgetIdr && <span className="badge bad"> over budget</span>}</dd></div>
        </dl>
      )}
      <div className="row">
        <button disabled={busy || !p || !source.trim()}>Use as Kesuni quote</button>
        <button type="button" disabled={busy || !p || !source.trim()}
          onClick={() => void act(`/api/orders/${order.id}/slicer-grams`, { gramsPerUnit: Number(grams), source, by: "operator" },
            "Grams saved. The Chief prices by weight and continues (rules mode: price it here).")}>
          Only give the grams to the Chief
        </button>
      </div>
    </form>
  );
}
