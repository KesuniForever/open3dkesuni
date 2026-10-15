"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { microToUsdc } from "@/lib/policy";
import type {
  Acceptance, AgentLogEntry, Attachment, CustomerMessage, Decision, Escrow, Evidence, OperatorTask, Order, OrderStatus, PaymentIntent, Printer, Quote, Vendor,
} from "@/lib/types";
import EscrowPanel from "./EscrowPanel";
import PrinterPanel from "./PrinterPanel";
import PrintPanel from "./PrintPanel";
import FilesPanel from "./FilesPanel";
import AgreementPanel from "./AgreementPanel";
import ActualPanel from "./ActualPanel";
import WeightPricePanel from "./WeightPricePanel";
import MessagesPanel from "./MessagesPanel";
import type { PricingConfig } from "@/lib/pricing";
import type { PublicNetwork } from "@/lib/network";
import SkillChip from "@/app/components/SkillChip";
import Info from "@/app/components/Info";
import MoreText from "@/app/components/MoreText";
import { oneLine } from "@/lib/text";
import { skillOf } from "@/lib/agent/skills";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/core";
import { rich, units } from "./rich";
import { tLib } from "@/lib/lib-text";
import type { IssueTexts } from "@/app/machines/printer-details";
import { useIssueTexts } from "@/app/machines/use-issue-texts";
import { budgetText } from "@/lib/budget";
import { nameOf } from "@/lib/colors";
import ColorSwatch from "@/app/components/ColorSwatch";

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

/** issueTexts: Bambu's words for the printer faults reported when the page was made (the table is server-only). */
export default function OrderView({ id, issueTexts = {} }: { id: string; issueTexts?: IssueTexts }) {
  const t = useT();
  const [data, setData] = useState<OrderData | null>(null);
  useIssueTexts(data?.printers ?? [], issueTexts);
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

  if (missing) return <main className="wrap"><p>{t("Order not found.")} <Link href="/">{t("Back")}</Link></p></main>;
  if (!data) return <main className="wrap"><p className="muted">{t("Loading…")}</p></main>;

  const { order, quotes, vendors, evidence, acceptance, agentLog, paymentIntents, escrow } = data;
  const base = `/api/orders/${order.id}`;
  const vendorName = (vid: string) => vendors.find((v) => v.id === vid)?.name ?? vid;
  const chosen = quotes.find((q) => q.id === order.chosenQuoteId);
  const chosenVendor = chosen ? vendors.find((v) => v.id === chosen.vendorId) : undefined;
  const usdc = data.network.isTestnet ? t("test USDC") : "USDC";
  const stepIndex = order.status === "REJECTED" ? 3 : FLOW.indexOf(order.status === "PAID" ? "ACCEPTED" : order.status);

  return (
    <main className="wrap">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t("Order · {id}", { id: order.id })}</p>
          <h1>{order.product}</h1>
          <p className="page-sub">
            {order.customerName ? `${order.customerName} · ` : ""}{units(t, order.quantity)} · {t("due {date}", { date: order.deadline })} · <b>{t(order.status)}</b>
          </p>
        </div>
        <div className="page-actions">
          <span className={`badge ${order.label}`}>{t("{label} data", { label: t(order.label) })}</span>
          <button
            disabled={busy}
            onClick={async () => { await post("/api/reset"); setNotice(null); load(); }}
            title={t("Restore the simulated demo order. Real orders are not touched.")}
          >
            {t("Reset simulated demo")}
          </button>
        </div>
      </header>
      <ol className="timeline" aria-label={t("Order progress")}>
        {FLOW.map((s, i) => (
          <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}>{t(s.replaceAll("_", " ").toLowerCase())}</li>
        ))}
        {order.status === "REJECTED" && <li className="now">{t("rejected")}</li>}
      </ol>

      {notice && (
        <div className={`alert ${notice.kind}`} role="status" style={{ marginBottom: 16 }}>
          <strong>{(notice.kind === "ok" ? t("Done:") : t("Blocked:")) + " "}</strong>{t(notice.text)}
          {notice.reasons && notice.reasons.length > 0 && <ul>{notice.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
        </div>
      )}

      <div className="order-layout">
        <div className="order-side">
          {/* 1. Order */}
          <section className="card">
            <h2><span className="step">1</span> {t("Order")}</h2>
            <dl className="grid kv">
              <div><dt>{t("Order / Job")}</dt><dd className="mono">{order.id} · {order.jobId}</dd></div>
              <div><dt>{t("Quantity")}</dt><dd>{order.quantity}</dd></div>
              <div><dt>{t("Deadline")}</dt><dd>{order.deadline}</dd></div>
              <div><dt>{t("Design version")}</dt><dd>{order.designVersion}</dd></div>
              <div><dt>{t("Budget mandate")}</dt><dd>{budgetText(order, t, data.network.isTestnet)}</dd></div>
              {(order.material || order.preferredColors?.length) && (
                <div><dt>{t("Material")}</dt><dd>
                  {order.material ?? ""}
                  {order.preferredColors?.map((c) => (
                    <span key={c.type + c.color} style={{ whiteSpace: "nowrap" }}> <ColorSwatch color={c.color} size={14} /> {t(c.name ?? nameOf(c.color))}</span>
                  ))}
                </dd></div>
              )}
              <div><dt>{t("Status")}</dt><dd><b>{t(order.status)}</b></dd></div>
            </dl>
          </section>

          <CustomerLink path={data.customerLink} name={order.customerName} note={order.customerNote} />
          <EscrowPanel order={order} escrow={escrow} network={data.network} hasPlan={Boolean(chosen)} busy={busy} act={act} onChange={load} />
          <MessagesPanel order={order} messages={data.messages ?? []} busy={busy} onChange={load} />
        </div>

        <div className="order-main">
          <WeightPricePanel order={order} quotes={quotes} pricing={data.pricing} budgetIdr={order.budgetIdr ?? Math.round((order.mandateMicro / 1e6) * data.idrPerUsdc)}
            minMarginPct={data.ownerRules.minMarginPct} busy={busy} act={act} />

          <AgreementPanel order={order} quotes={quotes} agreementCurrent={data.agreementCurrent} idrPerUsdc={data.idrPerUsdc} busy={busy} act={act} />

          <OwnerRules data={data} busy={busy} act={act} />

          {/* 2. Options + agent */}
          <section className="card">
            <h2><span className="step">2</span> {t("Production options and agent decision")}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("Quote")}</th><th>{t("Vendor")}</th><th>{t("Price")}</th><th>ETA</th><th>{t("Policy")}</th></tr></thead>
                <tbody>
                  {quotes.map((q) => {
                    const refused = q.priceMicro > order.mandateMicro;
                    return (
                      <tr key={q.id}>
                        <td className="mono">{q.id}{q.id === order.chosenQuoteId && " ✓"}</td>
                        <td>{vendorName(q.vendorId)}</td>
                        <td>{microToUsdc(q.priceMicro)} {usdc}</td>
                        <td>{t("{n} h", { n: q.etaHours })}</td>
                        <td>{refused ? <span className="badge bad">{t("over budget")}</span> : <span className="badge ok">{t("within budget")}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {order.status === "CREATED" && (
              <QuoteForm vendors={vendors} disabled={busy}
                onSubmit={(b) => act(`${base}/quotes`, b, t("Quote added."))} />
            )}
            {quotes.length === 0 && <p className="muted">{t("No quotes yet. Add at least one before running the agent.")}</p>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" disabled={busy || ["PAID", "REJECTED"].includes(order.status)}
                onClick={() => act(`${base}/agent-plan`, undefined, t("The agent ran. See its decisions below."))}>
                {busy ? t("Agent is working…") : t("Run agent")}
              </button>
              <span className="muted" style={{ fontSize: 13 }}>
                {data.agent.mode === "claude"
                  ? <>{t("Chief on")} <b>{data.agent.model}</b> <Info>{t("It decides with tools; the policy engine and the owner's rules have the final say, and it has no payment tool.")}</Info></>
                  : <>{t("Rule-based planner")} <Info>{t("No ANTHROPIC_API_KEY yet. Same tools and policy as the Chief.")}</Info></>}
              </span>
            </div>
            {agentLog.length > 0 && <DecisionLog log={agentLog} />}
            {data.decisions.map((d) => (
              <div key={d.at} className="alert ok"><b>{t("Decision ({by}):", { by: t(d.decidedBy) })}</b> {d.reason}</div>
            ))}
          </section>

          <FilesPanel order={order} attachments={data.attachments} onChange={load} />
          <PrintPanel order={order} attachments={data.attachments} printers={data.printers} paid={escrow?.state === "FUNDED"} issueTexts={issueTexts}
            busy={busy} act={act} onChange={load} />
          <PrinterPanel order={order} printers={data.printers} tasks={data.tasks} busy={busy} act={act} onChange={load} issueTexts={issueTexts} />

          {/* 3. Evidence */}
          <section className="card">
            <h2><span className="step">3</span> {t("Production evidence and QC")}</h2>
            {evidence.length === 0 ? <p className="muted">{t("No evidence yet.")}</p> : (
              <ul>
                {evidence.map((e) => (
                  <li key={e.id}><b>{t(e.kind.toUpperCase())}</b> {e.note} <span className="badge">{t(e.label)}</span>
                    {e.attachmentId && <> <a href={`/api/files/${e.attachmentId}`} target="_blank" rel="noreferrer">{t("view photo")}</a></>}</li>
                ))}
              </ul>
            )}
            <EvidenceForm disabled={busy || !["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(order.status)}
              onSubmit={(b) => act(`${base}/evidence`, b, t("Recorded {kind} evidence.", { kind: b.kind }))} />
          </section>

          <ActualPanel key={order.actual?.at ?? "none"} order={order} busy={busy} act={act} />

          {/* 4. Acceptance */}
          <section className="card">
            <h2><span className="step">4</span> {t("Acceptance")}</h2>
            {acceptance ? (
              <p><span className={`badge ${acceptance.accepted ? "ok" : "bad"}`}>{acceptance.accepted ? t("accepted") : t("rejected")}</span>{" "}
                {t("by {name}", { name: acceptance.by })}{acceptance.note && `: ${acceptance.note}`}</p>
            ) : <p className="muted">{t("A person decides this. Model output is never the release condition.")}</p>}
            <AcceptanceForm disabled={busy || order.status !== "EVIDENCE_SUBMITTED"}
              onSubmit={(b) => act(`${base}/acceptance`, b, b.accepted ? t("Order accepted.") : t("Order rejected."))} />
          </section>

          {/* 5. Settlement */}
          <section className="card">
            <h2><span className="step">5</span> {t("Payment")}{" "}
              <Info>{escrow
                ? t("The escrow release creates the payment intent, and the policy engine must approve it.")
                : t("Without an escrow this creates a payment intent only; no USDC is sent. Change the address or amount to see the policy block it.")}</Info>
            </h2>
            {paymentIntents.map((p) => (
              <div key={p.id} className="alert ok">
                <b>{p.id}</b> {rich(t("{amount} {token} to {recipient} on {network}. State {state}"), {
                  amount: microToUsdc(p.amountMicro), token: p.token, recipient: <code>{p.recipient}</code>, network: p.network, state: <b>{p.state}</b>,
                })}{" "}
                <span className="badge">{t(p.label)}</span>
                {p.txHash && <> <a href={`${data.network.explorerTxBase}${p.txHash}`} target="_blank" rel="noreferrer">{t("view proof")}</a></>}
              </div>
            ))}
            {escrow ? (
              <p className="muted" style={{ fontSize: 13 }}>{t("Paid through the escrow above.")}</p>
            ) : (
              <PaymentForm key={chosen?.id ?? "none"} disabled={busy}
                defaults={{ recipient: chosenVendor?.address ?? "", amount: chosen ? microToUsdc(chosen.priceMicro) : "" }}
                onSubmit={(b) => act(`${base}/payment-intent`, b, t("Payment intent created (local only, no USDC sent)."))} />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function CustomerLink({ path, name, note }: { path: string; name?: string; note?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const url = origin + path;
  return (
    <section className="card">
      <h2>{t("Customer")}{name && `: ${name}`} <Info>{t("Send this link to the customer (WhatsApp). They can pay into escrow, follow the print live, and accept or reject. Anyone with the link can see this order.")}</Info></h2>
      {note && <p style={{ marginTop: 0 }}>“{note}”</p>}
      <div className="row">
        <code style={{ flex: "1 1 260px", overflowWrap: "anywhere" }}>{url}</code>
        <button onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>{copied ? t("Copied") : t("Copy customer link")}</button>
        <a href={path} target="_blank" rel="noreferrer">{t("Open as customer")}</a>
      </div>
    </section>
  );
}

function OwnerRules({ data, busy, act }: { data: OrderData; busy: boolean; act: (url: string, body: unknown, success: string) => Promise<void> }) {
  const t = useT();
  const { order, ownerRules: r, ownerChecks } = data;
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
  const approvable = ownerChecks.filter((c) => c.ownerCanApprove);
  const [quoteId, setQuoteId] = useState("");
  const picked = approvable.some((c) => c.quoteId === quoteId) ? quoteId : approvable[0]?.quoteId ?? "";
  return (
    <section className="card">
      <h2>{t("Owner's rules")} <Info>{t("Enforced in code for the agent and for people; the deadline must also be met. Change them in .env.local.")}</Info></h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("Min order {min} · approval above {approval} · partners from {partner} · margin ≥ {margin}%", {
          min: rp(r.minOrderIdr), approval: rp(r.approvalAboveIdr), partner: rp(r.partnerMinIdr), margin: r.minMarginPct,
        })}
      </p>
      {ownerChecks.filter((c) => c.reasons.length).map((c) => (
        <div key={c.quoteId} className="alert bad"><code>{c.quoteId}</code>: {c.reasons.map((x) => tLib(t, x)).join("; ")}</div>
      ))}
      {order.ownerApproval && (
        <div className="alert ok">
          {rich(t("Owner exception by {by} for {quote}: {note}"), {
            by: <b>{order.ownerApproval.by}</b>, quote: <code>{order.ownerApproval.quoteId ?? "?"}</code>, note: order.ownerApproval.note,
          })}
          <div className="muted" style={{ fontSize: 13 }}>{t("Only for that quote at that price; a new or re-priced quote needs a new approval.")}</div>
        </div>
      )}
      {order.status === "CREATED" && approvable.length > 0 && (
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          void act(`/api/orders/${order.id}/owner-approval`, { quoteId: picked, by, note }, t("Owner exception recorded. The Chief continues by itself (rules mode: run the agent)."));
        }}>
          <div className="row">
            {approvable.length > 1 && (
              <label style={{ flex: "1 1 160px" }}>{t("Quote")}
                <select value={picked} onChange={(e) => setQuoteId(e.target.value)} disabled={busy}>
                  {approvable.map((c) => <option key={c.quoteId} value={c.quoteId}>{c.quoteId}</option>)}
                </select>
              </label>
            )}
            <label style={{ flex: "1 1 160px" }}>{t("Owner")}<input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Felia" disabled={busy} /></label>
            <label style={{ flex: "2 1 260px" }}>{t("Why the exception")}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Pilot order for a first customer")} disabled={busy} /></label>
          </div>
          <div><button disabled={busy || !picked || !by.trim() || !note.trim()}>{t("Owner approves {quote} as an exception", { quote: picked })}</button></div>
        </form>
      )}
    </section>
  );
}

const outText = (e: AgentLogEntry) => String((e.output as { text?: string } | undefined)?.text ?? "").trim();

/** One line per step; long texts (Claude's summary, all heartbeat findings) open in a fold, without markdown marks. */
function DecisionLog({ log }: { log: AgentLogEntry[] }) {
  const t = useT();
  // The Chief's last thought is usually its summary word for word: show that text once.
  const summaries = new Set(log.filter((e) => e.tool === "agent_summary").map(outText));
  const rows = log.filter((e) => !(e.tool === "agent_thought" && summaries.has(outText(e))));
  return (
    <>
      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>{t("Decision log")}</h3>
      <ol className="log">
        {rows.map((e) => {
          const text = summarize(e, t);
          return (
            <li key={e.id}>
              <SkillChip skill={skillOf(e.tool, e.input)} />{" "}
              <code>{e.tool}</code>{e.actor === "human" && <span className="muted"> {t("(person)")}</span>}{" "}
              <span className={`badge ${e.ok ? "ok" : "bad"}`}>{e.ok ? "ok" : t("refused")}</span>{" "}
              <span className="muted">{oneLine(text)}</span>
              <MoreText text={text} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** The step in plain words. Paragraphs (blank lines) after the first one only show in the fold. */
function summarize(e: AgentLogEntry, t: T): string {
  const out = e.output as Record<string, unknown> | undefined;
  if (!e.ok && out) {
    const reasons = (out.reasons as string[] | undefined) ?? [];
    return reasons.length ? reasons.map((r) => tLib(t, r)).join("; ") : tLib(t, String(out.error ?? ""));
  }
  const input = e.input as Record<string, unknown>;
  if (e.tool === "check_vendor_policy") return t("{quote} allowed", { quote: String(input.quoteId) });
  if (e.tool === "choose_plan") return t("chose {quote}", { quote: String(input.quoteId) });
  if (e.tool === "heartbeat") {
    const found = ((out as { findings?: { text: string }[] } | undefined)?.findings ?? []).map((f) => f.text);
    return t(found.length === 1 ? "noticed {n} problem: {list}" : "noticed {n} problems: {list}", { n: found.length, list: found.join("\n\n") });
  }
  if (e.tool === "agent_start") return t("woke up: {trigger}", { trigger: (input as { trigger?: string }).trigger ?? "" });
  if (e.tool === "agent_summary" && (out as { usage?: unknown } | undefined)?.usage) {
    const u = (out as { usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number } }).usage;
    return `${outText(e)}\n\n${t("Tokens: {in} in, {cache} from cache, {out} out.", { in: u.input_tokens, cache: u.cache_read_input_tokens, out: u.output_tokens })}`;
  }
  if (e.tool === "agent_thought" || e.tool === "agent_summary") return outText(e);
  if (e.tool === "llm_unavailable") return t(String((out as { error?: string } | undefined)?.error ?? ""));
  if (e.tool === "owner_approval") return t("owner exception: {note}", { note: (input as { note?: string }).note ?? "" });
  if (e.tool === "request_human_decision") return String((out as { question?: string } | undefined)?.question ?? t("escalated to a person"));
  if (e.tool === "price_by_weight" && e.ok) {
    const o = out as { totalIdr?: number; marginPct?: number; unitPriceIdr?: number } | undefined;
    return t("priced by weight: Rp{unit}/unit, total Rp{total}, margin {margin}%", {
      unit: o?.unitPriceIdr?.toLocaleString("id-ID") ?? "?", total: o?.totalIdr?.toLocaleString("id-ID") ?? "?", margin: o?.marginPct ?? "?",
    });
  }
  if (e.tool === "price_with_calculator") {
    return t("priced: Rp{revenue}, margin {margin}%", {
      revenue: (out as { revenueIdr?: number })?.revenueIdr ?? "?", margin: (out as { marginPct?: number })?.marginPct ?? "?",
    });
  }
  if (e.tool === "customer_agreement") return t("customer approved price + spec (v{version})", { version: String(input.version) });
  if (e.tool === "price_from_costing") {
    return t("quote {quote} from the cost calculator, margin {margin}%", {
      quote: String((out as Record<string, unknown>)?.quoteId), margin: String((out as Record<string, unknown>)?.marginPct),
    });
  }
  if (e.tool === "customer_review") return t("customer left a review");
  if (e.tool === "customer_colors") {
    const names = Array.isArray(input.colors) ? (input.colors as { name?: string; color?: string }[]).map((c) => t(c.name ?? nameOf(String(c.color)))) : [];
    return t("customer chose {choice}", { choice: [input.material ? String(input.material) : "", ...names].filter(Boolean).join(" · ") || t("none") });
  }
  if (e.tool === "start_print") return t("{name} started plate {plate} on {printer}", { name: String(input.by ?? ""), plate: String(input.plate ?? ""), printer: String(out?.printer ?? input.printerId ?? "") });
  if (e.tool === "printer_command") return `${String(input.kind ?? "")} · ${t("by {name}", { name: String(input.by ?? "") })}`;
  if (e.tool === "print_job") return t("sent to {printer}", { printer: String(out?.printer ?? "") });
  if (e.tool === "message_customer") return t("wrote to the customer: “{text}”", { text: String(input.text ?? "") });
  if (e.tool === "customer_decision") return (input.accepted ? t("customer accepted") : t("customer rejected"));
  if (e.tool === "release_escrow" || e.tool === "refund_escrow") return t("sent on the agent's own, after the policy check");
  return "";
}

function QuoteForm({ vendors, disabled, onSubmit }: {
  vendors: Vendor[];
  disabled: boolean;
  onSubmit: (b: { vendorId: string; priceUsdc: string; etaHours: number }) => void;
}) {
  const t = useT();
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
        <label style={{ flex: "2 1 200px" }}>{t("Who prints it")}
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={disabled}>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 110px" }}>{t("Price (USDC)")}
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="30" disabled={disabled} required />
        </label>
        <label style={{ flex: "1 1 110px" }}>{t("Time (hours)")}
          <input type="number" min={1} value={eta} onChange={(e) => setEta(e.target.value)} placeholder="48" disabled={disabled} required />
        </label>
      </div>
      <div><button disabled={disabled || !price || !eta}>{t("Add quote")}</button></div>
    </form>
  );
}

function EvidenceForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (b: { kind: string; note: string; label: string }) => void }) {
  const t = useT();
  const [kind, setKind] = useState("log");
  const [note, setNote] = useState("");
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit({ kind, note, label: "manual" }); setNote(""); }}>
      <div className="row">
        <label style={{ flex: "0 0 140px" }}>{t("Type")}
          <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={disabled}>
            <option value="log">{t("Production log")}</option>
            <option value="photo">{t("Photo note")}</option>
            <option value="qc">{t("QC result")}</option>
          </select>
        </label>
        <label style={{ flex: "1 1 240px" }}>{t("Note (entered by operator, labelled manual)")}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Printed 4 legs, PLA, 6h")} disabled={disabled} required />
        </label>
      </div>
      <div><button disabled={disabled || !note.trim()}>{t("Add evidence")}</button></div>
    </form>
  );
}

function AcceptanceForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (b: { accepted: boolean; by: string; note: string }) => void }) {
  const t = useT();
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  return (
    <form className="form" onSubmit={(e) => e.preventDefault()}>
      <div className="row">
        <label style={{ flex: "1 1 180px" }}>{t("Accepted by")}
          <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t("Customer or owner name")} disabled={disabled} />
        </label>
        <label style={{ flex: "2 1 240px" }}>{t("Note")}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Optional")} disabled={disabled} />
        </label>
      </div>
      <div className="row">
        <button className="primary" disabled={disabled || !by.trim()} onClick={() => onSubmit({ accepted: true, by, note })}>{t("Accept")}</button>
        <button disabled={disabled || !by.trim()} onClick={() => onSubmit({ accepted: false, by, note })}>{t("Reject")}</button>
      </div>
    </form>
  );
}

function PaymentForm({ disabled, defaults, onSubmit }: {
  disabled: boolean;
  defaults: { recipient: string; amount: string };
  onSubmit: (b: { recipient: string; amountMicro: number; idempotencyKey: string }) => void;
}) {
  const t = useT();
  const [recipient, setRecipient] = useState(defaults.recipient);
  const [amount, setAmount] = useState(defaults.amount);
  const [error, setError] = useState("");
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      if (!/^\d+(\.\d{1,6})?$/.test(amount)) return setError(t("Amount must be a number with at most 6 decimals."));
      setError("");
      const [w, f = ""] = amount.split(".");
      onSubmit({ recipient, amountMicro: Number(w) * 1_000_000 + Number(f.padEnd(6, "0")), idempotencyKey: `pay-${recipient}-${amount}` });
    }}>
      <div className="row">
        <label style={{ flex: "2 1 280px" }}>{t("Recipient address")}
          <input className="mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={disabled} required />
        </label>
        <label style={{ flex: "1 1 120px" }}>{t("Amount (USDC)")}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" disabled={disabled} required />
        </label>
      </div>
      {error && <div className="alert bad">{error}</div>}
      <div><button className="primary" disabled={disabled || !recipient || !amount}>{t("Create payment intent")}</button></div>
    </form>
  );
}
