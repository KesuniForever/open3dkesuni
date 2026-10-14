import CostCalculator from "../components/CostCalculator";
import WeightCalculator from "../components/WeightCalculator";
import { idrPerUsdc } from "@/lib/costing";
import { pricingConfig } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default function Kalkulator() {
  return (
    <main className="wrap wide" lang="id">
      <header className="page-head">
        <div>
          <p className="eyebrow">Kalkulator harga</p>
          <h1>Harga resmi per gram.</h1>
          <p className="page-sub">Berat per buah dari slicer (Bambu Studio) × harga per gram. Di bawahnya: cek apakah harga itu masih menutup biaya.</p>
        </div>
      </header>
      <WeightCalculator pricing={pricingConfig()} />
      <div className="section-head">
        <p className="eyebrow">Cek biaya</p>
        <h2>Cek: kenali biaya sesungguhnya.</h2>
        <p className="page-sub">
          Kalkulator panjang ini hanya untuk mengecek apakah harga per gram masih menutup biaya. Harga resmi tetap per gram (di atas);
          untuk penawaran, buka pesanannya dan isi berat per buah di sana.
        </p>
      </div>
      <CostCalculator idrPerUsdc={idrPerUsdc()} />
    </main>
  );
}
