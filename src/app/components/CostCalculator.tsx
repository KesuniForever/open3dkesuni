"use client";

import { useMemo, useState } from "react";
import { KESUNI_DEFAULTS, calculate, type CostInput } from "@/lib/costing";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

type Field = { key: keyof CostInput; label: string; unit: string; step?: string };
const PRODUCTION: Field[] = [
  { key: "quantity", label: "Jumlah barang", unit: "unit" },
  { key: "gramsPerUnit", label: "Bahan per unit", unit: "gram", step: "0.1" },
  { key: "filamentIdrPerKg", label: "Harga filament", unit: "Rp / kg" },
  { key: "machineHours", label: "Waktu mesin", unit: "jam, seluruh pesanan", step: "0.1" },
  { key: "avgWatts", label: "Daya rata-rata", unit: "watt (perkiraan)" },
  { key: "idrPerKwh", label: "Tarif listrik", unit: "Rp / kWh" },
];
const BUSINESS: Field[] = [
  { key: "laborHours", label: "Jam kerja orang", unit: "jam / pesanan", step: "0.1" },
  { key: "laborIdrPerHour", label: "Upah per jam", unit: "Rp / jam" },
  { key: "machineIdrPerHour", label: "Biaya mesin per jam", unit: "Rp (penyusutan + perawatan)" },
  { key: "finishingIdr", label: "Finishing", unit: "Rp / pesanan" },
  { key: "packagingIdr", label: "Kemasan", unit: "Rp / pesanan" },
  { key: "shippingIdr", label: "Pengiriman", unit: "Rp / pesanan" },
  { key: "overheadIdr", label: "Overhead", unit: "Rp (alokasi biaya usaha)" },
  { key: "supportWastePct", label: "Support & limbah", unit: "%" },
  { key: "reprintRiskPct", label: "Risiko cetak ulang", unit: "%" },
  { key: "feePct", label: "Fee pembayaran", unit: "% dari harga" },
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
      {f.label}
      <input type="number" min={0} step={f.step ?? "any"} value={v[f.key]} onChange={set(f.key)}
        disabled={f.key === "quantity" && lockQuantity} />
      <span className="muted calc-unit">{f.unit}</span>
    </label>
  );
  const loss = c.profitIdr < 0;
  const overBudget = budgetIdr !== undefined && c.revenueIdr > budgetIdr;
  const etaDefault = Math.ceil(input.machineHours + input.laborHours + 24);

  return (
    <div className="calc">
      <div className="calc-inputs">
        <fieldset>
          <legend>Biaya produksi</legend>
          <div className="calc-grid">{PRODUCTION.map(field)}</div>
        </fieldset>
        <details>
          <summary>Tenaga kerja, mesin & risiko</summary>
          <div className="calc-grid">{BUSINESS.map(field)}</div>
        </details>
        <button type="button" onClick={() => setV((s) => ({ ...s, filamentIdrPerKg: String(Math.round(Number(s.filamentIdrPerKg) * 0.9)) }))}>
          Uji harga bahan −10%
        </button>
      </div>

      <aside className="calc-result">
        <div className="muted calc-eyebrow">EKONOMI SATU PESANAN</div>
        <div className="calc-price">{rp(c.revenueIdr)}</div>
        <div className="muted">{input.quantity} × {rp(input.unitPriceIdr)} ≈ {(c.revenueIdr / idrPerUsdc).toFixed(2)} USDC</div>
        <div className="calc-grid two">
          <label>Harga per unit
            <input type="number" min={0} value={v.unitPriceIdr} onChange={set("unitPriceIdr")} />
          </label>
          <label>Target margin (%)
            <input type="number" min={0} max={90} value={v.targetMarginPct} onChange={set("targetMarginPct")} />
          </label>
        </div>
        <button type="button" onClick={() => setV((s) => ({ ...s, unitPriceIdr: String(c.targetUnitPriceIdr) }))}>
          Pakai harga target · {rp(c.targetUnitPriceIdr)}
        </button>
        <dl className="calc-kv">
          <div><dt>Biaya usaha + cadangan</dt><dd>{rp(c.businessCostIdr)}</dd></div>
          {c.feeIdr > 0 && <div><dt>Fee ({input.feePct}%)</dt><dd>{rp(c.feeIdr)}</dd></div>}
          <div><dt>Sisa usaha (sebelum pajak)</dt><dd className={loss ? "bad-text" : ""}>{rp(c.profitIdr)}</dd></div>
          <div><dt>Margin dari omzet</dt><dd className={loss ? "bad-text" : ""}>{c.marginPct}%</dd></div>
          <div><dt>Harga impas per unit</dt><dd>{rp(c.breakEvenUnitPriceIdr)}</dd></div>
        </dl>
        {loss && <div className="alert bad">Harga ini rugi. Naikkan harga per unit minimal ke {rp(c.breakEvenUnitPriceIdr)}.</div>}
        {overBudget && <div className="alert bad">Melebihi budget pelanggan ({rp(budgetIdr!)}). Agen akan menolak penawaran ini.</div>}

        <h3 className="calc-h">Rincian yang transparan</h3>
        <dl className="calc-kv">
          {c.lines.map((l) => <div key={l.key}><dt>{l.label}</dt><dd>{rp(l.idr)}</dd></div>)}
        </dl>
        <p className="muted calc-foot">
          {c.filamentGrams} g filament · {c.kwh} kWh (perkiraan Bambu Lab A1, bukan meteran).
          Cadangan = biaya produksi × risiko ÷ (1 − risiko). Belum termasuk pajak.
        </p>

        {onUse && (
          <div className="calc-use">
            <label>Estimasi selesai (jam)
              <input type="number" min={1} value={eta} placeholder={String(etaDefault)} onChange={(e) => setEta(e.target.value)} />
            </label>
            <button className="primary" type="button" disabled={busy || loss || c.revenueIdr <= 0}
              onClick={() => onUse({ ...input, etaHours: Number(eta) || etaDefault })}>
              Jadikan penawaran Kesuni
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
