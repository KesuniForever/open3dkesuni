"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { CustTop } from "@/app/c/CustTop";
import ColorPicker, { NO_CHOICE, keepOffered, swatchesFor, useStudioColors, type Choice } from "@/app/c/ColorPicker";
import DesignPicker, { DesignInfo } from "@/app/c/DesignPicker";
import { WhatsAppButton } from "@/app/c/whatsapp";
import { tLib } from "@/lib/lib-text";
import { rememberOrder } from "@/app/c/my-orders";
import { budgetApprox, idrBudget } from "@/lib/budget";
import { parseIdrTyped } from "@/lib/budget-input";
import { MATERIALS } from "@/lib/pricing";
import { MAX_COLOR_CHOICES } from "@/lib/colors";

const BUDGET_UNCLEAR = "Type the budget in rupiah, like 150.000 or 150rb";
const PAST_DATE = "Pick a date from today on.";
const EMPTY = { name: "", product: "", quantity: "1", deadline: "", budgetIdr: "", note: "" };
type Fields = typeof EMPTY;
// What the customer typed and picked survives a switch to another tab of the portal (each tab is its own page) until the
// order is sent: this browser tab only (sessionStorage). A file cannot be kept: the draft only remembers there was one,
// so the form asks for it again. Storage can be blocked: the form then just starts empty.
const DRAFT = "kesuni_order_draft";
interface Draft { fields: Partial<Fields>; choice: Choice | null; hadFile: boolean }

/** The draft's material and colours, only in the shape the picker gives (anything else is dropped). */
function readChoice(v: unknown): Choice | null {
  if (!v || typeof v !== "object") return null;
  const { material, colors } = v as Record<string, unknown>;
  const list = Array.isArray(colors) ? colors.slice(0, MAX_COLOR_CHOICES).flatMap((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    const type = MATERIALS.find((m) => m === x.type);
    return type && typeof x.color === "string" ? [{ type, color: x.color.slice(0, 9), name: typeof x.name === "string" ? x.name.slice(0, 40) : undefined }] : [];
  }) : [];
  return { material: MATERIALS.find((x) => x === material) ?? null, colors: list };
}
export function readDraft(raw: string | null): Draft | null {
  try {
    const d: unknown = JSON.parse(raw ?? "null");
    if (!d || typeof d !== "object") return null;
    const rec = d as Record<string, unknown>;
    const fields = Object.fromEntries(Object.keys(EMPTY).filter((k) => typeof rec[k] === "string").map((k) => [k, (rec[k] as string).slice(0, 1000)]));
    return { fields, choice: readChoice(rec.choice), hadFile: rec.hadFile === true };
  } catch {
    return null;
  }
}
function saveDraft(d: { fields: Fields; choice: Choice; hadFile: boolean } | null): void {
  try {
    if (d) window.sessionStorage.setItem(DRAFT, JSON.stringify({ ...d.fields, choice: d.choice, hadFile: d.hadFile }));
    else window.sessionStorage.removeItem(DRAFT);
  } catch {
    /* storage blocked: nothing kept */
  }
}

/**
 * The order form. `embedded`: inside the customer portal, which has the page's header and <main> already. `rate`: the
 * app's rupiah per USDC, for the line under the budget ("Rp150.000 ≈ 9.09 USDC"). `today`: Jakarta's date, the earliest
 * "Needed by" (the server checks it too). `whatsapp`: the studio's number for "Chat Kesuni on WhatsApp" (none: no button).
 * `studioLive`: a printer reports now, so the colours offered are loaded now.
 */
export default function OrderForm({ code, embedded = false, rate, today, whatsapp = null, studioLive = true }: {
  code: string; embedded?: boolean; rate?: number; today?: string; whatsapp?: string | null; studioLive?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // English texts (from this form or the server); translated when shown. Cleared as soon as the customer changes anything.
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState<Fields>(EMPTY);
  // Material and colours from the spools loaded in the studio right now (optional: Kesuni picks when left empty).
  const palette = useStudioColors();
  const [picked, setPicked] = useState<Choice>(NO_CHOICE);
  // Colours no longer loaded drop out (a restored draft may hold some): they could not be sent.
  const choice = palette ? keepOffered(picked, swatchesFor(palette)) : picked;
  // The customer's own model (optional): weighed by the studio's slicer for the price, so nobody has to ask for it.
  // Its own error line, under the field: a refused file never hides behind the other messages.
  const [design, setDesign] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // The picked file is no readable model (a broken STL): the preview says so and it is not sent.
  const [unreadable, setUnreadable] = useState(false);
  // A restored draft had a file: it has to be chosen again.
  const [fileAgain, setFileAgain] = useState(false);

  const keep = (next: { fields?: Fields; choice?: Choice; hadFile?: boolean }) =>
    saveDraft({ fields: next.fields ?? f, choice: next.choice ?? picked, hadFile: next.hadFile ?? Boolean(design) });
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = { ...f, [k]: e.target.value };
    setF(next);
    setErrors([]);
    keep({ fields: next });
  };
  const pickChoice = (c: Choice) => { setPicked(c); setErrors([]); keep({ choice: c }); };
  const pickDesign = (file: File | null) => {
    setDesign(file);
    setUnreadable(false);
    setErrors([]);
    if (file) setFileAgain(false);
    keep({ hadFile: Boolean(file) });
  };
  useEffect(() => {
    const restore = setTimeout(() => {
      let d: Draft | null = null;
      try { d = readDraft(window.sessionStorage.getItem(DRAFT)); } catch { /* storage blocked */ }
      if (!d) return;
      const { fields, choice: c, hadFile } = d;
      setF((cur) => ({ ...cur, ...fields }));
      if (c) setPicked(c);
      setFileAgain(hadFile);
    }, 0);
    return () => clearTimeout(restore);
  }, []);

  // The budget as typed ("150rb", "1,5jt", "Rp 150.000"): what it means shows under the field while they type.
  const budget = parseIdrTyped(f.budgetIdr);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (budget === null) return setErrors([BUDGET_UNCLEAR]);
    if (today && f.deadline && f.deadline < today) return setErrors([PAST_DATE]);
    setBusy(true);
    setErrors([]);
    setFileError(null);
    try {
      const fields = {
        ...f, invite: code, quantity: Number(f.quantity), budgetIdr: budget,
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
          pickDesign(null);
          return;
        }
        return setErrors(data.reasons ?? [data.error]);
      }
      rememberOrder(data.link, f.product);
      saveDraft(null);
      // The order page shows "Order sent!" once, then takes ?new=1 off its address.
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
            <input type="date" value={f.deadline} onChange={set("deadline")} min={today} required />
          </label>
        </div>
        <label>{t("Maximum budget (Rupiah)")}
          <input value={f.budgetIdr} onChange={set("budgetIdr")} placeholder={t("For example: 150.000 or 150rb")} required maxLength={30} />
          {f.budgetIdr.trim() !== "" && (
            <span className={`budget-live${budget === null ? " bad" : ""}`} aria-live="polite">
              {budget === null ? t(BUDGET_UNCLEAR) : rate ? budgetApprox(idrBudget(budget, rate), locale) : `Rp${budget.toLocaleString("id-ID")}`}
            </span>
          )}
          <span className="budget-live">{t("This is the most you want to pay; the price may be lower.")}</span>
        </label>
        <fieldset className="cust-fieldset">
          <legend>{t("Material and colour")}</legend>
          <ColorPicker value={choice} onChange={pickChoice} palette={palette} disabled={busy} live={studioLive} />
        </fieldset>
        <fieldset className="cust-fieldset">
          <legend>{t("3D file (optional)")} <DesignInfo /></legend>
          <p className="cust-note" style={{ marginBottom: 8 }}>{t("No 3D file? Skip this and describe the item in the notes.")}</p>
          {fileAgain && !design && <p className="cust-open" role="status" style={{ margin: "0 0 8px" }}>{t("Please choose your 3D file again.")}</p>}
          <DesignPicker file={design} onFile={pickDesign} error={fileError} onError={setFileError} label={t("3D file (optional)")}
            disabled={busy} color={choice.colors[0]?.color ?? null} onUnreadable={setUnreadable} />
        </fieldset>
        <label>{t("Anything else? (size, use, ideas)")}
          <textarea value={f.note} onChange={set("note")} rows={3} maxLength={1000} placeholder={t("Optional")} />
        </label>
        <p className="cust-note">{t("Do not write your address or phone number here. Kesuni asks for them directly on WhatsApp.")}</p>
        {errors.length > 0 && <div className="alert bad"><ul>{errors.map((m) => <li key={m}>{m && tLib(t, m)}</li>)}</ul></div>}
        <button className="primary cust-cta" disabled={busy || unreadable}>{busy ? t(design ? "Sending your design…" : "Sending…") : t("Send order")}</button>
      </form>
      {whatsapp && (
        <div className="cust-actions">
          <WhatsAppButton number={whatsapp} label={t("Chat Kesuni on WhatsApp")} />
        </div>
      )}
    </section>
  );
  if (embedded) return form;
  return (
    <main className="cust" lang={locale}>
      <CustTop home="/customer">{t("Order a 3D print")}</CustTop>
      {form}
    </main>
  );
}
