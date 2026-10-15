"use client";

import { useState } from "react";
import { calculate } from "@/lib/costing";
import type { Order } from "@/lib/types";
import { useT } from "@/i18n/client";
import { units } from "./rich";

type Act = (url: string, body: unknown, success: string) => Promise<void>;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const OPEN = ["IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED", "REJECTED", "PAID"];

/** Plan (from the cost calculator and spec) next to what production actually used. Plus the customer's review. */
export default function ActualPanel({ order, busy, act }: { order: Order; busy: boolean; act: Act }) {
  const t = useT();
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
    [t("Filament"), plan ? `${plan.filamentGrams} g` : "—", a ? `${a.filamentGrams} g` : "—"],
    [t("Machine time"), order.costing ? t("{n} h", { n: order.costing.input.machineHours }) : "—", a ? t("{n} h", { n: a.machineHours }) : "—"],
    [t("Business cost"), plan ? rp(plan.businessCostIdr) : "—", a ? rp(a.costIdr) : "—"],
    [t("Max dimension deviation"), order.spec ? `≤ ${order.spec.toleranceMm} mm` : "—", a ? `${a.maxDeviationMm} mm` : "—"],
    [t("Passed QC without rework"), units(t, order.quantity), a ? `${a.unitsPassed} / ${order.quantity}` : "—"],
  ];

  return (
    <section className="card">
      <h2>{t("Plan vs actual")}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t("Parameter")}</th><th>{t("Plan")}</th><th>{t("Reported")}</th></tr></thead>
          <tbody>{rows.map(([k, p, r]) => <tr key={k}><td>{k}</td><td>{p}</td><td>{r}</td></tr>)}</tbody>
        </table>
      </div>
      {a && <p className="muted" style={{ fontSize: 13 }}>{t("Reported by {by} (operator, label manual)", { by: a.by })}{a.note && `: ${a.note}`}. {t("The customer still checks the goods themselves.")}</p>}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void act(`/api/orders/${order.id}/actual`, f, t("Production report saved.")); }}>
        <div className="spec-grid">
          <label>{t("Filament used (g)")}<input type="number" min={0} step="0.1" value={f.filamentGrams} onChange={set("filamentGrams")} disabled={disabled} required /></label>
          <label>{t("Machine hours")}<input type="number" min={0} step="0.1" value={f.machineHours} onChange={set("machineHours")} disabled={disabled} required /></label>
          <label>{t("Actual cost (Rp)")}<input type="number" min={0} value={f.costIdr} onChange={set("costIdr")} disabled={disabled} required /></label>
          <label>{t("Max deviation (mm)")}<input type="number" min={0} step="0.05" value={f.maxDeviationMm} onChange={set("maxDeviationMm")} disabled={disabled} required /></label>
          <label>{t("Units passed")}<input type="number" min={0} max={order.quantity} value={f.unitsPassed} onChange={set("unitsPassed")} disabled={disabled} required /></label>
          <label>{t("Measured by")}<input value={f.by} onChange={set("by")} placeholder="Khelda" disabled={disabled} required /></label>
        </div>
        <label>{t("Note")}<input value={f.note} onChange={set("note")} placeholder={t("e.g. all units measured with calipers")} disabled={disabled} /></label>
        <div><button disabled={disabled}>{a ? t("Update report") : t("Save report")}</button>
          {!OPEN.includes(order.status) && <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>{t("Opens once printing has started.")}</span>}</div>
      </form>

      {order.review && (
        <div className="alert ok">
          <b>{t("Customer review")}</b>{" "}
          {t("by {by}: quality {quality}/5 · communication {communication}/5 · worth the price {value}/5", {
            by: order.review.by, quality: order.review.quality, communication: order.review.communication, value: order.review.value,
          })}{order.review.text && <> · “{order.review.text}”</>}
        </div>
      )}
    </section>
  );
}
