import Link from "next/link";
import CostCalculator from "../components/CostCalculator";
import { idrPerUsdc } from "@/lib/costing";

export const dynamic = "force-dynamic";

export default function Kalkulator() {
  return (
    <main className="wrap wide">
      <header className="topbar">
        <Link href="/" className="brand">Kesuni 3D</Link>
        <span className="muted">Kalkulator harga</span>
      </header>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Kenali biaya sesungguhnya.</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Hitung biaya satu pesanan, lalu pilih harga yang masuk akal. Untuk dipakai sebagai penawaran, buka pesanannya dan isi kalkulator di sana.
      </p>
      <CostCalculator idrPerUsdc={idrPerUsdc()} />
    </main>
  );
}
