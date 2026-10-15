"use client";

import { useState } from "react";
import CostCalculator from "@/app/components/CostCalculator";
import { calculate } from "@/lib/costing";
import type { Order, Quote, Spec } from "@/lib/types";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale } from "@/i18n/core";
import { rich } from "./rich";

type Act = (url: string, body: unknown, success: string) => Promise<void>;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

const EMPTY_SPEC: Spec = {
  dimensions: "", toleranceMm: 0.3, material: "PLA", color: "", layerMm: 0.2, infillPct: 20, finishing: "Standard",
  promise: "Every unit is checked for size, colour, finish and function before hand-over.",
};

/** Price (cost calculator → Kesuni quote), spec and quality promise, and whether the customer approved them. */
export default function AgreementPanel({ order, quotes, agreementCurrent, idrPerUsdc, busy, act }: {
  order: Order; quotes: Quote[]; agreementCurrent: boolean; idrPerUsdc: number; busy: boolean; act: Act;
}) {
  const t = useT();
  const locale = useLocale();
  const base = `/api/orders/${order.id}`;
  const priced = order.costing ? quotes.find((q) => q.id === order.costing!.quoteId) : undefined;
  const result = order.costing ? calculate(order.costing.input) : null;
  const specLocked = Boolean(order.agreement && agreementCurrent && !["CREATED", "PLAN_CHOSEN"].includes(order.status));

  return (
    <section className="card">
      <h2>{t("Price, spec and agreement")}</h2>

      {order.agreement ? (
        <div className={`alert ${agreementCurrent ? "ok" : "bad"}`}>
          {agreementCurrent
            ? <>{rich(t("Customer {name} approved version {version} on {date}."), {
              name: <b>{order.agreement.by}</b>, version: order.agreement.version,
              date: new Date(order.agreement.at).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta" }),
            })}</>
            : <>{t("The spec or price changed after the customer approved version {version}. They must approve again before paying.", { version: order.agreement.version })}</>}
          <div className="fingerprint">SHA-256 {order.agreement.hash}</div>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          {t("The customer approves price + spec + deadline on their page before paying. The approval is fixed by a SHA-256 fingerprint; any change needs a new approval.")}
        </p>
      )}

      <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>{t("Spec and quality promise")}</h3>
      <SpecForm key={JSON.stringify(order.spec ?? null)} spec={order.spec ?? EMPTY_SPEC} disabled={busy || specLocked}
        onSubmit={(s) => act(`${base}/spec`, s, t("Spec saved. The customer sees it on their page."))} />

      <h3 style={{ fontSize: 15, margin: "20px 0 6px" }}>{t("Cost calculator (a check; the official price is by weight above)")}</h3>
      {result && priced && (
        <div className="alert ok">
          {rich(t("Kesuni quote {quote} comes from this calculation: cost {cost}, price {price}, margin {margin}%."), {
            quote: <code>{priced.id}</code>, cost: rp(result.businessCostIdr), price: rp(result.revenueIdr), margin: result.marginPct,
          })}
        </div>
      )}
      {order.status === "CREATED" ? (
        <CostCalculator
          initial={{ ...(order.costing?.input ?? {}), quantity: order.quantity }}
          lockQuantity
          budgetIdr={Math.round((order.mandateMicro / 1e6) * idrPerUsdc)}
          idrPerUsdc={idrPerUsdc}
          busy={busy}
          onUse={(input) => act(`${base}/costing`, input, t("Kesuni quote added from the calculator. Run the agent to choose a plan."))}
        />
      ) : (
        <p className="muted">{t("Quotes are closed once a plan is chosen.")}</p>
      )}
    </section>
  );
}

function SpecForm({ spec, disabled, onSubmit }: { spec: Spec; disabled: boolean; onSubmit: (s: Spec) => void }) {
  const t = useT();
  const [s, setS] = useState<Spec>(spec);
  const text = (k: keyof Spec) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });
  const num = (k: keyof Spec) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit(s); }}>
      <div className="spec-grid">
        <label>{t("Dimensions")}<input value={s.dimensions} onChange={text("dimensions")} placeholder="60 × 30 × 15 mm" disabled={disabled} /></label>
        <label>{t("Tolerance (± mm)")}<input type="number" step="0.05" min={0} value={s.toleranceMm} onChange={num("toleranceMm")} disabled={disabled} /></label>
        <label>{t("Material")}<input value={s.material} onChange={text("material")} disabled={disabled} /></label>
        <label>{t("Color")}<input value={s.color} onChange={text("color")} placeholder={t("Black")} disabled={disabled} /></label>
        <label>{t("Layer (mm)")}<input type="number" step="0.04" min={0.04} value={s.layerMm} onChange={num("layerMm")} disabled={disabled} /></label>
        <label>{t("Infill (%)")}<input type="number" min={0} max={100} value={s.infillPct} onChange={num("infillPct")} disabled={disabled} /></label>
        <label>{t("Finishing")}<input value={s.finishing} onChange={text("finishing")} disabled={disabled} /></label>
      </div>
      <label>{t("Quality promise (how the result is checked; the customer reads this)")}
        <input value={s.promise} onChange={text("promise")} disabled={disabled} />
      </label>
      <div><button disabled={disabled || !s.dimensions.trim() || !s.promise.trim()}>{t("Save spec")}</button></div>
    </form>
  );
}
