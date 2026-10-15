"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CustomerView as View } from "@/lib/customer";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import { useLocale, useT } from "@/i18n/client";
import { CustTop, bold } from "../CustTop";
import { tLib } from "@/lib/lib-text";

// English text is the key; useT() gives the Indonesian when the visitor chose ID.
const STEPS = ["Order received", "Price and payment", "Printing", "Quality check", "Done"];
const TX_TEXT: Record<string, string> = {
  customer_topup: "Test USDC sent to your wallet",
  deposit: "You paid into escrow",
  release: "Escrow released to Kesuni",
  refund: "Escrow refunded to you",
};

const noop = () => () => {};
const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
const whenIn = (locale: Locale) => (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const done = (state: string) => state === "COMPLETE";
const broken = (state: string) => ["FAILED", "DENIED", "CANCELLED"].includes(state);

function stepOf(v: View): number {
  const s = v.order.status;
  if (["ACCEPTED", "PAID", "REJECTED"].includes(s)) return 4;
  if (s === "CREATED") return 0;
  const funded = v.escrow && v.escrow.state !== "AWAITING_DEPOSIT";
  if (!funded) return 1;
  return s === "EVIDENCE_SUBMITTED" ? 3 : 2;
}

function headline(v: View, t: T): { title: string; sub: string } {
  const s = v.order.status;
  const funded = v.escrow && v.escrow.state !== "AWAITING_DEPOSIT";
  if (s === "PAID") return { title: t("Done. Thank you!"), sub: t("Your payment has been released to Kesuni.") };
  if (s === "ACCEPTED") return { title: t("Thank you!"), sub: t("The agent is releasing your payment from escrow to Kesuni.") };
  if (s === "REJECTED") return v.escrow?.state === "REFUNDED"
    ? { title: t("Your money has been refunded"), sub: t("Kesuni will contact you about a fix.") }
    : { title: t("Your money is being refunded"), sub: t("The agent is returning the escrow to your wallet.") };
  if (s === "CREATED") return { title: t("Kesuni is preparing your price"), sub: t("We check the design and the printers first. The price will appear on this page.") };
  if (!funded) return v.paying
    ? { title: t("Processing your payment…"), sub: t("Usually under a minute. This page updates by itself.") }
    : { title: t("Your price is ready"), sub: t("Pay into escrow first. The money only goes to Kesuni after you accept the item.") };
  if (s === "EVIDENCE_SUBMITTED") return { title: t("Your item is ready!"), sub: t("Look at the quality-check photos, then decide: accept or reject.") };
  if (v.printing && ["RUNNING", "PREPARE", "SLICING"].includes(v.printing.state)) return { title: t("Printing now"), sub: t("On printer {printer}. Progress comes straight from the printer.", { printer: v.printing.printer }) };
  if (v.printing?.state === "PAUSE") return { title: t("Print paused for a moment"), sub: t("A Kesuni operator is handling it (for example, changing filament).") };
  if (v.printedOn) return { title: t("Printing finished"), sub: t("Now being taken off the printer and quality-checked.") };
  return { title: t("Payment safe in escrow"), sub: t("Your order is waiting for its turn on a printer.") };
}

export default function CustomerView({ token }: { token: string }) {
  const t = useT();
  const locale = useLocale();
  const when = whenIn(locale);
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  // English texts (from this page or the server); translated when shown.
  const [error, setError] = useState<{ text: string; reasons?: string[] } | null>(null);
  const fresh = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has("new"), () => false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/c/${token}`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      if (res.ok) setV(await res.json());
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
      if (!res.ok) setError({ text: data.error, reasons: data.reasons });
      else if (data.settled === false) setError({ text: "Your decision is recorded, but the payment was held by the safety rules. Kesuni has been told.", reasons: data.reasons });
      await load();
    } catch {
      setError({ text: "Connection lost. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (missing) return (
    <main className="cust" lang={locale}>
      <CustTop />
      <p>{t("This order link was not found. Please check the link from Kesuni.")}</p>
    </main>
  );
  if (!v) return <main className="cust" lang={locale}><p className="muted">{t("Loading your order…")}</p></main>;

  const step = stepOf(v);
  const h = headline(v, t);
  const s = v.order.status;
  const canPay = step === 1 && v.price && !v.paying && ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(s);
  const canDecide = s === "EVIDENCE_SUBMITTED" && v.escrow?.state === "FUNDED";
  const printingNow = v.printing && v.printing.state !== "FINISH" && v.printing.state !== "IDLE" && step === 2;
  const photos = v.updates.filter((u) => u.photo);
  const txs = v.escrow?.txs ?? [];

  return (
    <main className="cust" lang={locale}>
      <CustTop>{v.order.customerName ? t("Order for {name}", { name: v.order.customerName }) : v.order.id}</CustTop>

      {fresh && (
        <div className="alert ok" style={{ marginBottom: 16 }}>
          {bold(t("Order sent. <b>Save the link to this page</b>: every update on your order appears here."))}
        </div>
      )}

      <section className="cust-hero">
        <p className="cust-eyebrow">
          {v.order.quantity} × {v.order.product}
          {v.order.label === "simulated" && <> <span className="badge simulated">{t("test order")}</span></>}
        </p>
        <h1>{h.title}</h1>
        <p className="muted">{h.sub}</p>

        {printingNow && v.printing && (
          <div className="cust-progress" aria-label={t("Print progress {n} percent", { n: Math.round(v.printing.percent) })}>
            <div className="bar"><span style={{ width: `${Math.max(2, v.printing.percent)}%` }} /></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
              <span><span className={`live-dot ${v.printing.online ? "" : "off"}`} /> {v.printing.printer}</span>
              <span><b>{Math.round(v.printing.percent)}%</b>{v.printing.remainingMin != null && ` · ${t("about {n} min left", { n: v.printing.remainingMin })}`}</span>
            </div>
            {!v.printing.online && <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>{t("The printer connection dropped for a moment. The numbers will update again.")}</p>}
          </div>
        )}

        {canPay && v.price && (
          <div className="cust-pay">
            <div className="cust-price">
              <span className="big">{v.price.usdc} USDC</span>
              <span className="muted">≈ {rupiah(v.price.idr)} · {t("about {n} hours", { n: v.price.etaHours })}</span>
            </div>
            {v.weightPrice && <WeightPrice w={v.weightPrice} t={t} />}
            <AgreeAndPay v={v} busy={busy} onPay={act} t={t} />
            <ul className="cust-promise">
              <li>{bold(t("Your money does <b>not</b> go straight to Kesuni. It is held in <b>escrow</b> (a safety wallet) first."))}</li>
              <li>{bold(t("It is released to Kesuni only after you click <b>Accept</b>."))}</li>
              <li>{bold(t("If you click <b>Reject</b>, you get the full amount back."))}</li>
            </ul>
            {v.network.isTestnet
              ? <p className="cust-note">{bold(t("Test run on the <b>{network}</b> network: test USDC is sent to your wallet automatically. No real money is used.", { network: v.network.name }))}</p>
              : <p className="cust-note">{bold(t("Payment uses <b>real USDC</b> on the <b>{network}</b> network.", { network: v.network.name }))}</p>}
          </div>
        )}

        {["ACCEPTED", "PAID"].includes(s) && !v.review && (
          <ReviewForm defaultName={v.order.customerName ?? ""} busy={busy} onSend={act} t={t} />
        )}

        {canDecide && (
          <Decide defaultName={v.order.customerName ?? ""} busy={busy} photos={photos.map((p) => p.photo!)} onDecide={act} t={t}
            over={v.overTolerance && v.actual && v.spec ? { deviation: v.actual.maxDeviationMm, tolerance: v.spec.toleranceMm } : null} />
        )}

        {error && (
          <div className="alert bad" role="status">
            {error.text && t(error.text)}
            {error.reasons && error.reasons.length > 0 && <ul>{error.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
          </div>
        )}
      </section>

      <ol className="cust-steps" aria-label={t("Order steps")}>
        {STEPS.map((label, i) => (
          <li key={label} className={i < step || (i === 4 && step === 4) ? "done" : i === step ? "now" : ""}>
            <span className="dot">{i < step || (i === 4 && step === 4) ? "✓" : i + 1}</span>{t(label)}
          </li>
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

      {txs.length > 0 && (
        <section className="card">
          <h2>{t("Payment proof on the blockchain")} <span className="badge">{t(v.escrow!.label)}</span></h2>
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
                  <div>{u.note}{u.photo && <> · <a href={u.photo} target="_blank" rel="noreferrer">{t("view photo")}</a></>}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{when(u.at)} · {u.label === "device" ? t("straight from the printer") : t("logged by an operator")}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canPay && (v.spec || v.agreement) && (
        <section className="card">
          <h2>{t("Agreement")}</h2>
          {v.spec && <SpecList spec={v.spec} deadline={v.order.deadline} t={t} />}
          {v.agreement && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              {t("Approved by {name}", { name: v.agreement.by })} · {when(v.agreement.at)} · {t("version {n}", { n: v.agreement.version })}
              {!v.agreement.current && <> · <b>{t("changed, needs approval again")}</b></>}
              <br />{t("Fingerprint:")} <span className="fingerprint">{v.agreement.hash.slice(0, 16)}…</span> {t("(changes if the price or spec changes)")}
            </p>
          )}
        </section>
      )}

      {v.actual && (
        <section className="card">
          <h2>{t("Production report")}</h2>
          <dl className="calc-kv">
            <div><dt>{t("Filament used")}</dt><dd>{v.actual.filamentGrams} g</dd></div>
            <div><dt>{t("Machine time")}</dt><dd>{t("{n} h", { n: v.actual.machineHours })}</dd></div>
            <div><dt>{t("Largest size deviation")}</dt><dd>{v.actual.maxDeviationMm} mm{v.spec && ` ${t("(limit ±{n} mm)", { n: v.spec.toleranceMm })}`}{v.overTolerance && <> <span className="badge bad">{t("out of tolerance")}</span></>}</dd></div>
            <div><dt>{t("Passed check without rework")}</dt><dd>{t("{n} of {total}", { n: v.actual.unitsPassed, total: v.order.quantity })}</dd></div>
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

      <footer className="cust-foot muted">
        <p>{t("Needed by: {date}", { date: v.order.deadline })}{v.order.customerNote && <> · {t("Your note:")} “{v.order.customerNote}”</>}</p>
        <p>{t("Your address and phone number are not stored here and are never sent to the AI. Money can only move through the safety rules (policy), never at the AI's will.")}</p>
      </footer>
    </main>
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

function Decide({ defaultName, busy, photos, onDecide, over, t }: {
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
          <b>{t("Warning: the size is outside the agreed tolerance.")}</b>{" "}
          {t("The largest deviation Kesuni measured is {deviation} mm, while the limit is ±{tolerance} mm. Check the item carefully. You may still accept; if you do, this is recorded. If it is not right, choose Reject and your money is refunded.", { deviation: over.deviation, tolerance: over.tolerance })}
        </div>
      )}
      <label className="row" style={{ alignItems: "flex-start", gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: "auto", marginTop: 3 }} />
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
      <p className="cust-note">{t("Accept: the agent releases the money from escrow to Kesuni. Reject: the agent returns the money to your wallet.")}</p>
    </div>
  );
}

function SpecList({ spec, deadline, t }: { spec: NonNullable<View["spec"]>; deadline: string; t: T }) {
  return (
    <dl className="calc-kv" style={{ marginTop: 0 }}>
      <div><dt>{t("Size")}</dt><dd>{spec.dimensions} (±{spec.toleranceMm} mm)</dd></div>
      <div><dt>{t("Material & colour")}</dt><dd>{spec.material}{spec.color && ` · ${spec.color}`}</dd></div>
      <div><dt>{t("Layer / infill")}</dt><dd>{spec.layerMm} mm / {spec.infillPct}%</dd></div>
      <div><dt>{t("Finishing")}</dt><dd>{spec.finishing === "Standar" ? t("Standard") : spec.finishing /* older specs kept the Indonesian default */}</dd></div>
      <div><dt>{t("Done by")}</dt><dd>{deadline}</dd></div>
      <div><dt>{t("How the result is checked")}</dt><dd style={{ fontWeight: 400, textAlign: "right" }}>{spec.promise}</dd></div>
    </dl>
  );
}

function AgreeAndPay({ v, busy, onPay, t }: { v: View; busy: boolean; onPay: (b: Record<string, unknown>) => void; t: T }) {
  const current = Boolean(v.agreement?.current);
  const [ok, setOk] = useState(current);
  const [by, setBy] = useState(v.agreement?.by ?? v.order.customerName ?? "");
  return (
    <>
      {v.spec && (
        <details className="cust-agree" open>
          <summary>{t("What you agree to")}</summary>
          <SpecList spec={v.spec} deadline={v.order.deadline} t={t} />
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
      <label className="row" style={{ alignItems: "flex-start", gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: "auto", marginTop: 3 }} />
        <span>{t("I agree to the price, spec and due date above.")}</span>
      </label>
      <button className="primary cust-cta" disabled={busy || !ok || !by.trim()} onClick={() => onPay({ action: "pay", agree: true, by })}>
        {busy ? t("Processing…") : t("Agree & pay {amount} USDC", { amount: v.price!.usdc })}
      </button>
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
      <p className="cust-note">{t("Reviews count toward Kesuni's reputation. The number of orders alone does not raise the score; results that pass checks and arrive on time do.")}</p>
    </div>
  );
}
