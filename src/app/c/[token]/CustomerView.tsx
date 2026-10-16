"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CustomerView as View } from "@/lib/customer";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import { useLocale, useT } from "@/i18n/client";
import { usdcApprox } from "@/lib/budget";
import { CustTop, bold } from "../CustTop";
import ColorPicker, { ChoiceSummary, keepOffered, swatchesFor, useStudioColors, type Choice } from "../ColorPicker";
import ModelPreview from "../ModelPreview";
import DesignPicker, { DesignInfo } from "../DesignPicker";
import { WhatsAppButton, waShareLink } from "../whatsapp";
import Info from "@/app/components/Info";
import { tLib } from "@/lib/lib-text";
import { finishingText } from "@/lib/spec-choices";
import { duration } from "@/lib/machines";
import { rememberIfNew } from "../my-orders";

// English text is the key; useT() gives the Indonesian when the visitor chose ID.
const STEPS = ["Order received", "Price and payment", "Printing", "You check the item", "Done"];
// Only in the technical payment proof (the folded card): the words escrow and wallet stay there.
const TX_TEXT: Record<string, string> = {
  customer_topup: "Test USDC sent to your wallet",
  deposit: "You paid into escrow",
  release: "Escrow released to Kesuni",
  refund: "Escrow refunded to you",
};
/** The customer portal (src/proxy.ts shows /request/<invite code> at this address): "My orders" and "New order". */
const PORTAL = "/customer";

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
/** Real USDC to pay, all its decimals in the visitor's own way of writing them ("3.454545", "3,454545"). */
const usdcExact = (usdc: string, locale: Locale) => Number(usdc).toLocaleString(dateLocale(locale), { maximumFractionDigits: 6 });
const whenIn = (locale: Locale) => (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** "2026-10-30" -> "30 Oct 2026" ("30 Okt 2026"); anything else as it is. */
export const dayText = (date: string, locale: Locale): string => /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? new Date(`${date}T12:00:00+07:00`).toLocaleDateString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" })
  : date;
const done = (state: string) => state === "COMPLETE";
const broken = (state: string) => ["FAILED", "DENIED", "CANCELLED"].includes(state);
const PRINTING = ["RUNNING", "PREPARE", "SLICING"];
const CLOSED = ["ACCEPTED", "PAID", "REJECTED"];
/** The order page's own address, without "?new=1": what the customer keeps and sends. */
const orderUrl = (token: string) => `${window.location.origin}/c/${token}`;

type Status = Pick<View, "order" | "escrow" | "paying" | "printing" | "printedOn">;
const funded = (v: Pick<View, "escrow">) => Boolean(v.escrow && v.escrow.state !== "AWAITING_DEPOSIT");
/** Production may start before the payment (a person can print an unpaid order): the payment stays open past "Price". */
const paymentOpen = (v: Status) => !funded(v) && v.order.status !== "CREATED" && !CLOSED.includes(v.order.status);
/** Every transfer of the payment failed and none is under way (the server tells the team): tap the button again. */
const paymentFailed = (v: Status) =>
  !v.paying && v.escrow?.state === "AWAITING_DEPOSIT" && v.escrow.txs.length > 0 && v.escrow.txs.every((x) => broken(x.state));

/**
 * The step the order is at (0-4), from its status first: an order printed before it was paid is at "Printing" or later.
 * Printed but not yet through Kesuni's quality check is still "Printing": "You check the item" starts at the hand-over.
 */
export function stepOf(v: Status): number {
  const s = v.order.status;
  if (CLOSED.includes(s)) return 4;
  if (s === "EVIDENCE_SUBMITTED") return 3;
  if (s === "IN_PRODUCTION" || v.printedOn || (s === "PLAN_CHOSEN" && funded(v))) return 2;
  return 1; // CREATED: received ✓, the price comes next; PLAN_CHOSEN unpaid: price and payment
}

/**
 * Every transfer of the payment failed. On testnet the button reads "Agree to …" (the rupiah go to Kesuni on WhatsApp,
 * the app only runs a test escrow), so the page never asks to tap "Pay" there.
 */
const failedText = (testnet: boolean, t: T) => testnet
  ? { title: t("It did not go through"), sub: t("Tap the button again, or wait: Kesuni has been told.") }
  : { title: t("The payment did not go through"), sub: t("Tap Pay again, or wait: Kesuni has been told.") };

/** The steps as the list shows them: ✓ done, the step now, "!" for a payment still open, ✕ for a rejected order. */
export function stepsOf(v: Status): { label: string; state: "done" | "now" | "open" | "bad" | ""; dot: string }[] {
  const step = stepOf(v);
  const open = paymentOpen(v);
  return STEPS.map((label, i) => {
    if (i === 4 && v.order.status === "REJECTED") return { label: "Rejected, money back", state: "bad", dot: "✕" };
    if (i === 1 && open && step > 1) return { label, state: "open", dot: "!" };
    if (i < step || (i === 4 && step === 4)) return { label, state: "done", dot: "✓" };
    return { label, state: i === step ? "now" : "", dot: String(i + 1) };
  });
}

/**
 * The big title and the line under it (an empty line is left out). The order's status first, then the payment. On
 * testnet the customer pays Kesuni in rupiah on WhatsApp: the page never says the app holds or received their money.
 */
export function headline(v: Status & Partial<Pick<View, "overBudget" | "budgetRaised" | "updates" | "network" | "pieces">>, t: T): { title: string; sub: string } {
  const s = v.order.status;
  const testnet = v.network?.isTestnet === true;
  const txs = v.escrow?.txs ?? [];
  const moving = (kind: string) => txs.some((x) => x.kind === kind && !broken(x.state));
  // Testnet: what the app releases or refunds is its test escrow, not the rupiah paid to Kesuni (the proof card shows it).
  if (s === "PAID") return { title: t("Done. Thank you!"), sub: testnet ? t("Your order is complete.") : t("Your payment has been released to Kesuni.") };
  if (s === "ACCEPTED") {
    if (!v.escrow || testnet) return { title: t("Thank you!"), sub: t("Your order is complete.") };
    if (v.escrow.state === "FUNDED" && !moving("release")) return { title: t("Thank you!"), sub: t("Kesuni is finishing the payment. Nothing for you to do.") };
    return { title: t("Thank you!"), sub: t("Your payment is on its way to Kesuni.") };
  }
  if (s === "REJECTED") {
    if (!funded(v) || testnet) return { title: t("You rejected the item"), sub: t("Kesuni will contact you about a fix.") };
    if (v.escrow!.state === "REFUNDED") return { title: t("Your money has been refunded"), sub: t("Kesuni will contact you about a fix.") };
    if (v.escrow!.state === "FUNDED" && !moving("refund")) return { title: t("Your money is being refunded"), sub: t("Kesuni is finishing the refund. Nothing for you to do.") };
    return { title: t("Your money is being refunded"), sub: t("It is on its way back to you.") };
  }
  // Kesuni's price is above the budget: the price and "Raise my budget" follow (RaiseBudget). Once raised, a line says so.
  if (s === "CREATED" && v.overBudget) return { title: t("Your price is above your budget"), sub: "" };
  if (s === "CREATED" && v.budgetRaised) return { title: t("Kesuni is preparing your agreement"), sub: "" };
  if (s === "CREATED") {
    return { title: t("Kesuni is preparing your price"), sub: t("Kesuni is checking your order. The price will appear on this page. You can close it and open the link again later.") };
  }
  const paid = funded(v);
  if (s === "EVIDENCE_SUBMITTED") {
    if (!paid) return { title: t("Your item is ready!"), sub: t("The payment is still open: pay below, then you can accept or reject here.") };
    const photos = (v.updates ?? []).some((u) => u.photo);
    return { title: t("Your item is ready!"), sub: [t("When the item is in your hands, check it, then accept or reject here."), photos ? t("The quality-check photos are below.") : ""].filter(Boolean).join(" ") };
  }
  // An order printed piece by piece: the pieces done so far, once there are some.
  const pieces = v.pieces && v.pieces.printed > 0 ? t("{printed} of {total} pieces printed.", v.pieces) : "";
  if (v.printing && PRINTING.includes(v.printing.state)) {
    return { title: t("Printing now"), sub: [t("On printer {printer}. Progress comes straight from the printer.", { printer: v.printing.printer }), pieces].filter(Boolean).join(" ") };
  }
  if (v.printing?.state === "PAUSE") return { title: t("Print paused for a moment"), sub: t("A Kesuni operator is handling it (for example, changing filament).") };
  if (pieces) return { title: t("Your order is being printed"), sub: pieces }; // between two runs
  if (v.printedOn) return { title: t("Printing finished"), sub: t("Now being taken off the printer and quality-checked.") };
  const whatsapp = t("Kesuni sends the payment details on WhatsApp.");
  if (!paid) {
    if (v.paying) return { title: testnet ? t("Processing…") : t("Processing your payment…"), sub: t("Usually under a minute. This page updates by itself.") };
    if (paymentFailed(v)) return failedText(testnet, t);
    if (s !== "PLAN_CHOSEN") return { title: t("Your order is being made"), sub: t("The payment is still open: pay below.") };
    return { title: t("Your price is ready"), sub: testnet ? `${t("Check the details below, then agree.")} ${whatsapp}` : t("Pay first. The money only goes to Kesuni after you accept the item.") };
  }
  if (testnet) return { title: t("Price agreed"), sub: `${whatsapp} ${t("Your order is waiting for its turn on a printer.")}` };
  return { title: t("Payment received and kept safe"), sub: t("Your order is waiting for its turn on a printer.") };
}

/** Shown once after the order form sent the order ("?new=1", taken off the address at once so a copied link is clean). */
function SavedLink({ token }: { token: string }) {
  const t = useT();
  const [copied, setCopied] = useState<boolean | null>(null);
  const link = orderUrl(token);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false); // no clipboard (an old browser, plain http): the link shows to copy by hand
    }
  };
  return (
    <div className="alert ok cust-saved" role="status">
      <p>{t("Order sent! Save this link so you can open your order later.")}</p>
      <div className="cust-saved-actions">
        <button type="button" onClick={() => void copy()}>{copied ? t("Copied") : t("Copy link")}</button>
        <a className="btn-link" href={waShareLink(link)} target="_blank" rel="noreferrer">{t("Send to my WhatsApp")}</a>
      </div>
      {copied === false && <p className="cust-saved-link">{link}</p>}
    </div>
  );
}

export default function CustomerView({ token, whatsapp = null }: { token: string; whatsapp?: string | null }) {
  const t = useT();
  const locale = useLocale();
  const when = whenIn(locale);
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  // English texts (from this page or the server); translated when shown.
  const [error, setError] = useState<{ text: string; reasons?: string[] } | null>(null);
  // The design sent with "Add your design" on this page, kept for its 3D view.
  const [sent, setSent] = useState<File | null>(null);
  // "?new=1": the order form just sent this order. Read once, then taken off the address, so a link copied from the
  // address bar never shows "Order sent!" again.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("new")) return;
    url.searchParams.delete("new");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setTimeout(() => setFresh(true), 0);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/c/${token}`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      if (!res.ok) return;
      const view: View = await res.json();
      setV(view);
      // Into the portal's "My orders" on this phone too; once (this page refreshes every few seconds).
      rememberIfNew(`/c/${token}`, view.order.product);
    } catch { /* offline for a moment: keep the last view */ }
  }, [token]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 4000);
    const onShow = () => { if (!document.hidden) void load(); }; // back from WhatsApp: refresh at once
    document.addEventListener("visibilitychange", onShow);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/c/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      // A decision whose money the safety rules held is recorded all the same: the headline says Kesuni finishes it.
      if (!res.ok) setError({ text: data.error, reasons: data.reasons });
      await load();
    } catch {
      setError({ text: "Connection lost. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (missing) return (
    <main className="cust" lang={locale}>
      <CustTop home={PORTAL} />
      <section className="cust-hero">
        <p style={{ marginTop: 0 }}>{t("We can't find this order. The link may be cut off, or the order was cancelled.")}</p>
        <div className="cust-actions">
          <a className="btn-link" href={`${PORTAL}?tab=orders`}>{t("My orders")}</a>
          <WhatsAppButton number={whatsapp} text={window.location.href} label={t("Chat Kesuni on WhatsApp")} />
        </div>
      </section>
    </main>
  );
  if (!v) return <main className="cust" lang={locale}><p className="muted">{t("Loading your order…")}</p></main>;

  const h = headline(v, t);
  const s = v.order.status;
  const open = paymentOpen(v);
  const canPay = open && v.price && !v.paying && ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(s);
  // Accepting or rejecting moves the money in escrow: never before it is there.
  const canDecide = s === "EVIDENCE_SUBMITTED" && v.escrow?.state === "FUNDED";
  const printingNow = v.printing && v.printing.state !== "FINISH" && v.printing.state !== "IDLE" && ["PLAN_CHOSEN", "IN_PRODUCTION"].includes(s);
  const paused = v.printing?.state === "PAUSE";
  const photos = v.updates.filter((u) => u.photo);
  const txs = v.escrow?.txs ?? [];
  const testnet = v.network.isTestnet;
  const failed = paymentFailed(v) ? failedText(testnet, t) : null;

  return (
    <main className="cust" lang={locale}>
      <CustTop home={PORTAL}>{v.order.customerName ? t("Order for {name}", { name: v.order.customerName }) : v.order.id}</CustTop>

      {fresh && <SavedLink token={token} />}

      <section className="cust-hero">
        <p className="cust-eyebrow">
          {v.order.quantity} × {v.order.product}
          {v.order.label === "simulated" && <> <span className="badge simulated">{t("test order")}</span></>}
        </p>
        <h1>{h.title}</h1>
        {h.sub && <p className="muted">{h.sub}</p>}
        {v.late && <p className="cust-late" role="status">{t("Running late. Kesuni will tell you the new date.")}</p>}

        {v.overBudget && s === "CREATED" && (
          <RaiseBudget o={v.overBudget} limitIdr={v.ownerApprovalAboveIdr} defaultName={v.order.customerName ?? ""} busy={busy} onRaise={act} t={t} />
        )}
        {v.budgetRaised && !v.overBudget && s === "CREATED" && (
          <p className="alert ok" role="status">{t("Budget raised to {price}.", { price: rupiah(v.budgetRaised.toIdr) })}</p>
        )}

        {printingNow && v.printing && (
          <div className="cust-progress" aria-label={t("Print progress {n} percent", { n: Math.round(v.printing.percent) })}>
            <div className="bar"><span style={{ width: `${Math.max(2, v.printing.percent)}%` }} /></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
              <span><span className={`live-dot ${v.printing.online ? "" : "off"}`} /> {v.printing.printer}</span>
              {/* Paused or offline: a time left would be wrong. */}
              <span>
                <b>{Math.round(v.printing.percent)}%</b>
                {paused ? ` · ${t("Paused. Kesuni is on it.")}`
                  : v.printing.online && v.printing.remainingMin != null && ` · ${t("about {n} min left", { n: v.printing.remainingMin })}`}
              </span>
            </div>
            {!v.printing.online && <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>{t("The printer connection dropped for a moment. The numbers will update again.")}</p>}
          </div>
        )}

        {canPay && v.price && (
          <div className="cust-pay">
            {stepOf(v) > 1 && <p className="cust-open">{failed ? `${failed.title}. ${failed.sub}` : t("Payment still open")}</p>}
            <div className="cust-price">
              <span className="big">{rupiah(v.price.idr)}</span>
              <span className="muted">{t(v.price.etaHours === 1 ? "Print time: about {n} hour" : "Print time: about {n} hours", { n: v.price.etaHours })}</span>
            </div>
            {v.agreement && !v.agreement.current && (
              <p className="alert bad" role="status" style={{ margin: 0 }}>{t("Kesuni changed the price or details after you agreed. Please check them again.")}</p>
            )}
            {v.weightPrice && <WeightPrice w={v.weightPrice} t={t} />}
            <AgreeAndPay v={v} busy={busy} onPay={act} t={t} locale={locale} />
            {/* Only where the app holds the customer's own money: on testnet the rupiah go straight to Kesuni. */}
            {!testnet && (
              <ul className="cust-promise">
                <li>{bold(t("Your money does <b>not</b> go straight to Kesuni. It is kept safe first."))}</li>
                <li>{bold(t("It goes to Kesuni only after you tap <b>Accept</b>."))}</li>
                <li>{bold(t("If you tap <b>Reject</b>, you get the full amount back."))}</li>
              </ul>
            )}
            {testnet ? (
              <p className="cust-note">
                {t("Today you pay Kesuni in rupiah: Kesuni sends the payment details on WhatsApp. In the app, the same amount runs as a test USDC escrow on {network}.", { network: v.network.name })}{" "}
                <Info>
                  {t("In the app: {amount}. Test USDC is sent to your payment wallet automatically, then held in escrow (a safety wallet) until you accept or reject. No real money moves in the app.", { amount: usdcApprox(v.price.usdc, locale) })}
                </Info>
              </p>
            ) : (
              <p className="cust-note">
                {bold(t("Payment uses <b>real USDC</b> on the <b>{network}</b> network.", { network: v.network.name }))}{" "}
                <Info>{usdcApprox(v.price.usdc, locale)}</Info>
              </p>
            )}
          </div>
        )}
        {open && v.paying && s !== "PLAN_CHOSEN" && <p className="cust-open">{testnet ? t("Processing…") : t("Processing your payment…")}</p>}

        {["ACCEPTED", "PAID"].includes(s) && !v.review && (
          <ReviewForm defaultName={v.order.customerName ?? ""} busy={busy} onSend={act} t={t} />
        )}

        {canDecide && (
          <Decide defaultName={v.order.customerName ?? ""} busy={busy} photos={photos.map((p) => p.photo!)} onDecide={act} t={t}
            over={v.overTolerance && v.actual && v.spec ? { deviation: v.actual.maxDeviationMm, tolerance: v.spec.toleranceMm } : null} />
        )}

        {error && (
          <div className="alert bad" role="status">
            {error.text && tLib(t, error.text)}
            {error.reasons && error.reasons.length > 0 && <ul>{error.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
          </div>
        )}
      </section>

      {v.design && (
        <DesignCard d={v.design} quantity={v.order.quantity} t={t} locale={locale}
          // The file just sent from this page is drawn from memory: no second download of the same model.
          preview={<ModelPreview source={sent && sent.size === v.design.bytes ? sent : `/api/c/${token}/design`} name={v.design.name}
            sizeMm={v.design.sizeMm} bytes={v.design.bytes} color={designColour(v)} compact={v.design.priced} />} />
      )}
      {!v.design && v.canAddDesign && (
        <AddDesign token={token} color={v.choice.colors[0]?.color ?? null} onSent={async (file) => { setSent(file); await load(); }} />
      )}

      {/* Once Kesuni prices the order the material and colour are in "What you agree to": no second card. */}
      {v.choice.canChange && (
        <ChoiceCard token={token} choice={v.choice} onSaved={load} priceShown={Boolean(v.overBudget || v.budgetRaised)} studioOnline={v.studioOnline} />
      )}

      <ol className="cust-steps" aria-label={t("Order steps")}>
        {stepsOf(v).map((x) => (
          <li key={x.label} className={x.state}><span className="dot">{x.dot}</span>{t(x.label)}</li>
        ))}
      </ol>

      {v.messages.length > 0 && (
        <section className="card">
          <h2>{t("Messages from Kesuni")}</h2>
          <ul className="cust-list">
            {[...v.messages].reverse().map((m) => (
              <li key={m.at + m.text}>
                <span className="tick">{m.by === "agent" ? "AI" : "K"}</span>
                <div>
                  <div style={{ whiteSpace: "pre-line" }}>{m.text}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{m.by === "agent" ? t("written by the Chief (AI)") : t("from the Kesuni team")} · {when(m.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.updates.length > 0 && (
        <section className="card">
          <h2>{t("Latest updates")}</h2>
          <ul className="cust-list">
            {[...v.updates].reverse().map((u) => (
              <li key={u.at + u.note}>
                <span className="tick">{u.label === "device" ? "⚙" : u.kind === "qc" ? "✓" : u.photo ? "▣" : "•"}</span>
                <div>
                  {/* The printer's lines are fixed English sentences (src/lib/customer.ts); a person's note is as written. */}
                  <div>{u.label === "device" ? t(u.note) : u.note}{u.photo && <> · <a href={u.photo} target="_blank" rel="noreferrer">{t("view photo")}</a></>}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{when(u.at)} · {u.label === "device" ? t("straight from the printer") : t("logged by an operator")}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canPay && v.spec && (
        <section className="card">
          <h2>{t("Agreement")}</h2>
          <SpecList spec={v.spec} deadline={v.order.deadline} t={t} locale={locale} />
          {v.agreement && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              {t("Approved by {name}", { name: v.agreement.by })} · {dayOf(v.agreement.at, locale)}
              {!v.agreement.current && <> · <b>{t("changed, needs approval again")}</b></>}
            </p>
          )}
        </section>
      )}

      {v.actual && (
        <section className="card">
          <h2>{t("Production report")}</h2>
          <dl className="calc-kv">
            <div><dt>{t("Material used")}</dt><dd>{v.actual.filamentGrams} g</dd></div>
            <div><dt>{t("Print time")}</dt><dd>{t("{n} h", { n: v.actual.machineHours })}</dd></div>
            <div><dt>{t("Size accuracy")}</dt><dd>{v.actual.maxDeviationMm} mm{v.spec && ` ${t("(limit ±{n} mm)", { n: v.spec.toleranceMm })}`}{v.overTolerance && <> <span className="badge bad">{t("size not as agreed")}</span></>}</dd></div>
            <div><dt>{t("OK first time")}</dt><dd>{t("{n} of {total}", { n: v.actual.unitsPassed, total: v.order.quantity })}</dd></div>
          </dl>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{t("Measured by a Kesuni operator")}{v.actual.note && `: ${v.actual.note}`}. {t("You still check the item yourself.")}</p>
        </section>
      )}

      {v.review && (
        <section className="card">
          <h2>{t("Your review")}</h2>
          <p style={{ margin: 0 }}>{t("Quality {quality}/5 · Communication {communication}/5 · Value for money {value}/5", { quality: v.review.quality, communication: v.review.communication, value: v.review.value })}</p>
          {v.review.text && <p style={{ marginBottom: 0 }}>“{v.review.text}”</p>}
        </section>
      )}

      {v.acceptance && (
        <section className="card">
          <h2>{t("Your decision")}</h2>
          <p style={{ margin: 0 }}>
            <span className={`badge ${v.acceptance.accepted ? "ok" : "bad"}`}>{v.acceptance.accepted ? t("accepted") : t("rejected")}</span>{" "}
            {t("by {name}", { name: v.acceptance.by })} · {when(v.acceptance.at)}{v.acceptance.note && <>: “{v.acceptance.note}”</>}
          </p>
        </section>
      )}

      {/* The money's own record, for whoever wants to check it on the chain: folded, the exact amounts stay here. */}
      {txs.length > 0 && (
        <details className="card cust-proof">
          <summary>{t("Payment proof (technical)")} <span className="badge">{t(v.escrow!.label)}</span></summary>
          <ul className="cust-list">
            {txs.map((tx) => (
              <li key={tx.at + tx.kind}>
                <span className={`tick ${done(tx.state) ? "ok" : broken(tx.state) ? "bad" : ""}`}>{done(tx.state) ? "✓" : broken(tx.state) ? "!" : "…"}</span>
                <div>
                  <div>{TX_TEXT[tx.kind] && t(TX_TEXT[tx.kind])} · {tx.amountUsdc} USDC</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {done(tx.state) ? t("succeeded") : broken(tx.state) ? t("failed, Kesuni will handle it") : t("confirming")} · {when(tx.at)}
                    {tx.txHash && <> · <a href={`${v.network.explorerTxBase}${tx.txHash}`} target="_blank" rel="noreferrer">{t("view proof")}</a></>}
                    {tx.verifiedOnArc === true && <> · <span className="badge ok" title={t("Checked directly on the Arc network: recipient and amount match")}>{t("Verified on Arc")}</span></>}
                    {tx.verifiedOnArc === false && <> · <span className="badge bad">{t("not matching on Arc yet, Kesuni is checking")}</span></>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="cust-foot muted">
        <p className="cust-links"><a href={`${PORTAL}?tab=orders`}>{t("My orders")}</a> · <a href={PORTAL}>{t("New order")}</a></p>
        <WhatsAppButton number={whatsapp} text={`${t("Order {id}", { id: v.order.id })} ${orderUrl(token)}`} label={t("Chat Kesuni on WhatsApp")} />
        {/* The agreed date is in the agreement ("Ready by"); before there is one, the date the customer asked for. */}
        {!v.spec && <p>{t("Needed by: {date}", { date: dayText(v.order.deadline, locale) })}</p>}
        {v.order.budgetIdr !== undefined && <p>{t("Your maximum budget: {price}", { price: rupiah(v.order.budgetIdr) })}</p>}
        {v.order.customerNote && <p>{t("Your note:")} “{v.order.customerNote}”</p>}
        <p>{testnet ? t("Your address and phone number are not stored on this page.")
          : t("Your address and phone number are not stored on this page. Your money only moves when you accept or reject.")}</p>
      </footer>
    </main>
  );
}

const dayOf = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleDateString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short" });

/** The model's colour in 3D: the customer's own choice, else none (a neutral grey). Never the spool it was weighed with:
 *  that may be another colour, and the customer would think Kesuni picked it. */
export const designColour = (v: Pick<View, "choice">): string | null => v.choice.colors[0]?.color ?? null;

const DESIGN_BADGE: Record<NonNullable<View["design"]>["state"], { tone: string; text: string }> = {
  weighing: { tone: "testnet", text: "Weighing…" },
  weighed: { tone: "ok", text: "Weighed" },
  check: { tone: "", text: "Kesuni checks your file" },
};

/**
 * "Your design": the model the customer sent themselves, in 3D (`preview`), with its size and what the studio's slicer
 * found (weight, print time) and, until Kesuni's own price exists, the estimated price by weight in rupiah. Nothing
 * about cost, margin, printers, spools or files. Once the price is ready it shrinks to the model and its size.
 */
export function DesignCard({ d, quantity, preview, t, locale }: {
  d: NonNullable<View["design"]>; quantity: number; preview: ReactNode; t: T; locale: Locale;
}) {
  const grams = (n: number) => n.toLocaleString(dateLocale(locale), { maximumFractionDigits: 1 });
  const badge = d.priced ? null : DESIGN_BADGE[d.state];
  const g = d.priced ? null : d.gramsPerPiece;
  const min = d.printMinutesPerPiece;
  return (
    <section className="card dc">
      <div className="cc-card-head">
        <h2>{t("Your design")} <Info>{t("Drag to turn your model. Kesuni weighs it to set the price.")}</Info></h2>
        {badge && <span className={`badge ${badge.tone}`}>{t(badge.text)}</span>}
      </div>
      {preview}
      {g !== null && (
        <dl className="calc-kv">
          <div><dt>{t("Weight")}</dt><dd>{t("{g} g per piece", { g: grams(g) })}</dd></div>
          {min !== null && (
            <div>
              <dt>{t("Print time (estimate)")}</dt>
              <dd>
                {t("{time} per piece", { time: duration(min, false, t) })}
                {quantity > 1 && <small>{t("{time} for {n} pieces", { time: duration(min * quantity, false, t), n: quantity })}</small>}
              </dd>
            </div>
          )}
          {d.estimate && (
            <div>
              <dt>{t("Estimated price")}</dt>
              <dd>
                {rupiah(d.estimate.totalIdr)}
                {quantity > 1 && <small>{t("{price} per piece", { price: rupiah(d.estimate.unitIdr) })}</small>}
              </dd>
            </div>
          )}
        </dl>
      )}
      {g !== null && d.estimate && <p className="cust-note dc-note">{t("Estimate · the final price comes with your agreement")}</p>}
    </section>
  );
}

/** "Have a 3D file?": the customer sends their model now, while Kesuni prepares the price (POST /api/c/<token>/design). */
function AddDesign({ token, color, onSent }: { token: string; color: string | null; onSent: (file: File) => Promise<void> }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  // The picked file cannot be opened (a broken STL): it is not sent.
  const [unreadable, setUnreadable] = useState(false);
  // English texts (this page's or the server's); translated when shown.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (f: File | null) => { setFile(f); setUnreadable(false); };

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("design", file);
      const res = await fetch(`/api/c/${token}/design`, { method: "POST", body: form });
      const data: { error?: string; reasons?: string[] } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data.error === "Your design cannot be used" ? data.reasons?.[0] : data.error) ?? "Connection lost. Please try again.");
        // A refused file comes off, so the next Send does not try it again.
        if (res.status === 400 || res.status === 413) pick(null);
        return;
      }
      pick(null);
      await onSent(file);
    } catch {
      setError("Connection lost. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t("Have a 3D file? (optional)")} <DesignInfo /></h2>
      <DesignPicker file={file} onFile={pick} error={error} onError={setError} label={t("Have a 3D file? (optional)")} disabled={busy} color={color}
        onUnreadable={setUnreadable} />
      <button type="button" className="primary cust-cta dc-send" disabled={busy || !file || unreadable} onClick={send}>
        {busy ? t("Sending your design…") : t("Send design")}
      </button>
    </section>
  );
}

/**
 * The material and colours the customer picked: they can change them while Kesuni prepares the price. priceShown:
 * Kesuni's price is already on the page (above the budget, or the budget was raised to it), so no "until the price" note.
 */
export function ChoiceCard({ token, choice, onSaved, priceShown = false, studioOnline = true }: {
  token: string; choice: View["choice"]; onSaved: () => Promise<void>; priceShown?: boolean; studioOnline?: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const chosen = Boolean(choice.material || choice.colors.length);
  return (
    <section className="card">
      <div className="cc-card-head">
        <h2>{t("Material and colour")}</h2>
        {choice.canChange && !editing && <button type="button" onClick={() => setEditing(true)}>{chosen ? t("Change") : t("Choose")}</button>}
      </div>
      {editing
        ? <ChoiceEditor token={token} choice={choice} studioOnline={studioOnline} onDone={async (saved) => { if (saved) await onSaved(); setEditing(false); }} />
        : <>
          <ChoiceSummary choice={choice} />
          {choice.colors.length > 1 && <p className="cust-note" style={{ marginTop: 8 }}>{t("More than one colour? Kesuni will help you set the colours on WhatsApp.")}</p>}
          {choice.canChange && !priceShown && <p className="cust-note" style={{ marginTop: 8 }}>{t("You can change this until Kesuni sends the price.")}</p>}
        </>}
    </section>
  );
}

function ChoiceEditor({ token, choice, studioOnline, onDone }: {
  token: string; choice: View["choice"]; studioOnline: boolean; onDone: (saved: boolean) => void;
}) {
  const t = useT();
  const palette = useStudioColors();
  const [value, setValue] = useState<Choice>({ material: choice.material, colors: choice.colors });
  const [busy, setBusy] = useState(false);
  // English texts (from this page or the server); translated when shown.
  const [error, setError] = useState<{ text: string; reasons?: string[] } | null>(null);
  // Colours no longer loaded drop out: they could not be saved.
  const clean = palette ? keepOffered(value, swatchesFor(palette)) : value;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/c/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "colors", material: clean.material, colors: clean.colors.map(({ type, color }) => ({ type, color })) }),
      });
      const data = await res.json();
      if (!res.ok) return setError({ text: data.error, reasons: data.reasons });
      onDone(true);
    } catch {
      setError({ text: "Connection lost. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ColorPicker value={clean} onChange={setValue} palette={palette} materialLocked={choice.materialLocked} disabled={busy} live={studioOnline} />
      {error && (
        <div className="alert bad" role="status">
          {error.text && t(error.text)}
          {error.reasons && error.reasons.length > 0 && <ul>{error.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
        </div>
      )}
      <div className="cc-actions">
        <button type="button" className="primary" disabled={busy || palette === null} onClick={save}>{busy ? t("Saving…") : t("Save")}</button>
        <button type="button" disabled={busy} onClick={() => onDone(false)}>{t("Cancel")}</button>
      </div>
    </>
  );
}

/**
 * Kesuni's price is above the customer's budget: the price, their budget and one button that raises the budget to
 * exactly that price (POST "raise-budget" with the quote shown, never an amount). Their name first, as for agreeing.
 */
export function RaiseBudget({ o, limitIdr, defaultName, busy, onRaise, t }: {
  o: NonNullable<View["overBudget"]>; limitIdr: number; defaultName: string; busy: boolean;
  onRaise: (b: Record<string, unknown>) => void; t: T;
}) {
  const locale = useLocale();
  const [by, setBy] = useState(defaultName);
  const price = rupiah(o.priceIdr);
  return (
    <div className="cust-pay">
      <div className="cust-price">
        <span className="big">{price}</span>
        <span className="muted">{o.quantity > 1 && `${t("{price} per piece", { price: rupiah(o.unitIdr) })} · `}{usdcApprox(o.priceUsdc, locale)}</span>
      </div>
      <dl className="calc-kv" style={{ marginTop: 0 }}>
        <div>
          <dt>
            {t("Your budget")}{" "}
            <Info>
              {t("Kesuni can only charge up to the budget you set.")} {t("Raising it lets Kesuni prepare your agreement at this price.")}
              {o.priceIdr > limitIdr && <> {t("Above {limit} Kesuni's owner also approves.", { limit: rupiah(limitIdr) })}</>}
            </Info>
          </dt>
          <dd>{rupiah(o.budgetIdr)}</dd>
        </div>
      </dl>
      <label>{t("Your name")}
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t("Name")} />
      </label>
      <button className="primary cust-cta" disabled={busy || !by.trim()} onClick={() => onRaise({ action: "raise-budget", quoteId: o.quoteId, by })}>
        {busy ? t("Processing…") : t("Raise my budget to {price}", { price })}
      </button>
      <p className="cust-note">{t("You do not pay yet: you agree to the final price first.")} {t("Or message Kesuni to change the order.")}</p>
    </div>
  );
}

/** Kesuni's official price by weight, as the customer reads it. No cost or margin. */
function WeightPrice({ w, t }: { w: NonNullable<View["weightPrice"]>; t: T }) {
  return (
    <p className="muted" style={{ fontSize: 14, margin: "4px 0 10px" }}>
      {t("Price by weight: {grams} g × {perGram} = {exact}", { grams: w.gramsPerUnit, perGram: rupiah(w.pricePerGramIdr), exact: rupiah(w.exactUnitIdr) })}
      {w.exactUnitIdr !== w.unitPriceIdr && <>, {t("rounded up to {price}", { price: rupiah(w.unitPriceIdr) })}</>} {t("per piece")}
      {w.quantity > 1 && <><br />{t("{n} pieces × {price} =", { n: w.quantity, price: rupiah(w.unitPriceIdr) })} <b>{rupiah(w.totalIdr)}</b></>}
    </p>
  );
}

const CHECKED_TEXT = "I have checked the size, colour, finish and function of the item I received.";
/** Under a button that waits for the tick and the name, so a grey button says why. */
const TICK_FIRST = "Tick the box and write your name to continue.";

export function Decide({ defaultName, busy, photos, onDecide, over, t }: {
  defaultName: string; busy: boolean; photos: string[];
  onDecide: (b: Record<string, unknown>) => void;
  /** Measured size deviation above the agreed tolerance (mm): a warning, not a block. */
  over: { deviation: number; tolerance: number } | null;
  t: T;
}) {
  const [by, setBy] = useState(defaultName);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  return (
    <div className="cust-pay">
      {photos.length > 0 && (
        <div className="cust-photos">
          {photos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt={t("Quality-check photo")} /></a>
          ))}
        </div>
      )}
      <label>{t("Your name")}
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t("Name")} />
      </label>
      <label>{t("Note (optional)")}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("For example: neat, as ordered")} />
      </label>
      {over && (
        <div className="alert bad" role="alert" style={{ marginTop: 0 }}>
          <b>{t("Warning: the size is not as agreed.")}</b>{" "}
          {t("Kesuni measured up to {deviation} mm off, while the agreed limit is ±{tolerance} mm. Check the item carefully. You may still accept; if you do, this is recorded. If it is not right, choose Reject and your money is refunded.", { deviation: over.deviation, tolerance: over.tolerance })}
        </div>
      )}
      <label className="cust-check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{t(CHECKED_TEXT)}</span>
      </label>
      <div className="row">
        <button className="primary cust-cta" disabled={busy || !by.trim() || !checked} onClick={() => onDecide({ action: "accept", by, note, checked: true })}>
          {over ? t("Accept the item anyway") : t("Accept the item")}
        </button>
        {!confirmReject ? (
          <button disabled={busy || !by.trim()} onClick={() => setConfirmReject(true)}>{t("Reject")}</button>
        ) : (
          <button className="danger" disabled={busy || !by.trim()} onClick={() => onDecide({ action: "reject", by, note })}>
            {t("Yes, reject and refund")}
          </button>
        )}
      </div>
      {!busy && (!by.trim() || !checked) && <p className="cust-note">{t(TICK_FIRST)}</p>}
      <p className="cust-note">{t("Accept: Kesuni gets paid. Reject: you get your money back.")}</p>
    </div>
  );
}

function SpecList({ spec, deadline, t, locale }: { spec: NonNullable<View["spec"]>; deadline: string; t: T; locale: Locale }) {
  return (
    <dl className="calc-kv" style={{ marginTop: 0 }}>
      <div><dt>{t("Size")}</dt><dd>{spec.dimensions} (±{spec.toleranceMm} mm)</dd></div>
      {/* Colour names and the usual quality promise in the page's language; Kesuni's own words stay as written. */}
      <div><dt>{t("Material & colour")}</dt><dd>{spec.material}{spec.color && ` · ${t(spec.color)}`}</dd></div>
      <div><dt>{t("Finishing")}</dt><dd>{finishingText(spec.finishing, t)}</dd></div>
      <div><dt>{t("Ready by")}</dt><dd>{dayText(deadline, locale)}</dd></div>
      <div><dt>{t("How the result is checked")}</dt><dd style={{ fontWeight: 400, textAlign: "right" }}>{t(spec.promise)}</dd></div>
    </dl>
  );
}

export function AgreeAndPay({ v, busy, onPay, t, locale }: { v: View; busy: boolean; onPay: (b: Record<string, unknown>) => void; t: T; locale: Locale }) {
  const current = Boolean(v.agreement?.current);
  const [ok, setOk] = useState(current);
  const [by, setBy] = useState(v.agreement?.by ?? v.order.customerName ?? "");
  return (
    <>
      {v.spec && (
        <details className="cust-agree" open>
          <summary>{t("What you agree to")}</summary>
          <SpecList spec={v.spec} deadline={v.order.deadline} t={t} locale={locale} />
        </details>
      )}
      {v.costs && (
        <details className="cust-agree">
          <summary>{t("Where does your money go?")}</summary>
          <dl className="calc-kv" style={{ marginTop: 0 }}>
            {v.costs.lines.map((l) => <div key={l.label}><dt>{t(l.label)}</dt><dd>{rupiah(l.idr)}</dd></div>)}
            <div><dt>{t("Kesuni service & profit")}</dt><dd>{rupiah(v.costs.kesuniIdr)}</dd></div>
            <div><dt><b>{t("Total")}</b></dt><dd>{rupiah(v.costs.totalIdr)}</dd></div>
          </dl>
        </details>
      )}
      <label>{t("Your name")}
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t("Name")} />
      </label>
      <label className="cust-check">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>{t("I agree to the price, spec and due date above.")}</span>
      </label>
      {/* Testnet: the rupiah go to Kesuni on WhatsApp and this starts only the app's test escrow, so it never says "pay".
          Mainnet: the exact USDC that moves. */}
      <button className="primary cust-cta" disabled={busy || !ok || !by.trim()} onClick={() => onPay({ action: "pay", agree: true, by })}>
        {busy ? t("Processing…") : v.network.isTestnet
          ? t("Agree to {price}", { price: rupiah(v.price!.idr) })
          : t("Agree & pay {amount} USDC", { amount: usdcExact(v.price!.usdc, locale) })}
      </button>
      {!busy && (!ok || !by.trim()) && <p className="cust-note">{t(TICK_FIRST)}</p>}
    </>
  );
}

function ReviewForm({ defaultName, busy, onSend, t }: { defaultName: string; busy: boolean; onSend: (b: Record<string, unknown>) => void; t: T }) {
  const [r, setR] = useState({ quality: 0, communication: 0, value: 0 });
  const [text, setText] = useState("");
  const [by, setBy] = useState(defaultName);
  const row = (k: keyof typeof r, label: string) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 14, marginBottom: 4 }}>{label}</div>
      <div className="stars" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={r[k] === n} className={r[k] >= n ? "on" : ""}
            onClick={() => setR({ ...r, [k]: n })}>{n}★</button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="cust-pay">
      <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>{t("How did it turn out?")}</h2>
      {row("quality", t("Item quality"))}
      {row("communication", t("Communication"))}
      {row("value", t("Value for money"))}
      <label>{t("A few words (optional)")}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("What was right, what should improve?")} />
      </label>
      <label>{t("Your name")}
        <input value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <button className="primary cust-cta" disabled={busy || !r.quality || !r.communication || !r.value || !by.trim()}
        onClick={() => onSend({ action: "review", ...r, text, by })}>{t("Send review")}</button>
      <p className="cust-note">{t("Thank you! Your review helps Kesuni get better.")}</p>
    </div>
  );
}
