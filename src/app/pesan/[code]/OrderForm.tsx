"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OrderForm({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState({ name: "", product: "", quantity: "1", deadline: "", budgetIdr: "", note: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/c", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, invite: code, quantity: Number(f.quantity), budgetIdr: Number(f.budgetIdr.replace(/\D/g, "")) }),
      });
      const data = await res.json();
      if (!res.ok) return setErrors(data.reasons ?? [data.error]);
      router.push(`${data.link}?baru=1`);
    } catch {
      setErrors(["Koneksi terputus. Coba lagi."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cust">
      <header className="cust-top"><span className="brand">Kesuni 3D</span><span className="muted">Pesan cetak 3D</span></header>
      <section className="cust-hero">
        <h1>Mau cetak apa?</h1>
        <p className="muted">Isi pesananmu. Kesuni menyiapkan harga, lalu kamu bisa membayar dan memantau cetakannya dari halaman pesananmu.</p>
        <form className="form" onSubmit={submit} style={{ marginTop: 16 }}>
          <label>Nama
            <input value={f.name} onChange={set("name")} placeholder="Nama kamu atau usahamu" required maxLength={80} />
          </label>
          <label>Barang yang dipesan
            <input value={f.product} onChange={set("product")} placeholder="Misalnya: casing korek api, warna hitam" required maxLength={200} />
          </label>
          <div className="row">
            <label style={{ flex: "1 1 100px" }}>Jumlah
              <input type="number" min={1} value={f.quantity} onChange={set("quantity")} required />
            </label>
            <label style={{ flex: "2 1 160px" }}>Butuh paling lambat
              <input type="date" value={f.deadline} onChange={set("deadline")} required />
            </label>
          </div>
          <label>Budget maksimal (Rupiah)
            <input value={f.budgetIdr} onChange={set("budgetIdr")} inputMode="numeric" placeholder="50000" required />
          </label>
          <label>Catatan (ukuran, warna, desain)
            <textarea value={f.note} onChange={set("note")} rows={3} maxLength={1000} placeholder="Boleh kosong" />
          </label>
          <p className="cust-note">Jangan tulis alamat atau nomor HP di sini. Kesuni menanyakannya langsung lewat WhatsApp.</p>
          {errors.length > 0 && <div className="alert bad"><ul>{errors.map((m) => <li key={m}>{m}</li>)}</ul></div>}
          <button className="primary cust-cta" disabled={busy}>{busy ? "Mengirim…" : "Kirim pesanan"}</button>
        </form>
      </section>
    </main>
  );
}
