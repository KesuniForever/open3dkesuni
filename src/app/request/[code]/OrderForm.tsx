"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { CustTop } from "@/app/c/CustTop";
import ColorPicker, { NO_CHOICE, useStudioColors, type Choice } from "@/app/c/ColorPicker";
import { tLib } from "@/lib/lib-text";
import { customerDesignProblem } from "@/lib/file-rules";
import { rememberOrder } from "@/app/c/my-orders";
import Info from "@/app/components/Info";

const EMPTY = { name: "", product: "", quantity: "1", deadline: "", budgetIdr: "", note: "" };
type Fields = typeof EMPTY;
// What the customer typed survives a switch to another tab of the portal (each tab is its own page) until the order is
// sent: this browser tab only (sessionStorage), never the file. Storage can be blocked: the form then just starts empty.
const DRAFT = "kesuni_order_draft";
function readDraft(): Partial<Fields> | null {
  try {
    const d: unknown = JSON.parse(window.sessionStorage.getItem(DRAFT) ?? "null");
    if (!d || typeof d !== "object") return null;
    const rec = d as Record<string, unknown>;
    return Object.fromEntries(Object.keys(EMPTY).filter((k) => typeof rec[k] === "string").map((k) => [k, (rec[k] as string).slice(0, 1000)]));
  } catch {
    return null;
  }
}
function saveDraft(f: Fields | null): void {
  try {
    if (f) window.sessionStorage.setItem(DRAFT, JSON.stringify(f));
    else window.sessionStorage.removeItem(DRAFT);
  } catch {
    /* storage blocked: nothing kept */
  }
}

/** The order form. `embedded`: inside the customer portal, which has the page's header and <main> already. */
export default function OrderForm({ code, embedded = false }: { code: string; embedded?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // English texts (from this form or the server); translated when shown.
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState<Fields>(EMPTY);
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = { ...f, [k]: e.target.value };
    setF(next);
    saveDraft(next);
  };
  useEffect(() => {
    const restore = setTimeout(() => { const d = readDraft(); if (d) setF((cur) => ({ ...cur, ...d })); }, 0);
    return () => clearTimeout(restore);
  }, []);
  // Material and colours from the spools loaded in the studio right now (optional: Kesuni picks when left empty).
  const palette = useStudioColors();
  const [choice, setChoice] = useState<Choice>(NO_CHOICE);
  // The customer's own model (optional): weighed by the studio's slicer for the price, so nobody has to ask for it.
  // Its own error line, under the field: a refused file never hides behind the other messages.
  const [design, setDesign] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const clearDesign = () => {
    if (fileInput.current) fileInput.current.value = "";
    setDesign(null);
  };
  const pickDesign = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    const problem = file ? customerDesignProblem(file.name, file.size) : null;
    setFileError(problem);
    if (problem) e.target.value = "";
    setDesign(problem ? null : file);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    setFileError(null);
    try {
      const fields = {
        ...f, invite: code, quantity: Number(f.quantity), budgetIdr: Number(f.budgetIdr.replace(/\D/g, "")),
        material: choice.material, colors: choice.colors.map(({ type, color }) => ({ type, color })),
      };
      // With a design: one multipart request, so the order, the file and its weighing start together. The code also
      // goes in a header: the server checks it before it reads the file.
      let body: BodyInit = JSON.stringify(fields);
      if (design) {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        form.set("design", design);
        body = form;
      }
      const headers: Record<string, string> = design ? { "x-invite": encodeURIComponent(code) } : { "content-type": "application/json" };
      const res = await fetch("/api/c", { method: "POST", headers, body });
      const data = await res.json();
      if (!res.ok) {
        // The file was refused: say so under the field and take it off, so the next Send goes without it.
        if (design && (res.status === 413 || data.error === "Your design cannot be used")) {
          setFileError(data.reasons?.[0] ?? data.error);
          clearDesign();
          return;
        }
        return setErrors(data.reasons ?? [data.error]);
      }
      rememberOrder(data.link, f.product);
      saveDraft(null);
      router.push(`${data.link}?new=1`);
    } catch {
      setErrors(["Connection lost. Please try again."]);
    } finally {
      setBusy(false);
    }
  }

  const form = (
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
        <fieldset className="cust-fieldset">
          <legend>{t("Your design (one piece)")} <Info>{t("Optional. One file is one piece: the price is multiplied by the quantity. STL or OBJ, up to 25 MB. Kesuni weighs it to set the price. For a 3MF or several colours, send the file on WhatsApp.")}</Info></legend>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {/* No accept filter: phones grey out model files they have no app for. Name and size are checked here, the content on the server. */}
            <input ref={fileInput} type="file" onChange={pickDesign} disabled={busy} aria-label={t("Your design (one piece)")} style={{ maxWidth: "100%", minWidth: 0 }} />
            {design && (
              <button type="button" className="quiet" onClick={() => { clearDesign(); setFileError(null); }} disabled={busy}>{t("Remove file")}</button>
            )}
          </div>
          {fileError && <p className="alert bad" role="status" style={{ margin: "10px 0 0" }}>{tLib(t, fileError)}</p>}
        </fieldset>
        <label>{t("Notes (size, colour, design)")}
          <textarea value={f.note} onChange={set("note")} rows={3} maxLength={1000} placeholder={t("Optional")} />
        </label>
        <p className="cust-note">{t("Do not write your address or phone number here. Kesuni asks for them directly on WhatsApp.")}</p>
        {errors.length > 0 && <div className="alert bad"><ul>{errors.map((m) => <li key={m}>{m && tLib(t, m)}</li>)}</ul></div>}
        <button className="primary cust-cta" disabled={busy}>{busy ? t(design ? "Sending your design…" : "Sending…") : t("Send order")}</button>
      </form>
    </section>
  );
  if (embedded) return form;
  return (
    <main className="cust" lang={locale}>
      <CustTop>{t("Order a 3D print")}</CustTop>
      {form}
    </main>
  );
}
