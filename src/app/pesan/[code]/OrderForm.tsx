"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/app/components/Icon";

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
      router.push(`${data.link}?new=1`);
    } catch {
      setErrors(["Connection lost. Please try again."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cust" lang="en">
      <header className="cust-top"><span className="brand"><BrandMark size={30} />Open3DKesuni</span><span className="muted">Order a 3D print</span></header>
      <section className="cust-hero">
        <h1>What would you like printed?</h1>
        <p className="muted">Fill in your order. Kesuni prepares the price, then you can pay and follow the print from your order page.</p>
        <form className="form" onSubmit={submit} style={{ marginTop: 16 }}>
          <label>Name
            <input value={f.name} onChange={set("name")} placeholder="Your name or business" required maxLength={80} />
          </label>
          <label>What to print
            <input value={f.product} onChange={set("product")} placeholder="For example: lighter case, black" required maxLength={200} />
          </label>
          <div className="row">
            <label style={{ flex: "1 1 100px" }}>Quantity
              <input type="number" min={1} value={f.quantity} onChange={set("quantity")} required />
            </label>
            <label style={{ flex: "2 1 160px" }}>Needed by
              <input type="date" value={f.deadline} onChange={set("deadline")} required />
            </label>
          </div>
          <label>Maximum budget (Rupiah)
            <input value={f.budgetIdr} onChange={set("budgetIdr")} inputMode="numeric" placeholder="50000" required />
          </label>
          <label>Notes (size, colour, design)
            <textarea value={f.note} onChange={set("note")} rows={3} maxLength={1000} placeholder="Optional" />
          </label>
          <p className="cust-note">Do not write your address or phone number here. Kesuni asks for them directly on WhatsApp.</p>
          {errors.length > 0 && <div className="alert bad"><ul>{errors.map((m) => <li key={m}>{m}</li>)}</ul></div>}
          <button className="primary cust-cta" disabled={busy}>{busy ? "Sending…" : "Send order"}</button>
        </form>
      </section>
    </main>
  );
}
