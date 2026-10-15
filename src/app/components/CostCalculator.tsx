"use client";

import { useMemo, useState } from "react";
import { KESUNI_DEFAULTS, calculate, type CostInput } from "@/lib/costing";
import { useT } from "@/i18n/client";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

type Field = { key: keyof CostInput; label: string; unit: string; step?: string };
const PRODUCTION: Field[] = [
  { key: "quantity", label: "Quantity", unit: "units" },
  { key: "gramsPerUnit", label: "Material per unit", unit: "grams", step: "0.1" },
  { key: "filamentIdrPerKg", label: "Filament price", unit: "Rp / kg" },
  { key: "machineHours", label: "Machine time", unit: "hours, whole order", step: "0.1" },
  { key: "avgWatts", label: "Average power", unit: "watts (estimate)" },
  { key: "idrPerKwh", label: "Electricity rate", unit: "Rp / kWh" },
];
const BUSINESS: Field[] = [
  { key: "laborHours", label: "Labour hours", unit: "hours / order", step: "0.1" },
  { key: "laborIdrPerHour", label: "Wage per hour", unit: "Rp / hour" },
  { key: "machineIdrPerHour", label: "Machine cost per hour", unit: "Rp (depreciation + upkeep)" },
  { key: "finishingIdr", label: "Finishing", unit: "Rp / order" },
  { key: "packagingIdr", label: "Packaging", unit: "Rp / order" },
  { key: "shippingIdr", label: "Shipping", unit: "Rp / order" },
  { key: "overheadIdr", label: "Overhead", unit: "Rp (share of business costs)" },
  { key: "supportWastePct", label: "Support & waste", unit: "%" },
  { key: "reprintRiskPct", label: "Reprint risk", unit: "%" },
  { key: "feePct", label: "Payment fee", unit: "% of price" },
];

/**
 * The cost and price calculator. Live result as you type. With onUse, a button turns the result
 * into Kesuni's quote for an order (quantity is then fixed to the order's).
 */
export default function CostCalculator({ initial, lockQuantity, budgetIdr, idrPerUsdc, onUse, busy }: {
  initial?: Partial<CostInput>;
  lockQuantity?: boolean;
  budgetIdr?: number;
  idrPerUsdc: number;
  onUse?: (input: CostInput & { etaHours: number }) => void;
  busy?: boolean;
}) {
  const t = useT();
  const [v, setV] = useState<Record<keyof CostInput, string>>(() => {
    const start = { ...KESUNI_DEFAULTS, ...initial };
    return Object.fromEntries(Object.entries(start).map(([k, n]) => [k, String(n)])) as Record<keyof CostInput, string>;
  });
  const [eta, setEta] = useState("");
  const input = useMemo(() => {
    const out = { ...KESUNI_DEFAULTS };
    for (const k of Object.keys(out) as (keyof CostInput)[]) {
      const n = Number(v[k]);
      out[k] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    out.quantity = Math.max(1, Math.round(out.quantity));
    out.reprintRiskPct = Math.min(out.reprintRiskPct, 90);
    out.feePct = Math.min(out.feePct, 50);
    out.targetMarginPct = Math.min(out.targetMarginPct, 95 - out.feePct);
    return out;
  }, [v]);
  const c = calculate(input);
  const set = (k: keyof CostInput) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const field = (f: Field) => (
    <label key={f.key}>
      {t(f.label)}
      <input type="number" min={0} step={f.step ?? "any"} value={v[f.key]} onChange={set(f.key)}
        disabled={f.key === "quantity" && lockQuantity} />
      <span className="muted calc-unit">{t(f.unit)}</span>
    </label>
  );
  const loss = c.profitIdr < 0;
  const overBudget = budgetIdr !== undefined && c.revenueIdr > budgetIdr;
  const etaDefault = Math.ceil(input.machineHours + input.laborHours + 24);

  return (
    <div className="calc">
      <div className="calc-inputs">
        <fieldset>
          <legend>{t("Production costs")}</legend>
          <div className="calc-grid">{PRODUCTION.map(field)}</div>
        </fieldset>
        <details>
          <summary>{t("Labour, machine & risk")}</summary>
          <div className="calc-grid">{BUSINESS.map(field)}</div>
        </details>
        <button type="button" onClick={() => setV((s) => ({ ...s, filamentIdrPerKg: String(Math.round(Number(s.filamentIdrPerKg) * 0.9)) }))}>
          {t("Test material price −10%")}
        </button>
      </div>

      <aside className="calc-result">
        <div className="muted calc-eyebrow">{t("ECONOMICS OF ONE ORDER")}</div>
        <div className="calc-price">{rp(c.revenueIdr)}</div>
        <div className="muted">{input.quantity} × {rp(input.unitPriceIdr)} ≈ {(c.revenueIdr / idrPerUsdc).toFixed(2)} USDC</div>
        <div className="calc-grid two">
          <label>{t("Price per unit")}
            <input type="number" min={0} value={v.unitPriceIdr} onChange={set("unitPriceIdr")} />
          </label>
          <label>{t("Target margin (%)")}
            <input type="number" min={0} max={90} value={v.targetMarginPct} onChange={set("targetMarginPct")} />
          </label>
        </div>
        <button type="button" onClick={() => setV((s) => ({ ...s, unitPriceIdr: String(c.targetUnitPriceIdr) }))}>
          {t("Use target price · {price}", { price: rp(c.targetUnitPriceIdr) })}
        </button>
        <dl className="calc-kv">
          <div><dt>{t("Business cost + reserve")}</dt><dd>{rp(c.businessCostIdr)}</dd></div>
          {c.feeIdr > 0 && <div><dt>{t("Fee ({pct}%)", { pct: input.feePct })}</dt><dd>{rp(c.feeIdr)}</dd></div>}
          <div><dt>{t("Profit (before tax)")}</dt><dd className={loss ? "bad-text" : ""}>{rp(c.profitIdr)}</dd></div>
          <div><dt>{t("Margin on revenue")}</dt><dd className={loss ? "bad-text" : ""}>{c.marginPct}%</dd></div>
          <div><dt>{t("Break-even price per unit")}</dt><dd>{rp(c.breakEvenUnitPriceIdr)}</dd></div>
        </dl>
        {loss && <div className="alert bad">{t("This price loses money. Raise the price per unit to at least {price}.", { price: rp(c.breakEvenUnitPriceIdr) })}</div>}
        {overBudget && <div className="alert bad">{t("Over the customer's budget ({budget}). The agent will refuse this quote.", { budget: rp(budgetIdr!) })}</div>}

        <h3 className="calc-h">{t("Transparent breakdown")}</h3>
        <dl className="calc-kv">
          {c.lines.map((l) => <div key={l.key}><dt>{t(l.label)}</dt><dd>{rp(l.idr)}</dd></div>)}
        </dl>
        <p className="muted calc-foot">
          {t("{grams} g filament · {kwh} kWh (Bambu Lab A1 estimate, not a meter).", { grams: c.filamentGrams, kwh: c.kwh })}{" "}
          {t("Reserve = production cost × risk ÷ (1 − risk). Tax not included.")}
        </p>

        {onUse && (
          <div className="calc-use">
            <label>{t("Estimated time (hours)")}
              <input type="number" min={1} value={eta} placeholder={String(etaDefault)} onChange={(e) => setEta(e.target.value)} />
            </label>
            <button className="primary" type="button" disabled={busy || loss || c.revenueIdr <= 0}
              onClick={() => onUse({ ...input, etaHours: Number(eta) || etaDefault })}>
              {t("Make this Kesuni's quote")}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
