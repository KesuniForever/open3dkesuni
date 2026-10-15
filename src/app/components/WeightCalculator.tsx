"use client";

import { useState } from "react";
import { priceByWeight, type PricingConfig } from "@/lib/pricing";
import { useT } from "@/i18n/client";
import { tLib } from "@/lib/lib-text";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Quick official price: grams per unit (from Bambu Studio) × price per gram, rounded up. Same formula as the server. */
export default function WeightCalculator({ pricing }: { pricing: PricingConfig }) {
  const t = useT();
  const [grams, setGrams] = useState("16");
  const [qty, setQty] = useState("1");
  const r = priceByWeight(Number(grams), Number(qty), pricing);
  return (
    <section className="card">
      <h2>{t("Price per gram (official)")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("Selling price {price} per gram, rounded up to {round} per piece.", { price: rp(pricing.pricePerGramIdr), round: rp(pricing.roundIdr) })}{" "}
        {t("Weight per piece comes from the slicer (Bambu Studio).")}
      </p>
      <div className="row">
        <label style={{ flex: "1 1 140px" }}>{t("Weight per piece (grams)")}
          <input type="number" step="0.01" min={0.01} value={grams} onChange={(e) => setGrams(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 120px" }}>{t("Quantity")}
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
      </div>
      {r.ok ? (
        <dl className="calc-kv">
          <div><dt>{t("Price per piece")}</dt><dd>{rp(r.price.unitPriceIdr)}</dd></div>
          <div>
            <dt>{t(r.price.quantity === 1 ? "Total ({n} piece)" : "Total ({n} pieces)", { n: r.price.quantity })}</dt>
            <dd><b>{rp(r.price.totalIdr)}</b></dd>
          </div>
          <div><dt>{t("Estimated time")}</dt><dd>{t("± {n} hours", { n: r.price.etaHours })}</dd></div>
        </dl>
      ) : (
        <p className="muted">{r.reasons.map((x) => tLib(t, x)).join("; ")}</p>
      )}
    </section>
  );
}
