"use client";

import { useState } from "react";
import { COLOR_MODE_LABEL, COLOR_MODES, priceByWeight, toColorMode, type ColorMode, type PricingConfig } from "@/lib/pricing";
import { printTimeText, rangeText, readyInText } from "@/lib/print-time";
import type { Attachment, Order, Quote } from "@/lib/types";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale, type Locale } from "@/i18n/core";
import { ConfirmDialog } from "@/app/components/PrinterControls";
import { rich, units } from "./rich";
import { tLib } from "@/lib/lib-text";
import { sliceGrams } from "./operator-step";

type Act = (url: string, body: unknown, success: string) => Promise<void>;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const num = (n: number, locale: Locale) => n.toLocaleString(dateLocale(locale), { maximumFractionDigits: 2 });
/** The price's grams and the newest slice's may differ by this much before the page warns. */
const MISMATCH = 0.1;
const BEFORE_QC: Order["status"][] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"];

/**
 * Step 3 · Price. Kesuni's official price: grams per unit from the slicer × price per gram, same formula as the server
 * (pricing.ts). One button makes it from the newest slice (or hands the grams to the Chief); typing the grams by hand and
 * the formula are folded away.
 */
export default function WeightPricePanel({ order, quotes, pricing, budgetIdr, minMarginPct, busy, act, attachments = [], agentMode = "rules", agreed = false, agreementChanged = false, paid = false, real = false }: {
  order: Order; quotes: Quote[]; pricing: PricingConfig; budgetIdr: number; minMarginPct: number; busy: boolean; act: Act;
  /** The order's files: the newest sliced 3MF gives the grams. */
  attachments?: Attachment[];
  /** "claude": the Chief prices with the grams; "rules": a person makes the price here. */
  agentMode?: "claude" | "rules";
  /** The customer approved this exact price and spec. */
  agreed?: boolean;
  /** The customer approved an earlier price or spec. */
  agreementChanged?: boolean;
  /** The customer paid into escrow. */
  paid?: boolean;
  /** A real order (a test order needs no payment). */
  real?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const w = order.gramPricing;
  const quote = w ? quotes.find((q) => q.id === w.quoteId) : undefined;
  const slice = sliceGrams(attachments, order.quantity);
  const created = order.status === "CREATED";
  const chief = !w && order.slicerGrams && agentMode === "claude" ? order.slicerGrams : null;
  const preview = slice ? priceByWeight(slice.gramsPerUnit, order.quantity, slice.colorMode, pricing) : null;
  // Only while it can still change something: before the customer pays and before QC.
  const mismatch = w && slice && slice.gramsPerUnit > 0 && !paid && BEFORE_QC.includes(order.status)
    && Math.abs(w.gramsPerUnit - slice.gramsPerUnit) / slice.gramsPerUnit > MISMATCH;
  // A price within the budget and no plan yet: the agent picks the plan, then the customer sees the price. Over the
  // budget the customer's page offers to raise it instead. Same button and call as in Owner & agent tools.
  const needsPlan = created && Boolean(w) && !order.chosenQuoteId && !(quotes.length > 0 && quotes.every((q) => q.priceMicro > order.mandateMicro));

  return (
    <div className="op-price">
      {w && (
        <>
          <p className="op-price-big">{t("Price: {unit} per piece × {qty} = {total}", { unit: rp(w.unitPriceIdr), qty: w.quantity, total: rp(w.totalIdr) })}</p>
          <p className="muted op-price-sub">{t("{grams} g per piece · priced by {who} · {date}", {
            grams: num(w.gramsPerUnit, locale), who: w.by === "agent" ? t("the Chief") : t("the operator"),
            date: new Date(w.at).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
          })}</p>
          <p className="op-price-status">
            {agreed ? <span className="ok">{t("Customer agreed ✓")}</span>
              : agreementChanged && order.agreement
                ? <span className="wait">{t("The spec or price changed after the customer approved version {version}. They must approve again before paying.", { version: order.agreement.version })}</span>
                : <span className="wait">{t("Waiting for the customer to agree")}</span>}
            {paid ? <span className="ok">{t("Paid ✓")}</span> : real ? <span className="wait">{t("Not paid yet")}</span> : <span className="muted">{t("Test order: no payment needed")}</span>}
          </p>
          {mismatch && slice && (
            <p className="op-warn" role="alert">{t("The price uses {priced} g per piece, but the newest slice weighs {sliced} g per piece. Check which is right before the customer pays.", {
              priced: num(w.gramsPerUnit, locale), sliced: num(slice.gramsPerUnit, locale),
            })}</p>
          )}
          {needsPlan && (
            <div className="row op-plan">
              <button className={agentMode === "rules" ? "primary" : undefined} disabled={busy}
                onClick={() => void act(`/api/orders/${order.id}/agent-plan`, undefined, t("The agent ran. See its decisions below."))}>
                {busy ? t("Agent is working…") : t("Run agent")}
              </button>
            </div>
          )}
        </>
      )}

      {chief && <p className="op-from">{t("The Chief is pricing it with {grams} g per piece from the slice.", { grams: num(chief.gramsPerUnit, locale) })}</p>}

      {created && !w && !chief && (slice ? (
        <div>
          <p className="op-from">{t("From the slice: {grams} g per piece ({file})", { grams: num(slice.gramsPerUnit, locale), file: slice.file })}</p>
          {agentMode === "claude" ? (
            <button className="primary" disabled={busy} onClick={() => setAsking(true)}>{t("Send {grams} g to the Chief", { grams: num(slice.gramsPerUnit, locale) })}</button>
          ) : preview && !preview.ok ? (
            <div className="alert bad">{preview.reasons.map((x) => tLib(t, x)).join("; ")}</div>
          ) : (
            <button className="primary" disabled={busy || !preview?.ok}
              onClick={() => void act(`/api/orders/${order.id}/price-by-weight`, { gramsPerUnit: slice.gramsPerUnit, source: slice.source, colorMode: slice.colorMode },
                t("Kesuni quote added by weight. Run the agent to choose a plan."))}>
              {t("Make the price: {total}", { total: preview?.ok ? rp(preview.price.totalIdr) : "?" })}
            </button>
          )}
        </div>
      ) : (
        <p className="muted op-from">{t("Slice the model first (step 2) to get its weight.")}</p>
      ))}

      {created && (
        <details className="fold">
          <summary>{t("Type the grams by hand")}</summary>
          <WeightForm key={`${w?.at ?? "none"}:${slice?.source ?? ""}`} order={order} pricing={pricing} budgetIdr={budgetIdr} minMarginPct={minMarginPct} busy={busy} act={act}
            initialGrams={w ? String(w.gramsPerUnit) : slice ? String(slice.gramsPerUnit) : ""} initialSource={w?.source ?? slice?.source ?? ""}
            initialColor={toColorMode(w ? w.colorMode : order.slicerGrams?.colorMode ?? slice?.colorMode)} />
        </details>
      )}
      {!created && !w && <p className="muted">{t("Quotes are closed once a plan is chosen.")}</p>}

      <details className="fold">
        <summary>{t("Price details")}</summary>
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
      </details>

      {slice && (
        <ConfirmDialog open={asking} title={t("Give the grams to the Chief?")} confirmLabel={t("Give the grams")} busy={busy}
          onConfirm={(by) => {
            setAsking(false);
            void act(`/api/orders/${order.id}/slicer-grams`, { gramsPerUnit: slice.gramsPerUnit, source: slice.source, by, colorMode: slice.colorMode },
              t("Grams saved. The Chief prices by weight and continues (rules mode: price it here)."));
          }} onClose={() => setAsking(false)}>
          <p style={{ margin: 0 }}>{t("{grams} g per unit, {mode}, from {file}. The Chief prices by weight with these grams.", {
            grams: slice.gramsPerUnit, mode: t(COLOR_MODE_LABEL[slice.colorMode]).toLowerCase(), file: slice.file,
          })}</p>
        </ConfirmDialog>
      )}
    </div>
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
  const off = busy || !p || !source.trim();
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      void act(`/api/orders/${order.id}/price-by-weight`, { gramsPerUnit: Number(grams), source, colorMode, etaHours: eta ? Number(eta) : undefined },
        t("Kesuni quote added by weight. Run the agent to choose a plan."));
    }}>
      {/* Two rows (what is printed, then where the grams come from), so the source has room. */}
      <div className="row fields">
        <label style={{ flex: "1 1 140px" }}>{t("Grams per unit (slicer)")}
          <input type="number" step="0.01" min={0.01} value={grams} onChange={(e) => setGrams(e.target.value)} disabled={busy} required />
        </label>
        <label style={{ flex: "1 1 140px" }}>{t("Colour")}
          <select value={colorMode} onChange={(e) => setColorMode(toColorMode(e.target.value))} disabled={busy}>
            {COLOR_MODES.map((m) => <option key={m} value={m}>{t(COLOR_MODE_LABEL[m])}</option>)}
          </select>
        </label>
      </div>
      <div className="row fields">
        <label style={{ flex: "3 1 260px" }}>{t("Where the grams come from")}
          <input value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} required />
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
        <button disabled={off}>{t("Make the price myself")}</button>
        <button type="button" disabled={off}
          onClick={() => void act(`/api/orders/${order.id}/slicer-grams`, { gramsPerUnit: Number(grams), source, by: "operator", colorMode },
            t("Grams saved. The Chief prices by weight and continues (rules mode: price it here)."))}>
          {t("Send the grams to the Chief")}
        </button>
      </div>
      {!busy && (!grams.trim() || !source.trim()) && <p className="muted op-reason">{t("Fill in the grams and where they come from.")}</p>}
    </form>
  );
}
