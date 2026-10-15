"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { tLib } from "@/lib/lib-text";
import { budgetEquals, budgetFrom, looksLikeThousands, rateText, usdcText, type BudgetCurrency } from "@/lib/budget";
import { MATERIALS } from "@/lib/pricing";
import type { Material } from "@/lib/types";
import Icon from "./Icon";

const CURRENCY_LABEL: Record<BudgetCurrency, string> = { IDR: "Rp", USDC: "USDC" };
const PLACEHOLDER: Record<BudgetCurrency, string> = { IDR: "50.000", USDC: "3.5" };

/** `rate`: the app's rupiah per USDC (idrPerUsdc() on the server), for the live conversion. The server converts again with its own rate. */
export default function NewOrderForm({ rate }: { rate: number }) {
  const router = useRouter();
  const t = useT();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState({
    customerName: "", product: "", quantity: "1", deadline: "", designVersion: "v1", budget: "", label: "real",
  });
  const [currency, setCurrency] = useState<BudgetCurrency>("IDR");
  const [material, setMaterial] = useState<Material>("PLA");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  if (!open) return <button className="primary accent" onClick={() => setOpen(true)}><Icon name="plus" size={16} />{t("New order")}</button>;

  const typed = f.budget.trim() ? budgetFrom(f.budget, currency, rate) : null;
  // Switching the currency carries the amount over, so "50.000" rupiah never turns into 50 USDC.
  const switchTo = (c: BudgetCurrency) => {
    if (c === currency) return;
    const b = typed?.ok ? typed.budget : null;
    setF({ ...f, budget: !b ? "" : c === "USDC" ? usdcText(b.mandateMicro) : b.budgetIdr.toLocaleString("id-ID") });
    setCurrency(c);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const { budget, ...rest } = f;
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...rest, quantity: Number(f.quantity), material,
          ...(currency === "IDR" ? { budgetIdr: budget } : { budgetUsdc: budget.trim() }),
        }),
      });
      const data = await res.json();
      if (!res.ok) return setErrors(data.reasons ?? [data.error]);
      router.push(`/orders/${data.order.id}`);
    } catch {
      setErrors(["Network error. Is the server running?"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form new-order" onSubmit={submit}>
      <h2>{t("New order")}</h2>
      <label>{t("Customer name (no phone or address)")}
        <input value={f.customerName} onChange={set("customerName")} placeholder={t("e.g. Aini")} maxLength={80} />
      </label>
      <label>{t("Product")}
        <input value={f.product} onChange={set("product")} placeholder={t("e.g. Custom lamp side table, walnut top, 4 printed legs")} required />
      </label>
      <div className="row fields">
        <label style={{ flex: "1 1 100px" }}>{t("Quantity")}
          <input type="number" min={1} value={f.quantity} onChange={set("quantity")} required />
        </label>
        <label style={{ flex: "1 1 160px" }}>{t("Deadline")}
          <input type="date" value={f.deadline} onChange={set("deadline")} required />
        </label>
        <label style={{ flex: "1 1 120px" }}>{t("Design version")}
          <input value={f.designVersion} onChange={set("designVersion")} required />
        </label>
      </div>
      {/* Top-aligned: the conversion lines sit under the budget, next to the material. */}
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: "2 1 250px", minWidth: 0 }}>
          <label className="field-label" htmlFor={`${ids}-budget`}>{t("Budget")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id={`${ids}-budget`} value={f.budget} onChange={set("budget")} inputMode={currency === "IDR" ? "numeric" : "decimal"}
              placeholder={PLACEHOLDER[currency]} required style={{ flex: "1 1 auto", minWidth: 0 }} />
            <Seg options={["IDR", "USDC"] as const} value={currency} onChange={switchTo} label={(c) => CURRENCY_LABEL[c]}
              ariaLabel={t("Currency")} style={{ flex: "0 0 auto" }} />
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5, overflowWrap: "anywhere" }} aria-live="polite">
            {typed?.ok && <div style={{ color: "var(--text)" }}>= {budgetEquals(typed.budget)}</div>}
            {typed?.ok && currency === "USDC" && looksLikeThousands(f.budget) && (
              <div style={{ color: "var(--warn)" }}>{t("In USDC the dot is a decimal point. For rupiah, switch to Rp.")}</div>
            )}
            {typed && !typed.ok && <div style={{ color: "var(--bad)" }}>{tLib(t, typed.reasons[0])}</div>}
            <div>{t("1 USDC = US$1 = {rate} (app rate)", { rate: rateText(rate) })}</div>
          </div>
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <span className="field-label" id={`${ids}-material`}>{t("Material")}</span>
          <Seg options={MATERIALS} value={material} onChange={setMaterial} label={(m) => m} labelledBy={`${ids}-material`} />
        </div>
      </div>
      <label>{t("Is this a real order?")}
        <select value={f.label} onChange={set("label")}>
          <option value="real">{t("Real: a real customer placed it")}</option>
          <option value="simulated">{t("Simulated: test or demo only")}</option>
        </select>
      </label>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        {t("Don't type customer phone numbers or home addresses here yet. Keep personal data out until we decide where it lives.")}
      </p>
      {errors.length > 0 && <div className="alert bad"><ul>{errors.map((m) => <li key={m}>{tLib(t, m)}</li>)}</ul></div>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? t("Saving…") : t("Create order")}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

const NEXT = ["ArrowRight", "ArrowDown"];
const PREV = ["ArrowLeft", "ArrowUp"];

/** A small radio group in the .seg style (like ColorModeToggle): one Tab stop, arrow keys move, a click chooses. */
function Seg<V extends string>({ options, value, onChange, label, labelledBy, ariaLabel, style }: {
  options: readonly V[]; value: V; onChange: (v: V) => void; label: (v: V) => string;
  labelledBy?: string; ariaLabel?: string; style?: React.CSSProperties;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (i: number) => {
    const k = ((i % options.length) + options.length) % options.length;
    onChange(options[k]);
    refs.current[k]?.focus();
  };
  const onKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (NEXT.includes(e.key)) pick(i + 1);
    else if (PREV.includes(e.key)) pick(i - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy} aria-label={ariaLabel} style={style}>
      {options.map((o, i) => (
        <button key={o} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === o}
          tabIndex={value === o ? 0 : -1} onClick={() => onChange(o)} onKeyDown={onKeyDown(i)}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}
