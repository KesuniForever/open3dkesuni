"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { microToUsdc } from "@/lib/policy";
import type {
  Acceptance, AgentLogEntry, Attachment, CustomerMessage, Decision, Escrow, Evidence, OperatorTask, Order, OrderStatus, PaymentIntent, Printer, Quote, Vendor,
} from "@/lib/types";
import EscrowPanel from "./EscrowPanel";
import PrinterPanel from "./PrinterPanel";
import FilesPanel from "./FilesPanel";
import AgreementPanel from "./AgreementPanel";
import ActualPanel from "./ActualPanel";
import WeightPricePanel from "./WeightPricePanel";
import MessagesPanel from "./MessagesPanel";
import type { PricingConfig } from "@/lib/pricing";
import type { PublicNetwork } from "@/lib/network";

interface OrderData {
  order: Order;
  customerLink: string;
  agreementCurrent: boolean;
  idrPerUsdc: number;
  agent: { mode: "claude" | "rules"; model: string };
  ownerRules: { minOrderIdr: number; partnerMinIdr: number; approvalAboveIdr: number; minMarginPct: number; partnerMarginPct: number };
  ownerChecks: { quoteId: string; reasons: string[]; ownerCanApprove: boolean }[];
  pricing: PricingConfig;
  network: PublicNetwork;
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
  attachments: Attachment[];
  messages: CustomerMessage[];
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
      <header className="page-head">
        <div>
          <p className="eyebrow">Order · {order.id}</p>
          <h1>{order.product}</h1>
          <p className="page-sub">
            {order.customerName ? `${order.customerName} · ` : ""}{order.quantity} unit · due {order.deadline} · <b>{order.status}</b>
          </p>
        </div>
        <div className="page-actions">
          <span className={`badge ${order.label}`}>{order.label} data</span>
          <button
            disabled={busy}
            onClick={async () => { await post("/api/reset"); setNotice(null); load(); }}
            title="Restore the simulated demo order. Real orders are not touched."
          >
            Reset simulated demo
          </button>
        </div>
      </header>
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

      <div className="order-layout">
        <div className="order-side">
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

          <CustomerLink path={data.customerLink} name={order.customerName} note={order.customerNote} />
          <EscrowPanel order={order} escrow={escrow} network={data.network} hasPlan={Boolean(chosen)} busy={busy} act={act} onChange={load} />
          <MessagesPanel order={order} messages={data.messages ?? []} busy={busy} onChange={load} />
        </div>

        <div className="order-main">
          <WeightPricePanel order={order} quotes={quotes} pricing={data.pricing} budgetIdr={Math.round((order.mandateMicro / 1e6) * data.idrPerUsdc)}
            minMarginPct={data.ownerRules.minMarginPct} busy={busy} act={act} />

          <AgreementPanel order={order} quotes={quotes} agreementCurrent={data.agreementCurrent} idrPerUsdc={data.idrPerUsdc} busy={busy} act={act} />

          <OwnerRules data={data} busy={busy} act={act} />

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
              <button className="primary" disabled={busy || ["PAID", "REJECTED"].includes(order.status)}
                onClick={() => act(`${base}/agent-plan`, undefined, "The agent ran. See its decisions below.")}>
                {busy ? "Agent is working…" : "Run agent"}
              </button>
              <span className="muted" style={{ fontSize: 13 }}>
                {data.agent.mode === "claude"
                  ? <>Chief Kesuni Officer on <b>{data.agent.model}</b>. It decides with tools; the policy engine and the owner&apos;s rules have the final say, and it has no payment tool.</>
                  : <>Rule-based planner (no ANTHROPIC_API_KEY yet). Same tools and policy.</>}
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

          <FilesPanel order={order} attachments={data.attachments} onChange={load} />
          <PrinterPanel order={order} printers={data.printers} tasks={data.tasks} busy={busy} act={act} onChange={load} />

          {/* 3. Evidence */}
          <section className="card">
            <h2><span className="step">3</span> Production evidence and QC</h2>
            {evidence.length === 0 ? <p className="muted">No evidence yet.</p> : (
              <ul>
                {evidence.map((e) => (
                  <li key={e.id}><b>{e.kind.toUpperCase()}</b> {e.note} <span className="badge">{e.label}</span>
                    {e.attachmentId && <> <a href={`/api/files/${e.attachmentId}`} target="_blank" rel="noreferrer">view photo</a></>}</li>
                ))}
              </ul>
            )}
            <EvidenceForm disabled={busy || !["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(order.status)}
              onSubmit={(b) => act(`${base}/evidence`, b, `Recorded ${b.kind} evidence.`)} />
          </section>

          <ActualPanel key={order.actual?.at ?? "none"} order={order} busy={busy} act={act} />

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
                {p.txHash && <> <a href={`${data.network.explorerTxBase}${p.txHash}`} target="_blank" rel="noreferrer">view proof</a></>}
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
        </div>
      </div>
    </main>
  );
}

function CustomerLink({ path, name, note }: { path: string; name?: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const url = origin + path;
  return (
    <section className="card">
      <h2>Customer{name && `: ${name}`}</h2>
      {note && <p style={{ marginTop: 0 }}>“{note}”</p>}
      <div className="row">
        <code style={{ flex: "1 1 260px", overflowWrap: "anywhere" }}>{url}</code>
        <button onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>{copied ? "Copied" : "Copy customer link"}</button>
        <a href={path} target="_blank" rel="noreferrer">Open as customer</a>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        Send this link to the customer (WhatsApp). They can pay into escrow, follow the print live, and accept or reject. Anyone with the link can see this order.
      </p>
    </section>
  );
}

function OwnerRules({ data, busy, act }: { data: OrderData; busy: boolean; act: (url: string, body: unknown, success: string) => Promise<void> }) {
  const { order, ownerRules: r, ownerChecks } = data;
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
  const approvable = ownerChecks.filter((c) => c.ownerCanApprove);
  const [quoteId, setQuoteId] = useState("");
  const picked = approvable.some((c) => c.quoteId === quoteId) ? quoteId : approvable[0]?.quoteId ?? "";
  return (
    <section className="card">
      <h2>Owner&apos;s rules</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Minimum order {rp(r.minOrderIdr)} · owner approval above {rp(r.approvalAboveIdr)} · partners only from {rp(r.partnerMinIdr)} ·
        minimum margin {r.minMarginPct}% · deadline must be met. Enforced in code for the agent and for people. Change them in .env.local.
      </p>
      {ownerChecks.filter((c) => c.reasons.length).map((c) => (
        <div key={c.quoteId} className="alert bad"><code>{c.quoteId}</code>: {c.reasons.join("; ")}</div>
      ))}
      {order.ownerApproval && (
        <div className="alert ok">
          Owner exception by <b>{order.ownerApproval.by}</b> for <code>{order.ownerApproval.quoteId ?? "?"}</code>: {order.ownerApproval.note}
          <div className="muted" style={{ fontSize: 13 }}>Only for that quote at that price; a new or re-priced quote needs a new approval.</div>
        </div>
      )}
      {order.status === "CREATED" && approvable.length > 0 && (
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          void act(`/api/orders/${order.id}/owner-approval`, { quoteId: picked, by, note }, "Owner exception recorded. The Chief continues by itself (rules mode: run the agent).");
        }}>
          <div className="row">
            {approvable.length > 1 && (
              <label style={{ flex: "1 1 160px" }}>Quote
                <select value={picked} onChange={(e) => setQuoteId(e.target.value)} disabled={busy}>
                  {approvable.map((c) => <option key={c.quoteId} value={c.quoteId}>{c.quoteId}</option>)}
                </select>
              </label>
            )}
            <label style={{ flex: "1 1 160px" }}>Owner<input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Felia" disabled={busy} /></label>
            <label style={{ flex: "2 1 260px" }}>Why the exception<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pilot order for a first customer" disabled={busy} /></label>
          </div>
          <div><button disabled={busy || !picked || !by.trim() || !note.trim()}>Owner approves {picked} as an exception</button></div>
        </form>
      )}
    </section>
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
  if (e.tool === "heartbeat") return `noticed: ${((out as { findings?: { text: string }[] } | undefined)?.findings ?? []).map((f) => f.text).join(" ")}`;
  if (e.tool === "agent_start") return `woke up: ${(input as { trigger?: string }).trigger ?? ""}`;
  if (e.tool === "agent_summary" && (out as { usage?: unknown } | undefined)?.usage) {
    const u = (out as { usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number } }).usage;
    return `${String((out as { text?: string }).text ?? "")} (tokens: ${u.input_tokens} in, ${u.cache_read_input_tokens} from cache, ${u.output_tokens} out)`;
  }
  if (e.tool === "agent_thought" || e.tool === "agent_summary") return String((out as { text?: string } | undefined)?.text ?? "");
  if (e.tool === "llm_unavailable") return String((out as { error?: string } | undefined)?.error ?? "");
  if (e.tool === "owner_approval") return `owner exception: ${(input as { note?: string }).note ?? ""}`;
  if (e.tool === "request_human_decision") return String((out as { question?: string } | undefined)?.question ?? "escalated to a person");
  if (e.tool === "price_by_weight" && e.ok) {
    const o = out as { totalIdr?: number; marginPct?: number; unitPriceIdr?: number } | undefined;
    return `priced by weight: Rp${o?.unitPriceIdr?.toLocaleString("id-ID") ?? "?"}/unit, total Rp${o?.totalIdr?.toLocaleString("id-ID") ?? "?"}, margin ${o?.marginPct ?? "?"}%`;
  }
  if (e.tool === "price_with_calculator") return `priced: Rp${(out as { revenueIdr?: number })?.revenueIdr ?? "?"}, margin ${(out as { marginPct?: number })?.marginPct ?? "?"}%`;
  if (e.tool === "customer_agreement") return `customer approved price + spec (v${input.version})`;
  if (e.tool === "price_from_costing") return `quote ${(out as Record<string, unknown>)?.quoteId} from the cost calculator, margin ${(out as Record<string, unknown>)?.marginPct}%`;
  if (e.tool === "customer_review") return "customer left a review";
  if (e.tool === "message_customer") return `wrote to the customer: “${String(input.text ?? "")}”`;
  if (e.tool === "customer_decision") return (input.accepted ? "customer accepted" : "customer rejected");
  if (e.tool === "release_escrow" || e.tool === "refund_escrow") return "sent on the agent's own, after the policy check";
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
