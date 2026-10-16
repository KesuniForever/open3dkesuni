"use client";

import { useState } from "react";
import { COLOR_MODE_LABEL, COLOR_MODES, priceByWeight, toColorMode, type ColorMode, type PricingConfig } from "@/lib/pricing";
import { printTimeText, rangeText, readyInText } from "@/lib/print-time";
import type { Order, Quote } from "@/lib/types";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale } from "@/i18n/core";
import { rich, units } from "./rich";
import { tLib } from "@/lib/lib-text";

type Act = (url: string, body: unknown, success: string) => Promise<void>;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Kesuni's official price: grams per unit from the slicer × price per gram. Same formula as the server (pricing.ts). */
export default function WeightPricePanel({ order, quotes, pricing, budgetIdr, minMarginPct, busy, act }: {
  order: Order; quotes: Quote[]; pricing: PricingConfig; budgetIdr: number; minMarginPct: number; busy: boolean; act: Act;
}) {
  const t = useT();
  const locale = useLocale();
  const w = order.gramPricing;
  const quote = w ? quotes.find((q) => q.id === w.quoteId) : undefined;
  return (
    <section className="card">
      <h2>{t("Price by weight (official)")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("{price} per gram, cost {cost} per gram (filament, finishing, print hours, power).", { price: rp(pricing.pricePerGramIdr), cost: rp(pricing.costPerGramIdr) })}{" "}
        {t("Unit price rounded up to {round}. Grams per unit come from the slicer (Bambu Studio). The long calculator below is only a check.", { round: rp(pricing.roundIdr) })}
      </p>
      {w && (
        <div className="alert ok">
          {rich(t("{label}: {grams} g × {ppg} → {unit} per unit × {qty} = {total} · cost {cost} · margin {margin}%"), {
            label: quote ? rich(t("Kesuni quote {quote}"), { quote: <code>{quote.id}</code> }) : t("Earlier by-weight price"),
            grams: w.gramsPerUnit, ppg: rp(w.pricePerGramIdr), unit: <b>{rp(w.unitPriceIdr)}</b>, qty: w.quantity, total: <b>{rp(w.totalIdr)}</b>,
            cost: rp(w.costIdr), margin: w.totalIdr > 0 ? Math.round(((w.totalIdr - w.costIdr) / w.totalIdr) * 1000) / 10 : 0,
          })}
          {" · "}{t(COLOR_MODE_LABEL[toColorMode(w.colorMode)])}
          {quote && <> · {t("ETA {n} h", { n: quote.etaHours })}</>}
          <div className="muted" style={{ fontSize: 13 }}>
            {t("Grams from: {source} · priced by {who} · {date}", {
              source: w.source, who: w.by === "agent" ? t("the Chief") : t("a person"),
              date: new Date(w.at).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta" }),
            })}
          </div>
        </div>
      )}
      {order.slicerGrams && (
        <p className="muted" style={{ fontSize: 13 }}>
          {order.slicerGrams.by === "slicer" && <><span className="badge ok">{t("Automatic slice")}</span>{" "}</>}
          {rich(t("Grams for the Chief: {grams} per unit, {mode} ({source}), entered by {by}."), {
            grams: <b>{order.slicerGrams.gramsPerUnit} g</b>, mode: t(COLOR_MODE_LABEL[toColorMode(order.slicerGrams.colorMode)]).toLowerCase(),
            source: order.slicerGrams.source, by: order.slicerGrams.by,
          })}{" "}
          {t("The Chief prices only with these grams, never with numbers from the customer's note.")}
        </p>
      )}
      {order.status === "CREATED" ? (
        <WeightForm key={w?.at ?? "none"} order={order} pricing={pricing} budgetIdr={budgetIdr} minMarginPct={minMarginPct} busy={busy} act={act}
          initialGrams={w ? String(w.gramsPerUnit) : ""} initialSource={w?.source ?? ""}
          initialColor={toColorMode(w ? w.colorMode : order.slicerGrams?.colorMode)} />
      ) : !w && <p className="muted">{t("Quotes are closed once a plan is chosen.")}</p>}
    </section>
  );
}

function WeightForm({ order, pricing, budgetIdr, minMarginPct, busy, act, initialGrams, initialSource, initialColor }: {
  order: Order; pricing: PricingConfig; budgetIdr: number; minMarginPct: number; busy: boolean; act: Act;
  initialGrams: string; initialSource: string; initialColor: ColorMode;
}) {
  const t = useT();
  const locale = useLocale();
  const [grams, setGrams] = useState(initialGrams);
  const [colorMode, setColorMode] = useState<ColorMode>(initialColor);
  const [source, setSource] = useState(initialSource);
  const [eta, setEta] = useState("");
  const r = grams.trim() ? priceByWeight(Number(grams), order.quantity, colorMode, pricing) : null;
  const p = r?.ok ? r.price : null;
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      void act(`/api/orders/${order.id}/price-by-weight`, { gramsPerUnit: Number(grams), source, colorMode, etaHours: eta ? Number(eta) : undefined },
        t("Kesuni quote added by weight. Run the agent to choose a plan."));
    }}>
      {/* Two rows (what is printed, then where the grams come from), so the source has room for its placeholder. */}
      <div className="row fields">
        <label style={{ flex: "1 1 140px" }}>{t("Grams per unit (slicer)")}
          <input type="number" step="0.01" min={0.01} value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="16" disabled={busy} required />
        </label>
        <label style={{ flex: "1 1 140px" }}>{t("Colour")}
          <select value={colorMode} onChange={(e) => setColorMode(toColorMode(e.target.value))} disabled={busy}>
            {COLOR_MODES.map((m) => <option key={m} value={m}>{t(COLOR_MODE_LABEL[m])}</option>)}
          </select>
        </label>
      </div>
      <div className="row fields">
        <label style={{ flex: "3 1 260px" }}>{t("Where the grams come from")}
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder={t("Bambu Studio, plate 1, 0.2 mm, 15% infill")} disabled={busy} required />
        </label>
        <label style={{ flex: "1 1 120px" }}>{t("ETA (hours, optional)")}
          <input type="number" min={1} value={eta} onChange={(e) => setEta(e.target.value)} placeholder={p ? String(p.etaHours) : t("auto")} disabled={busy} />
        </label>
      </div>
      {r && !r.ok && <div className="alert bad">{r.reasons.map((x) => tLib(t, x)).join("; ")}</div>}
      {p && (
        <dl className="calc-kv">
          <div><dt>{t("Unit price")}</dt><dd>{rp(p.unitPriceIdr)} <span className="muted">{t("({grams} g × {ppg} = {sum}, rounded up)", {
            grams: p.gramsPerUnit, ppg: rp(p.pricePerGramIdr), sum: rp(p.gramsPerUnit * p.pricePerGramIdr),
          })}</span></dd></div>
          <div><dt>{t("Total ({units})", { units: units(t, p.quantity) })}</dt><dd>{rp(p.totalIdr)}</dd></div>
          <div><dt>{t("Cost")}</dt><dd>{rp(p.costIdr)}</dd></div>
          <div><dt>{t("Margin")}</dt><dd>{p.marginPct}%{p.marginPct < minMarginPct && <span className="badge bad"> {t("under the owner's {pct}%", { pct: minMarginPct })}</span>}</dd></div>
          <div><dt>{t("Print time")}</dt><dd>{printTimeText(p.printMinutes, t, locale)} <span className="muted">{t(pricing.printerCount === 1
            ? "({grams} g × {range} min/g, {rounds} on {printers} printer)"
            : "({grams} g × {range} min/g, {rounds} on {printers} printers)", {
            grams: p.gramsPerUnit, range: rangeText(p.minPerGram, locale),
            rounds: t(p.batches === 1 ? "{n} round" : "{n} rounds", { n: p.batches }), printers: pricing.printerCount,
          })}</span></dd></div>
          <div><dt>{t("Ready in")}</dt><dd>{eta
            ? <>{t("{n} h", { n: Number(eta) })} <span className="muted">{t("(entered)")}</span></>
            : <>{readyInText(p.etaHours, t, locale)} <span className="muted">{t("(print time + {hours} h to collect, check and pack)", { hours: p.handlingHours })}</span></>}
          </dd></div>
          <div><dt>{t("Customer budget")}</dt><dd>{rp(budgetIdr)}{p.totalIdr > budgetIdr && <span className="badge bad"> {t("over budget")}</span>}</dd></div>
        </dl>
      )}
      <div className="row">
        <button disabled={busy || !p || !source.trim()}>{t("Use as Kesuni quote")}</button>
        <button type="button" disabled={busy || !p || !source.trim()}
          onClick={() => void act(`/api/orders/${order.id}/slicer-grams`, { gramsPerUnit: Number(grams), source, by: "operator", colorMode },
            t("Grams saved. The Chief prices by weight and continues (rules mode: price it here)."))}>
          {t("Only give the grams to the Chief")}
        </button>
      </div>
    </form>
  );
}
