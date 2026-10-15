"use client";

import { useId, useState } from "react";
import { COLOR_MODE_LABEL, priceByWeight, type ColorMode, type PricingConfig } from "@/lib/pricing";
import { printTimeText, rangeText, readyInText } from "@/lib/print-time";
import { useLocale, useT } from "@/i18n/client";
import { tLib } from "@/lib/lib-text";
import ColorModeToggle from "./ColorModeToggle";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Quick official price: grams per unit (from Bambu Studio) × price per gram, rounded up. Same formula as the server. */
export default function WeightCalculator({ pricing }: { pricing: PricingConfig }) {
  const t = useT();
  const locale = useLocale();
  const colourId = useId();
  const [grams, setGrams] = useState("16");
  const [qty, setQty] = useState("1");
  const [mode, setMode] = useState<ColorMode>("single");
  const r = priceByWeight(Number(grams), Number(qty), mode, pricing);
  return (
    <section className="card">
      <h2>{t("Price per gram (official)")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("Selling price {price} per gram, rounded up to {round} per piece.", { price: rp(pricing.pricePerGramIdr), round: rp(pricing.roundIdr) })}{" "}
        {t("Weight per piece comes from the slicer (Bambu Studio).")}
      </p>
      <div className="row fields">
        <label style={{ flex: "1 1 140px" }}>{t("Weight per piece (grams)")}
          <input type="number" step="0.01" min={0.01} value={grams} onChange={(e) => setGrams(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 120px" }}>{t("Quantity")}
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <div style={{ flex: "1 1 220px" }}>
          <span className="field-label" id={colourId}>{t("Colour")}</span>
          <ColorModeToggle value={mode} onChange={setMode} labelledBy={colourId} />
        </div>
      </div>
      {r.ok ? (
        <>
          <dl className="calc-kv">
            <div><dt>{t("Price per piece")}</dt><dd>{rp(r.price.unitPriceIdr)}</dd></div>
            <div>
              <dt>{t(r.price.quantity === 1 ? "Total ({n} piece)" : "Total ({n} pieces)", { n: r.price.quantity })}</dt>
              <dd><b>{rp(r.price.totalIdr)}</b></dd>
            </div>
            <div><dt>{t("Print time")}</dt><dd>{printTimeText(r.price.printMinutes, t, locale)}</dd></div>
            <div><dt>{t("Ready in")}</dt><dd>{readyInText(r.price.etaHours, t, locale)}</dd></div>
          </dl>
          <p className="muted calc-note">
            {t(pricing.printerCount === 1
              ? "{mode}: {range} min of printing per gram. One piece prints at a time. Ready in adds {hours} h to collect, check and pack."
              : "{mode}: {range} min of printing per gram. Up to {printers} pieces print at the same time, one per printer. Ready in adds {hours} h to collect, check and pack.", {
              mode: t(COLOR_MODE_LABEL[mode]), range: rangeText(r.price.minPerGram, locale),
              printers: pricing.printerCount, hours: r.price.handlingHours,
            })}
          </p>
        </>
      ) : (
        <p className="muted">{r.reasons.map((x) => tLib(t, x)).join("; ")}</p>
      )}
    </section>
  );
}
