"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewOrderForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState({
    product: "", quantity: "1", deadline: "", designVersion: "v1", budgetUsdc: "", label: "real",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  if (!open) return <button className="primary" onClick={() => setOpen(true)}>+ New order</button>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, quantity: Number(f.quantity) }),
      });
      const data = await res.json();
      if (!res.ok) return setErrors(data.reasons ?? [data.error]);
      router.push(`/orders/${data.order.id}`);
    } catch {
      setErrors(["Network error. Is the server running?"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>New order</h2>
      <label>Product
        <input value={f.product} onChange={set("product")} placeholder="e.g. Custom lamp side table, walnut top, 4 printed legs" required />
      </label>
      <div className="row">
        <label style={{ flex: "1 1 100px" }}>Quantity
          <input type="number" min={1} value={f.quantity} onChange={set("quantity")} required />
        </label>
        <label style={{ flex: "1 1 160px" }}>Deadline
          <input type="date" value={f.deadline} onChange={set("deadline")} required />
        </label>
        <label style={{ flex: "1 1 120px" }}>Design version
          <input value={f.designVersion} onChange={set("designVersion")} required />
        </label>
        <label style={{ flex: "1 1 140px" }}>Budget (USDC)
          <input value={f.budgetUsdc} onChange={set("budgetUsdc")} inputMode="decimal" placeholder="32" required />
        </label>
      </div>
      <label>Is this a real order?
        <select value={f.label} onChange={set("label")}>
          <option value="real">Real: a real customer placed it</option>
          <option value="simulated">Simulated: test or demo only</option>
        </select>
      </label>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Don&apos;t type customer phone numbers or home addresses here yet. Keep personal data out until we decide where it lives.
      </p>
      {errors.length > 0 && <div className="alert bad"><ul>{errors.map((m) => <li key={m}>{m}</li>)}</ul></div>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Create order"}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
