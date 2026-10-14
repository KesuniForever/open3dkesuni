"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CustomerView as View } from "@/lib/customer";
import { BrandMark } from "@/app/components/Icon";

const STEPS = ["Order received", "Price and payment", "Printing", "Quality check", "Done"];
const TX_TEXT: Record<string, string> = {
  customer_topup: "Test USDC sent to your wallet",
  deposit: "You paid into escrow",
  release: "Escrow released to Kesuni",
  refund: "Escrow refunded to you",
};

const noop = () => () => {};
const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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

function headline(v: View): { title: string; sub: string } {
  const s = v.order.status;
  const funded = v.escrow && v.escrow.state !== "AWAITING_DEPOSIT";
  if (s === "PAID") return { title: "Done. Thank you!", sub: "Your payment has been released to Kesuni." };
  if (s === "ACCEPTED") return { title: "Thank you!", sub: "The agent is releasing your payment from escrow to Kesuni." };
  if (s === "REJECTED") return v.escrow?.state === "REFUNDED"
    ? { title: "Your money has been refunded", sub: "Kesuni will contact you about a fix." }
    : { title: "Your money is being refunded", sub: "The agent is returning the escrow to your wallet." };
  if (s === "CREATED") return { title: "Kesuni is preparing your price", sub: "We check the design and the printers first. The price will appear on this page." };
  if (!funded) return v.paying
    ? { title: "Processing your payment…", sub: "Usually under a minute. This page updates by itself." }
    : { title: "Your price is ready", sub: "Pay into escrow first. The money only goes to Kesuni after you accept the item." };
  if (s === "EVIDENCE_SUBMITTED") return { title: "Your item is ready!", sub: "Look at the quality-check photos, then decide: accept or reject." };
  if (v.printing && ["RUNNING", "PREPARE", "SLICING"].includes(v.printing.state)) return { title: "Printing now", sub: `On printer ${v.printing.printer}. Progress comes straight from the printer.` };
  if (v.printing?.state === "PAUSE") return { title: "Print paused for a moment", sub: "A Kesuni operator is handling it (for example, changing filament)." };
  if (v.printedOn) return { title: "Printing finished", sub: "Now being taken off the printer and quality-checked." };
  return { title: "Payment safe in escrow", sub: "Your order is waiting for its turn on a printer." };
}

export default function CustomerView({ token }: { token: string }) {
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
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
    const t = setInterval(() => { if (!document.hidden) void load(); }, 4000);
    const onShow = () => { if (!document.hidden) void load(); }; // back from WhatsApp: refresh at once
    document.addEventListener("visibilitychange", onShow);
    return () => { clearTimeout(first); clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
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

  if (missing) return <main className="cust" lang="en"><p>This order link was not found. Please check the link from Kesuni.</p></main>;
  if (!v) return <main className="cust" lang="en"><p className="muted">Loading your order…</p></main>;

  const step = stepOf(v);
  const h = headline(v);
  const s = v.order.status;
  const canPay = step === 1 && v.price && !v.paying && ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(s);
  const canDecide = s === "EVIDENCE_SUBMITTED" && v.escrow?.state === "FUNDED";
  const printingNow = v.printing && v.printing.state !== "FINISH" && v.printing.state !== "IDLE" && step === 2;
  const photos = v.updates.filter((u) => u.photo);
  const txs = v.escrow?.txs ?? [];

  return (
    <main className="cust" lang="en">
      <header className="cust-top">
        <span className="brand"><BrandMark size={30} />Open3DKesuni</span>
        <span className="muted">{v.order.customerName ? `Order for ${v.order.customerName}` : v.order.id}</span>
      </header>

      {fresh && (
        <div className="alert ok" style={{ marginBottom: 16 }}>
          Order sent. <b>Save the link to this page</b>: every update on your order appears here.
        </div>
      )}

      <section className="cust-hero">
        <p className="cust-eyebrow">
          {v.order.quantity} × {v.order.product}
          {v.order.label === "simulated" && <> <span className="badge simulated">test order</span></>}
        </p>
        <h1>{h.title}</h1>
        <p className="muted">{h.sub}</p>

        {printingNow && v.printing && (
          <div className="cust-progress" aria-label={`Print progress ${Math.round(v.printing.percent)} percent`}>
            <div className="bar"><span style={{ width: `${Math.max(2, v.printing.percent)}%` }} /></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
              <span><span className={`live-dot ${v.printing.online ? "" : "off"}`} /> {v.printing.printer}</span>
              <span><b>{Math.round(v.printing.percent)}%</b>{v.printing.remainingMin != null && ` · about ${v.printing.remainingMin} min left`}</span>
            </div>
            {!v.printing.online && <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>The printer connection dropped for a moment. The numbers will update again.</p>}
          </div>
        )}

        {canPay && v.price && (
          <div className="cust-pay">
            <div className="cust-price">
              <span className="big">{v.price.usdc} USDC</span>
              <span className="muted">≈ {rupiah(v.price.idr)} · about {v.price.etaHours} hours</span>
            </div>
            {v.weightPrice && <WeightPrice w={v.weightPrice} />}
            <AgreeAndPay v={v} busy={busy} onPay={act} />
            <ul className="cust-promise">
              <li>Your money does <b>not</b> go straight to Kesuni. It is held in <b>escrow</b> (a safety wallet) first.</li>
              <li>It is released to Kesuni only after you click <b>Accept</b>.</li>
              <li>If you click <b>Reject</b>, you get the full amount back.</li>
            </ul>
            {v.network.isTestnet
              ? <p className="cust-note">Test run on the <b>{v.network.name}</b> network: test USDC is sent to your wallet automatically. No real money is used.</p>
              : <p className="cust-note">Payment uses <b>real USDC</b> on the <b>{v.network.name}</b> network.</p>}
          </div>
        )}

        {["ACCEPTED", "PAID"].includes(s) && !v.review && (
          <ReviewForm defaultName={v.order.customerName ?? ""} busy={busy} onSend={act} />
        )}

        {canDecide && (
          <Decide defaultName={v.order.customerName ?? ""} busy={busy} photos={photos.map((p) => p.photo!)} onDecide={act}
            over={v.overTolerance && v.actual && v.spec ? { deviation: v.actual.maxDeviationMm, tolerance: v.spec.toleranceMm } : null} />
        )}

        {error && (
          <div className="alert bad" role="status">
            {error.text}
            {error.reasons && error.reasons.length > 0 && <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>
        )}
      </section>

      <ol className="cust-steps" aria-label="Order steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step || (i === 4 && step === 4) ? "done" : i === step ? "now" : ""}>
            <span className="dot">{i < step || (i === 4 && step === 4) ? "✓" : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {v.messages.length > 0 && (
        <section className="card">
          <h2>Messages from Kesuni</h2>
          <ul className="cust-list">
            {[...v.messages].reverse().map((m) => (
              <li key={m.at + m.text}>
                <span className="tick">{m.by === "agent" ? "AI" : "K"}</span>
                <div>
                  <div style={{ whiteSpace: "pre-line" }}>{m.text}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{m.by === "agent" ? "written by the Chief (AI)" : "from the Kesuni team"} · {when(m.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {txs.length > 0 && (
        <section className="card">
          <h2>Payment proof on the blockchain <span className="badge">{v.escrow!.label}</span></h2>
          <ul className="cust-list">
            {txs.map((t) => (
              <li key={t.at + t.kind}>
                <span className={`tick ${done(t.state) ? "ok" : broken(t.state) ? "bad" : ""}`}>{done(t.state) ? "✓" : broken(t.state) ? "!" : "…"}</span>
                <div>
                  <div>{TX_TEXT[t.kind]} · {t.amountUsdc} USDC</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {done(t.state) ? "succeeded" : broken(t.state) ? "failed, Kesuni will handle it" : "confirming"} · {when(t.at)}
                    {t.txHash && <> · <a href={`${v.network.explorerTxBase}${t.txHash}`} target="_blank" rel="noreferrer">view proof</a></>}
                    {t.verifiedOnArc === true && <> · <span className="badge ok" title="Checked directly on the Arc network: recipient and amount match">Verified on Arc</span></>}
                    {t.verifiedOnArc === false && <> · <span className="badge bad">not matching on Arc yet, Kesuni is checking</span></>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.updates.length > 0 && (
        <section className="card">
          <h2>Latest updates</h2>
          <ul className="cust-list">
            {[...v.updates].reverse().map((u) => (
              <li key={u.at + u.note}>
                <span className="tick">{u.label === "device" ? "⚙" : u.kind === "qc" ? "✓" : u.photo ? "▣" : "•"}</span>
                <div>
                  <div>{u.note}{u.photo && <> · <a href={u.photo} target="_blank" rel="noreferrer">view photo</a></>}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{when(u.at)} · {u.label === "device" ? "straight from the printer" : "logged by an operator"}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canPay && (v.spec || v.agreement) && (
        <section className="card">
          <h2>Agreement</h2>
          {v.spec && <SpecList spec={v.spec} deadline={v.order.deadline} />}
          {v.agreement && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              Approved by {v.agreement.by} · {when(v.agreement.at)} · version {v.agreement.version}
              {!v.agreement.current && <> · <b>changed, needs approval again</b></>}
              <br />Fingerprint: <span className="fingerprint">{v.agreement.hash.slice(0, 16)}…</span> (changes if the price or spec changes)
            </p>
          )}
        </section>
      )}

      {v.actual && (
        <section className="card">
          <h2>Production report</h2>
          <dl className="calc-kv">
            <div><dt>Filament used</dt><dd>{v.actual.filamentGrams} g</dd></div>
            <div><dt>Machine time</dt><dd>{v.actual.machineHours} h</dd></div>
            <div><dt>Largest size deviation</dt><dd>{v.actual.maxDeviationMm} mm{v.spec && ` (limit ±${v.spec.toleranceMm} mm)`}{v.overTolerance && <> <span className="badge bad">out of tolerance</span></>}</dd></div>
            <div><dt>Passed check without rework</dt><dd>{v.actual.unitsPassed} of {v.order.quantity}</dd></div>
          </dl>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Measured by a Kesuni operator{v.actual.note && `: ${v.actual.note}`}. You still check the item yourself.</p>
        </section>
      )}

      {v.review && (
        <section className="card">
          <h2>Your review</h2>
          <p style={{ margin: 0 }}>Quality {v.review.quality}/5 · Communication {v.review.communication}/5 · Value for money {v.review.value}/5</p>
          {v.review.text && <p style={{ marginBottom: 0 }}>“{v.review.text}”</p>}
        </section>
      )}

      {v.acceptance && (
        <section className="card">
          <h2>Your decision</h2>
          <p style={{ margin: 0 }}>
            <span className={`badge ${v.acceptance.accepted ? "ok" : "bad"}`}>{v.acceptance.accepted ? "accepted" : "rejected"}</span>{" "}
            by {v.acceptance.by} · {when(v.acceptance.at)}{v.acceptance.note && <>: “{v.acceptance.note}”</>}
          </p>
        </section>
      )}

      <footer className="cust-foot muted">
        <p>Needed by: {v.order.deadline}{v.order.customerNote && <> · Your note: “{v.order.customerNote}”</>}</p>
        <p>Your address and phone number are not stored here and are never sent to the AI. Money can only move through the safety rules (policy), never at the AI&apos;s will.</p>
      </footer>
    </main>
  );
}

/** Kesuni's official price by weight, as the customer reads it. No cost or margin. */
function WeightPrice({ w }: { w: NonNullable<View["weightPrice"]> }) {
  return (
    <p className="muted" style={{ fontSize: 14, margin: "4px 0 10px" }}>
      Price by weight: {w.gramsPerUnit} g × {rupiah(w.pricePerGramIdr)} = {rupiah(w.exactUnitIdr)}
      {w.exactUnitIdr !== w.unitPriceIdr && <>, rounded up to {rupiah(w.unitPriceIdr)}</>} per piece
      {w.quantity > 1 && <><br />{w.quantity} pieces × {rupiah(w.unitPriceIdr)} = <b>{rupiah(w.totalIdr)}</b></>}
    </p>
  );
}

const CHECKED_TEXT = "I have checked the size, colour, finish and function of the item I received.";

function Decide({ defaultName, busy, photos, onDecide, over }: {
  defaultName: string; busy: boolean; photos: string[];
  onDecide: (b: Record<string, unknown>) => void;
  /** Measured size deviation above the agreed tolerance (mm): a warning, not a block. */
  over: { deviation: number; tolerance: number } | null;
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
            <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="Quality-check photo" /></a>
          ))}
        </div>
      )}
      <label>Your name
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Name" />
      </label>
      <label>Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: neat, as ordered" />
      </label>
      {over && (
        <div className="alert bad" role="alert" style={{ marginTop: 0 }}>
          <b>Warning: the size is outside the agreed tolerance.</b> The largest deviation Kesuni measured is {over.deviation} mm,
          while the limit is ±{over.tolerance} mm. Check the item carefully. You may still accept; if you do,
          this is recorded. If it is not right, choose Reject and your money is refunded.
        </div>
      )}
      <label className="row" style={{ alignItems: "flex-start", gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: "auto", marginTop: 3 }} />
        <span>{CHECKED_TEXT}</span>
      </label>
      <div className="row">
        <button className="primary cust-cta" disabled={busy || !by.trim() || !checked} onClick={() => onDecide({ action: "accept", by, note, checked: true })}>
          {over ? "Accept the item anyway" : "Accept the item"}
        </button>
        {!confirmReject ? (
          <button disabled={busy || !by.trim()} onClick={() => setConfirmReject(true)}>Reject</button>
        ) : (
          <button className="danger" disabled={busy || !by.trim()} onClick={() => onDecide({ action: "reject", by, note })}>
            Yes, reject and refund
          </button>
        )}
      </div>
      <p className="cust-note">Accept: the agent releases the money from escrow to Kesuni. Reject: the agent returns the money to your wallet.</p>
    </div>
  );
}

function SpecList({ spec, deadline }: { spec: NonNullable<View["spec"]>; deadline: string }) {
  return (
    <dl className="calc-kv" style={{ marginTop: 0 }}>
      <div><dt>Size</dt><dd>{spec.dimensions} (±{spec.toleranceMm} mm)</dd></div>
      <div><dt>Material & colour</dt><dd>{spec.material}{spec.color && ` · ${spec.color}`}</dd></div>
      <div><dt>Layer / infill</dt><dd>{spec.layerMm} mm / {spec.infillPct}%</dd></div>
      <div><dt>Finishing</dt><dd>{spec.finishing}</dd></div>
      <div><dt>Done by</dt><dd>{deadline}</dd></div>
      <div><dt>How the result is checked</dt><dd style={{ fontWeight: 400, textAlign: "right" }}>{spec.promise}</dd></div>
    </dl>
  );
}

function AgreeAndPay({ v, busy, onPay }: { v: View; busy: boolean; onPay: (b: Record<string, unknown>) => void }) {
  const current = Boolean(v.agreement?.current);
  const [ok, setOk] = useState(current);
  const [by, setBy] = useState(v.agreement?.by ?? v.order.customerName ?? "");
  return (
    <>
      {v.spec && (
        <details className="cust-agree" open>
          <summary>What you agree to</summary>
          <SpecList spec={v.spec} deadline={v.order.deadline} />
        </details>
      )}
      {v.costs && (
        <details className="cust-agree">
          <summary>Where does your money go?</summary>
          <dl className="calc-kv" style={{ marginTop: 0 }}>
            {v.costs.lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{rupiah(l.idr)}</dd></div>)}
            <div><dt>Kesuni service & profit</dt><dd>{rupiah(v.costs.kesuniIdr)}</dd></div>
            <div><dt><b>Total</b></dt><dd>{rupiah(v.costs.totalIdr)}</dd></div>
          </dl>
        </details>
      )}
      <label>Your name
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Name" />
      </label>
      <label className="row" style={{ alignItems: "flex-start", gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: "auto", marginTop: 3 }} />
        <span>I agree to the price, spec and due date above.</span>
      </label>
      <button className="primary cust-cta" disabled={busy || !ok || !by.trim()} onClick={() => onPay({ action: "pay", agree: true, by })}>
        {busy ? "Processing…" : `Agree & pay ${v.price!.usdc} USDC`}
      </button>
    </>
  );
}

function ReviewForm({ defaultName, busy, onSend }: { defaultName: string; busy: boolean; onSend: (b: Record<string, unknown>) => void }) {
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
      <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>How did it turn out?</h2>
      {row("quality", "Item quality")}
      {row("communication", "Communication")}
      {row("value", "Value for money")}
      <label>A few words (optional)
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What was right, what should improve?" />
      </label>
      <label>Your name
        <input value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <button className="primary cust-cta" disabled={busy || !r.quality || !r.communication || !r.value || !by.trim()}
        onClick={() => onSend({ action: "review", ...r, text, by })}>Send review</button>
      <p className="cust-note">Reviews count toward Kesuni&apos;s reputation. The number of orders alone does not raise the score; results that pass checks and arrive on time do.</p>
    </div>
  );
}
