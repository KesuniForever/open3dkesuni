"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { microToUsdc } from "@/lib/policy";
import type {
  Acceptance, AgentLogEntry, Decision, Escrow, Evidence, OperatorTask, Order, OrderStatus, PaymentIntent, Printer, Quote, Vendor,
} from "@/lib/types";
import EscrowPanel from "./EscrowPanel";
import PrinterPanel from "./PrinterPanel";

interface OrderData {
  order: Order;
  vendors: Vendor[];
  quotes: Quote[];
  decisions: Decision[];
  evidence: Evidence[];
  acceptance: Acceptance | null;
  agentLog: AgentLogEntry[];
  paymentIntents: PaymentIntent[];
  escrow: Escrow | null;
  tasks: OperatorTask[];
  printers: Printer[];
}

type Notice = { kind: "ok" | "bad"; text: string; reasons?: string[] } | null;

const FLOW: OrderStatus[] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED"];

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

export default function OrderView({ id }: { id: string }) {
  const [data, setData] = useState<OrderData | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${id}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) setMissing(true);
        else setData(await res.json());
      })
      .catch(() => { if (!cancelled) setNotice({ kind: "bad", text: "Could not load the order." }); });
    return () => { cancelled = true; };
  }, [id, version]);

  async function act(url: string, body: unknown, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await post(url, body);
      setNotice(r.ok ? { kind: "ok", text: success } : { kind: "bad", text: r.data.error, reasons: r.data.reasons });
      load();
    } catch {
      setNotice({ kind: "bad", text: "Network error. Is the server running?" });
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <main className="wrap"><p>Order not found. <Link href="/">Back</Link></p></main>;
  if (!data) return <main className="wrap"><p className="muted">Loading…</p></main>;

  const { order, quotes, vendors, evidence, acceptance, agentLog, paymentIntents, escrow } = data;
  const base = `/api/orders/${order.id}`;
  const vendorName = (vid: string) => vendors.find((v) => v.id === vid)?.name ?? vid;
  const chosen = quotes.find((q) => q.id === order.chosenQuoteId);
  const chosenVendor = chosen ? vendors.find((v) => v.id === chosen.vendorId) : undefined;
  const stepIndex = order.status === "REJECTED" ? 3 : FLOW.indexOf(order.status === "PAID" ? "ACCEPTED" : order.status);

  return (
    <main className="wrap">
      <header className="topbar">
        <Link href="/" className="brand">Kesuni 3D</Link>
        <button
          disabled={busy}
          onClick={async () => { await post("/api/reset"); setNotice(null); load(); }}
          title="Restore the simulated demo order. Real orders are not touched."
        >
          Reset simulated demo
        </button>
      </header>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{order.product}</h1>
        <span className={`badge ${order.label}`}>{order.label} data</span>
      </div>
      <ol className="timeline" aria-label="Order progress">
        {FLOW.map((s, i) => (
          <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}>{s.replaceAll("_", " ").toLowerCase()}</li>
        ))}
        {order.status === "REJECTED" && <li className="now">rejected</li>}
      </ol>

      {notice && (
        <div className={`alert ${notice.kind}`} role="status" style={{ marginBottom: 16 }}>
          <strong>{notice.kind === "ok" ? "Done: " : "Blocked: "}</strong>{notice.text}
          {notice.reasons && notice.reasons.length > 0 && <ul>{notice.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}

      {/* 1. Order */}
      <section className="card">
        <h2><span className="step">1</span> Order</h2>
        <dl className="grid kv">
          <div><dt>Order / Job</dt><dd className="mono">{order.id} · {order.jobId}</dd></div>
          <div><dt>Quantity</dt><dd>{order.quantity}</dd></div>
          <div><dt>Deadline</dt><dd>{order.deadline}</dd></div>
          <div><dt>Design version</dt><dd>{order.designVersion}</dd></div>
          <div><dt>Budget mandate</dt><dd>{microToUsdc(order.mandateMicro)} USDC</dd></div>
          <div><dt>Status</dt><dd><b>{order.status}</b></dd></div>
        </dl>
      </section>

      {/* 2. Options + agent */}
      <section className="card">
        <h2><span className="step">2</span> Production options and agent decision</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Quote</th><th>Vendor</th><th>Price</th><th>ETA</th><th>Policy</th></tr></thead>
            <tbody>
              {quotes.map((q) => {
                const refused = q.priceMicro > order.mandateMicro;
                return (
                  <tr key={q.id}>
                    <td className="mono">{q.id}{q.id === order.chosenQuoteId && " ✓"}</td>
                    <td>{vendorName(q.vendorId)}</td>
                    <td>{microToUsdc(q.priceMicro)} USDC</td>
                    <td>{q.etaHours} h</td>
                    <td>{refused ? <span className="badge bad">over budget</span> : <span className="badge ok">within budget</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {order.status === "CREATED" && (
          <QuoteForm vendors={vendors} disabled={busy}
            onSubmit={(b) => act(`${base}/quotes`, b, "Quote added.")} />
        )}
        {quotes.length === 0 && <p className="muted">No quotes yet. Add at least one before running the agent.</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || order.status !== "CREATED" || quotes.length === 0}
            onClick={() => act(`${base}/agent-plan`, undefined, "Agent ran. See the decision log below.")}>
            Run agent
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Rule-based planner for now (no LLM). It can only use tools, and the policy engine has the final say.
          </span>
        </div>
        {agentLog.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Decision log</h3>
            <ol className="log">
              {agentLog.map((e) => (
                <li key={e.id}>
                  <code>{e.tool}</code>{" "}
                  <span className={`badge ${e.ok ? "ok" : "bad"}`}>{e.ok ? "ok" : "refused"}</span>{" "}
                  <span className="muted">{summarize(e)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {data.decisions.map((d) => (
          <div key={d.at} className="alert ok"><b>Decision ({d.decidedBy}):</b> {d.reason}</div>
        ))}
      </section>

      <EscrowPanel order={order} escrow={escrow} hasPlan={Boolean(chosen)} busy={busy} act={act} onChange={load} />

      <PrinterPanel order={order} printers={data.printers} tasks={data.tasks} busy={busy} act={act} onChange={load} />

      {/* 3. Evidence */}
      <section className="card">
        <h2><span className="step">3</span> Production evidence and QC</h2>
        {evidence.length === 0 ? <p className="muted">No evidence yet.</p> : (
          <ul>
            {evidence.map((e) => (
              <li key={e.id}><b>{e.kind.toUpperCase()}</b> {e.note} <span className="badge">{e.label}</span></li>
            ))}
          </ul>
        )}
        <EvidenceForm disabled={busy || !["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(order.status)}
          onSubmit={(b) => act(`${base}/evidence`, b, `Recorded ${b.kind} evidence.`)} />
      </section>

      {/* 4. Acceptance */}
      <section className="card">
        <h2><span className="step">4</span> Acceptance</h2>
        {acceptance ? (
          <p><span className={`badge ${acceptance.accepted ? "ok" : "bad"}`}>{acceptance.accepted ? "accepted" : "rejected"}</span>{" "}
            by {acceptance.by}{acceptance.note && `: ${acceptance.note}`}</p>
        ) : <p className="muted">A person decides this. Model output is never the release condition.</p>}
        <AcceptanceForm disabled={busy || order.status !== "EVIDENCE_SUBMITTED"}
          onSubmit={(b) => act(`${base}/acceptance`, b, b.accepted ? "Order accepted." : "Order rejected.")} />
      </section>

      {/* 5. Settlement */}
      <section className="card">
        <h2><span className="step">5</span> Payment</h2>
        {paymentIntents.map((p) => (
          <div key={p.id} className="alert ok">
            <b>{p.id}</b> {microToUsdc(p.amountMicro)} {p.token} to <code>{p.recipient}</code> on {p.network}. State <b>{p.state}</b>{" "}
            <span className="badge">{p.label}</span>
            {p.txHash && <> <a href={`https://explorer.testnet.arc.io/tx/${p.txHash}`} target="_blank" rel="noreferrer">view proof</a></>}
          </div>
        ))}
        {escrow ? (
          <p className="muted" style={{ fontSize: 13 }}>
            This order pays through the escrow above. Its release creates the payment intent and needs the policy engine to approve it.
          </p>
        ) : (
          <>
            <PaymentForm key={chosen?.id ?? "none"} disabled={busy}
              defaults={{ recipient: chosenVendor?.address ?? "", amount: chosen ? microToUsdc(chosen.priceMicro) : "" }}
              onSubmit={(b) => act(`${base}/payment-intent`, b, "Payment intent created (local only, no USDC sent).")} />
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              Without an escrow this creates a payment intent only; no USDC is sent. Try changing the address or amount to see the policy block it.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function summarize(e: AgentLogEntry): string {
  const out = e.output as Record<string, unknown> | undefined;
  if (!e.ok && out) {
    const reasons = (out.reasons as string[] | undefined) ?? [];
    return reasons.length ? reasons.join("; ") : String(out.error ?? "");
  }
  const input = e.input as Record<string, unknown>;
  if (e.tool === "check_vendor_policy") return `${input.quoteId} allowed`;
  if (e.tool === "choose_plan") return `chose ${input.quoteId}`;
  if (e.tool === "request_human_decision") return "escalated to a person";
  return "";
}

function QuoteForm({ vendors, disabled, onSubmit }: {
  vendors: Vendor[];
  disabled: boolean;
  onSubmit: (b: { vendorId: string; priceUsdc: string; etaHours: number }) => void;
}) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [eta, setEta] = useState("");
  return (
    <form className="form" style={{ marginTop: 12 }} onSubmit={(e) => {
      e.preventDefault();
      onSubmit({ vendorId, priceUsdc: price, etaHours: Number(eta) });
      setPrice(""); setEta("");
    }}>
      <div className="row">
        <label style={{ flex: "2 1 200px" }}>Who prints it
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={disabled}>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 110px" }}>Price (USDC)
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="30" disabled={disabled} required />
        </label>
        <label style={{ flex: "1 1 110px" }}>Time (hours)
          <input type="number" min={1} value={eta} onChange={(e) => setEta(e.target.value)} placeholder="48" disabled={disabled} required />
        </label>
      </div>
      <div><button disabled={disabled || !price || !eta}>Add quote</button></div>
    </form>
  );
}

function EvidenceForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (b: { kind: string; note: string; label: string }) => void }) {
  const [kind, setKind] = useState("log");
  const [note, setNote] = useState("");
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit({ kind, note, label: "manual" }); setNote(""); }}>
      <div className="row">
        <label style={{ flex: "0 0 140px" }}>Type
          <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={disabled}>
            <option value="log">Production log</option>
            <option value="photo">Photo note</option>
            <option value="qc">QC result</option>
          </select>
        </label>
        <label style={{ flex: "1 1 240px" }}>Note (entered by operator, labelled manual)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Printed 4 legs, PLA, 6h" disabled={disabled} required />
        </label>
      </div>
      <div><button disabled={disabled || !note.trim()}>Add evidence</button></div>
    </form>
  );
}

function AcceptanceForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (b: { accepted: boolean; by: string; note: string }) => void }) {
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  return (
    <form className="form" onSubmit={(e) => e.preventDefault()}>
      <div className="row">
        <label style={{ flex: "1 1 180px" }}>Accepted by
          <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Customer or owner name" disabled={disabled} />
        </label>
        <label style={{ flex: "2 1 240px" }}>Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" disabled={disabled} />
        </label>
      </div>
      <div className="row">
        <button className="primary" disabled={disabled || !by.trim()} onClick={() => onSubmit({ accepted: true, by, note })}>Accept</button>
        <button disabled={disabled || !by.trim()} onClick={() => onSubmit({ accepted: false, by, note })}>Reject</button>
      </div>
    </form>
  );
}

function PaymentForm({ disabled, defaults, onSubmit }: {
  disabled: boolean;
  defaults: { recipient: string; amount: string };
  onSubmit: (b: { recipient: string; amountMicro: number; idempotencyKey: string }) => void;
}) {
  const [recipient, setRecipient] = useState(defaults.recipient);
  const [amount, setAmount] = useState(defaults.amount);
  const [error, setError] = useState("");
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      if (!/^\d+(\.\d{1,6})?$/.test(amount)) return setError("Amount must be a number with at most 6 decimals.");
      setError("");
      const [w, f = ""] = amount.split(".");
      onSubmit({ recipient, amountMicro: Number(w) * 1_000_000 + Number(f.padEnd(6, "0")), idempotencyKey: `pay-${recipient}-${amount}` });
    }}>
      <div className="row">
        <label style={{ flex: "2 1 280px" }}>Recipient address
          <input className="mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={disabled} required />
        </label>
        <label style={{ flex: "1 1 120px" }}>Amount (USDC)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" disabled={disabled} required />
        </label>
      </div>
      {error && <div className="alert bad">{error}</div>}
      <div><button className="primary" disabled={disabled || !recipient || !amount}>Create payment intent</button></div>
    </form>
  );
}
