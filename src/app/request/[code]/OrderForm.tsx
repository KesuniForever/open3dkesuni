"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { CustTop } from "@/app/c/CustTop";
import ColorPicker, { NO_CHOICE, useStudioColors, type Choice } from "@/app/c/ColorPicker";
import { tLib } from "@/lib/lib-text";

export default function OrderForm({ code }: { code: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // English texts (from this form or the server); translated when shown.
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState({ name: "", product: "", quantity: "1", deadline: "", budgetIdr: "", note: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  // Material and colours from the spools loaded in the studio right now (optional: Kesuni picks when left empty).
  const palette = useStudioColors();
  const [choice, setChoice] = useState<Choice>(NO_CHOICE);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/c", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...f, invite: code, quantity: Number(f.quantity), budgetIdr: Number(f.budgetIdr.replace(/\D/g, "")),
          material: choice.material, colors: choice.colors.map(({ type, color }) => ({ type, color })),
        }),
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
    <main className="cust" lang={locale}>
      <CustTop>{t("Order a 3D print")}</CustTop>
      <section className="cust-hero">
        <h1>{t("What would you like printed?")}</h1>
        <p className="muted">{t("Fill in your order. Kesuni prepares the price, then you can pay and follow the print from your order page.")}</p>
        <form className="form" onSubmit={submit} style={{ marginTop: 16 }}>
          <label>{t("Name")}
            <input value={f.name} onChange={set("name")} placeholder={t("Your name or business")} required maxLength={80} />
          </label>
          <label>{t("What to print")}
            <input value={f.product} onChange={set("product")} placeholder={t("For example: lighter case, black")} required maxLength={200} />
          </label>
          <div className="row">
            <label style={{ flex: "1 1 100px" }}>{t("Quantity")}
              <input type="number" min={1} value={f.quantity} onChange={set("quantity")} required />
            </label>
            <label style={{ flex: "2 1 160px" }}>{t("Needed by")}
              <input type="date" value={f.deadline} onChange={set("deadline")} required />
            </label>
          </div>
          <label>{t("Maximum budget (Rupiah)")}
            <input value={f.budgetIdr} onChange={set("budgetIdr")} inputMode="numeric" placeholder="50000" required />
          </label>
          <fieldset className="cust-fieldset">
            <legend>{t("Material and colour")}</legend>
            <ColorPicker value={choice} onChange={setChoice} palette={palette} disabled={busy} />
          </fieldset>
          <label>{t("Notes (size, colour, design)")}
            <textarea value={f.note} onChange={set("note")} rows={3} maxLength={1000} placeholder={t("Optional")} />
          </label>
          <p className="cust-note">{t("Do not write your address or phone number here. Kesuni asks for them directly on WhatsApp.")}</p>
          {errors.length > 0 && <div className="alert bad"><ul>{errors.map((m) => <li key={m}>{m && tLib(t, m)}</li>)}</ul></div>}
          <button className="primary cust-cta" disabled={busy}>{busy ? t("Sending…") : t("Send order")}</button>
        </form>
      </section>
    </main>
  );
}
