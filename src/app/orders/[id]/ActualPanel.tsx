"use client";

import { useState } from "react";
import { calculate } from "@/lib/costing";
import type { Order } from "@/lib/types";

type Act = (url: string, body: unknown, success: string) => Promise<void>;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const OPEN = ["IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED", "REJECTED", "PAID"];

/** Plan (from the cost calculator and spec) next to what production actually used. Plus the customer's review. */
export default function ActualPanel({ order, busy, act }: { order: Order; busy: boolean; act: Act }) {
  const plan = order.costing ? calculate(order.costing.input) : null;
  const a = order.actual;
  const [f, setF] = useState({
    filamentGrams: String(a?.filamentGrams ?? plan?.filamentGrams ?? ""),
    machineHours: String(a?.machineHours ?? order.costing?.input.machineHours ?? ""),
    costIdr: String(a?.costIdr ?? plan?.businessCostIdr ?? ""),
    maxDeviationMm: String(a?.maxDeviationMm ?? ""),
    unitsPassed: String(a?.unitsPassed ?? order.quantity),
    note: a?.note ?? "",
    by: a?.by ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const disabled = busy || !OPEN.includes(order.status);
  const rows: [string, string, string][] = [
    ["Filament", plan ? `${plan.filamentGrams} g` : "—", a ? `${a.filamentGrams} g` : "—"],
    ["Machine time", order.costing ? `${order.costing.input.machineHours} h` : "—", a ? `${a.machineHours} h` : "—"],
    ["Business cost", plan ? rp(plan.businessCostIdr) : "—", a ? rp(a.costIdr) : "—"],
    ["Max dimension deviation", order.spec ? `≤ ${order.spec.toleranceMm} mm` : "—", a ? `${a.maxDeviationMm} mm` : "—"],
    ["Passed QC without rework", `${order.quantity} units`, a ? `${a.unitsPassed} / ${order.quantity}` : "—"],
  ];

  return (
    <section className="card">
      <h2>Plan vs actual</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Parameter</th><th>Plan</th><th>Reported</th></tr></thead>
          <tbody>{rows.map(([k, p, r]) => <tr key={k}><td>{k}</td><td>{p}</td><td>{r}</td></tr>)}</tbody>
        </table>
      </div>
      {a && <p className="muted" style={{ fontSize: 13 }}>Reported by {a.by} (operator, label manual){a.note && `: ${a.note}`}. The customer still checks the goods themselves.</p>}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void act(`/api/orders/${order.id}/actual`, f, "Production report saved."); }}>
        <div className="spec-grid">
          <label>Filament used (g)<input type="number" min={0} step="0.1" value={f.filamentGrams} onChange={set("filamentGrams")} disabled={disabled} required /></label>
          <label>Machine hours<input type="number" min={0} step="0.1" value={f.machineHours} onChange={set("machineHours")} disabled={disabled} required /></label>
          <label>Actual cost (Rp)<input type="number" min={0} value={f.costIdr} onChange={set("costIdr")} disabled={disabled} required /></label>
          <label>Max deviation (mm)<input type="number" min={0} step="0.05" value={f.maxDeviationMm} onChange={set("maxDeviationMm")} disabled={disabled} required /></label>
          <label>Units passed<input type="number" min={0} max={order.quantity} value={f.unitsPassed} onChange={set("unitsPassed")} disabled={disabled} required /></label>
          <label>Measured by<input value={f.by} onChange={set("by")} placeholder="Khelda" disabled={disabled} required /></label>
        </div>
        <label>Note<input value={f.note} onChange={set("note")} placeholder="e.g. all units measured with calipers" disabled={disabled} /></label>
        <div><button disabled={disabled}>{a ? "Update report" : "Save report"}</button>
          {!OPEN.includes(order.status) && <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>Opens once printing has started.</span>}</div>
      </form>

      {order.review && (
        <div className="alert ok">
          <b>Customer review</b> by {order.review.by}: quality {order.review.quality}/5 · communication {order.review.communication}/5 ·
          worth the price {order.review.value}/5{order.review.text && <> · “{order.review.text}”</>}
        </div>
      )}
    </section>
  );
}
