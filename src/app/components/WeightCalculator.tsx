"use client";

import { useState } from "react";
import { priceByWeight, type PricingConfig } from "@/lib/pricing";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Quick official price: grams per unit (from Bambu Studio) × price per gram, rounded up. Same formula as the server. */
export default function WeightCalculator({ pricing }: { pricing: PricingConfig }) {
  const [grams, setGrams] = useState("16");
  const [qty, setQty] = useState("1");
  const r = priceByWeight(Number(grams), Number(qty), pricing);
  return (
    <section className="card">
      <h2>Harga per gram (resmi)</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Harga jual {rp(pricing.pricePerGramIdr)} per gram, dibulatkan ke atas ke {rp(pricing.roundIdr)} per buah.
        Berat per buah diambil dari slicer (Bambu Studio).
      </p>
      <div className="row">
        <label style={{ flex: "1 1 140px" }}>Berat per buah (gram)
          <input type="number" step="0.01" min={0.01} value={grams} onChange={(e) => setGrams(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 120px" }}>Jumlah
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
      </div>
      {r.ok ? (
        <dl className="calc-kv">
          <div><dt>Harga per buah</dt><dd>{rp(r.price.unitPriceIdr)}</dd></div>
          <div><dt>Total ({r.price.quantity} buah)</dt><dd><b>{rp(r.price.totalIdr)}</b></dd></div>
          <div><dt>Perkiraan selesai</dt><dd>± {r.price.etaHours} jam</dd></div>
        </dl>
      ) : (
        <p className="muted">{r.reasons.join("; ")}</p>
      )}
    </section>
  );
}
