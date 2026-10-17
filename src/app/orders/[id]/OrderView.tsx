"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { microToUsdc } from "@/lib/policy";
import type {
  Acceptance, AgentLogEntry, Attachment, CustomerMessage, Decision, Escrow, Evidence, OperatorTask, Order, PaymentIntent, PrintJob, Printer, Quote, Vendor,
} from "@/lib/types";
import EscrowPanel from "./EscrowPanel";
import PrintPanel from "./PrintPanel";
import SlicePanel, { useSliceJobs } from "./SlicePanel";
import type { OrderAutoPrintView } from "./AgentPrintRow";
import FilesPanel from "./FilesPanel";
import AgreementPanel from "./AgreementPanel";
import ActualPanel from "./ActualPanel";
import WeightPricePanel from "./WeightPricePanel";
import MessagesPanel from "./MessagesPanel";
import { NowBanner, nowText, StepCard, StepLink } from "./Steps";
import { nextStep, printFileOf, sliceGrams, STATUS_WORDS, statusWord, stepFacts, stepStates, weighedPlate } from "./operator-step";
import type { PricingConfig } from "@/lib/pricing";
import type { PublicNetwork } from "@/lib/network";
import SkillChip from "@/app/components/SkillChip";
import Info from "@/app/components/Info";
import MoreText from "@/app/components/MoreText";
import { messageText, oneLine } from "@/lib/text";
import { duration } from "@/lib/machines";
import { skillOf } from "@/lib/agent/skills";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import { rich, units } from "./rich";
import { tLib } from "@/lib/lib-text";
import { taskText, type IssueTexts } from "@/app/machines/printer-details";
import { useIssueTexts } from "@/app/machines/use-issue-texts";
import { budgetRaiseText, budgetText } from "@/lib/budget";
import { nameOf } from "@/lib/colors";
import ColorSwatch from "@/app/components/ColorSwatch";
import { ConfirmDialog } from "@/app/components/PrinterControls";

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
  autoPrint?: OrderAutoPrintView | null;
}

type Notice = { kind: "ok" | "bad"; text: string; reasons?: string[] } | null;

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
  const locale = useLocale();
  const [data, setData] = useState<OrderData | null>(null);
  useIssueTexts(data?.printers ?? [], issueTexts);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [collecting, setCollecting] = useState<Printer | null>(null);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  // Slicing on the studio PC (step 2) and the step logic: a finished slice adds a sliced file to the order, so it reloads.
  const slices = useSliceJobs(id, load);
  // The print jobs as step 4 last read them: a start on its way to the printer (the Now banner).
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const printerCount = data?.printers.length ?? 0;

  // A slice this page did not start (the customer's design weighed automatically, the agent's slice) shows up as a new
  // design file or in the dispatcher's line: read the slices again then. No new timer.
  const sliceKey = data
    ? [...data.attachments.filter((a) => a.kind === "design").map((a) => a.id), data.autoPrint?.line?.action === "slicing" ? "slicing" : ""].join(",")
    : null;
  const seenSliceKey = useRef<string | null>(null);
  const reloadSlices = slices.reload;
  useEffect(() => {
    if (sliceKey === null) return;
    if (seenSliceKey.current !== null && seenSliceKey.current !== sliceKey) reloadSlices();
    seenSliceKey.current = sliceKey;
  }, [sliceKey, reloadSlices]);

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

  // Refresh every 5 s while printers exist, so printer status and the Now banner stay live whatever card is folded.
  useEffect(() => {
    if (printerCount === 0) return;
    const timer = setInterval(() => { setNow(Date.now()); load(); }, 5000);
    return () => clearInterval(timer);
  }, [printerCount, load]);

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

  if (missing) return <main className="wrap"><p>{t("Order not found.")} <Link href="/dashboard">{t("Back")}</Link></p></main>;
  // The slices tell a weighing file from one sliced to print: the steps wait for them (a failed read counts as read).
  if (!data || !slices.loaded) return <main className="wrap"><p className="muted">{t("Loading…")}</p></main>;

  const { order, quotes, vendors, evidence, acceptance, agentLog, paymentIntents, escrow } = data;
  const evidenceOpen = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(order.status);
  const base = `/api/orders/${order.id}`;
  const vendorName = (vid: string) => vendors.find((v) => v.id === vid)?.name ?? vid;
  const chosen = quotes.find((q) => q.id === order.chosenQuoteId);
  const chosenVendor = chosen ? vendors.find((v) => v.id === chosen.vendorId) : undefined;
  const usdc = data.network.isTestnet ? t("test USDC") : "USDC";
  const raised = budgetRaiseText(order, t, locale, data.network.isTestnet);
  // The real / simulated switch (src/lib/order-label.ts): a practice order from the public form stops counting.
  const nextLabel = order.label === "real" ? "simulated" : "real";

  // ---------- the steps ----------
  const facts = stepFacts({
    order, attachments: data.attachments, slices: slices.slicer ? slices.jobs : null, printers: data.printers, tasks: data.tasks, evidence, escrow,
    agreementCurrent: data.agreementCurrent, agentMode: data.agent.mode, autoPrint: data.autoPrint, quotes, jobs: printJobs, now,
  });
  const next = nextStep(facts);
  const states = stepStates(facts, next);
  const status = t(statusWord(order.status, facts.agreed));
  const past = ["EVIDENCE_SUBMITTED", "ACCEPTED", "PAID", "REJECTED"].includes(order.status);
  const doneTasks = data.tasks.filter((task) => task.status === "done");
  const onBed = data.printers.filter((p) => p.bedOccupiedBy === order.id);
  // A part still on a bed: collected in step 5, or in step 4 between the runs of a multi-run order. "Part collected"
  // closes the printer's open collect task when there is one (the banner's Done does the same), else frees the bed;
  // neither lets the agent print (only "Bed is empty" on My machines does).
  const collectStep = facts.runDone ? "print" : "qc";
  const collectTask = (p: Printer) => data.tasks.filter((x) => x.kind === "collect_and_qc" && x.status === "open" && x.printerId === p.id).at(-1);
  const collectRows = onBed.map((p) => (
    <div key={p.id} className="op-collect">
      <span>{t("{printer} still has this order's print on the bed.", { printer: p.name })}</span>
      <button disabled={busy} onClick={() => setCollecting(p)}>{t("Part collected")}</button>
    </div>
  ));
  // The open card with those rows shows their collect tasks: the banner does not repeat them.
  const rowsInView = states[collectStep] === "now" || states[collectStep] === "wait";
  const bannerTasks = data.tasks.filter((x) => !(rowsInView && x.kind === "collect_and_qc" && onBed.some((p) => p.id === x.printerId)));
  const runsLeft = facts.runs && facts.runs.needed > 1 && facts.runs.done < facts.runs.needed && ["PLAN_CHOSEN", "IN_PRODUCTION"].includes(order.status)
    ? facts.runs : null;

  // The design the order prints from: the newest model that is not a sliced file, else the newest sliced one.
  const models = data.attachments.filter((a) => a.kind === "design" && !/\.(step|stp)$/i.test(a.filename));
  const newestModel = models.filter((a) => !a.parsed3mf?.sliced).at(-1) ?? models.at(-1);
  const modelSummary = newestModel
    ? t(data.attachments.length === 1 ? "{file} · {n} file" : "{file} · {n} files", { file: newestModel.filename, n: data.attachments.length })
    : t("No model yet.");

  const printFile = printFileOf(data.attachments, slices.slicer ? slices.jobs : null);
  const printPlate = weighedPlate(printFile) ?? printFile?.parsed3mf?.plates[0];
  const weighing = sliceGrams(data.attachments, order.quantity);
  const gramText = (g: number) => `${g.toLocaleString(dateLocale(locale), { maximumFractionDigits: 2 })} g`;
  const sliceSummary = facts.sliceRunning ? t("Slicing…")
    : printFile && printPlate ? t("Ready to print: {what} · {grams} · {time}", {
      what: printPlate.filaments.map((f) => `${f.type} ${t(nameOf(f.color))}`).join(" + "),
      grams: printPlate.weightG != null ? gramText(printPlate.weightG) : "—",
      time: printPlate.predictionSec ? duration(printPlate.predictionSec / 60, false, t) : "—",
    })
      : weighing ? t("Weighed for the price: {grams} (any colour)", { grams: gramText(weighing.gramsPerUnit) })
        : t("Not sliced yet.");

  const w = order.gramPricing;
  const payText = facts.paid ? t("Paid ✓") : facts.real ? t("Not paid yet") : t("Test order: no payment needed");
  const priceSummary = w
    ? [
      t("{unit} per piece × {qty} = {total}", { unit: rp(w.unitPriceIdr), qty: w.quantity, total: rp(w.totalIdr) }),
      facts.agreed ? t("Customer agreed ✓") : t("Waiting for the customer to agree"), payText,
    ].join(" · ")
    : chosen && order.status !== "CREATED" ? `${t("Price")}: ${microToUsdc(chosen.priceMicro)} ${usdc} · ${payText}`
      : facts.chiefPricing && order.slicerGrams ? t("The Chief is pricing it with {grams} g per piece from the slice.", { grams: order.slicerGrams.gramsPerUnit })
        : t("Needs the weight from step 2.");

  const printSummary = facts.printing ? t("Printing on {printer} · {pct}%", { printer: facts.printing.printer, pct: facts.printing.pct })
    : facts.sending ? nowText(next, t)
      : facts.printed ? facts.printed.printer ? t("Printed on {printer} ✓", { printer: facts.printed.printer }) : t("Printed ✓")
        : past ? t("Printed ✓")
          : runsLeft && runsLeft.done > 0 ? t("{done} of {needed} prints done", { done: runsLeft.done, needed: runsLeft.needed })
            : order.status === "CREATED" || (facts.real && !facts.paid) ? t("After the customer pays.") : t("Ready to start.");
  const qcSummary = facts.qcDone || past ? t("QC recorded ✓") : facts.printed ? t("No QC result yet.") : t("After printing.");
  const handoverSummary = order.status === "PAID" ? t("Paid ✓") : order.status === "REJECTED" ? t("Rejected")
    : order.status === "ACCEPTED" ? t(STATUS_WORDS.ACCEPTED) : order.status === "EVIDENCE_SUBMITTED" ? t("Waiting for the customer.") : t("After QC.");

  return (
    <main className="wrap">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t("Order · {id}", { id: order.id })}</p>
          <h1>{order.product}</h1>
          <p className="page-sub">
            {order.customerName ? `${order.customerName} · ` : ""}{units(t, order.quantity)} · {t("due {date}", { date: order.deadline })} · <b>{status}</b>
          </p>
        </div>
        <div className="page-actions">
          <span className={`badge ${order.label}`}>{t("{label} data", { label: t(order.label) })}</span>
          {(order.label === "real" || order.label === "simulated") && (
            <button disabled={busy} onClick={() => setLabelOpen(true)}
              title={t("Real orders count as traction; simulated ones are the team's tests and never count.")}>
              {t(nextLabel === "simulated" ? "Mark simulated" : "Mark real")}
            </button>
          )}
          {order.label === "simulated" && (
            <button
              disabled={busy}
              onClick={() => setResetOpen(true)}
              title={t("Restore the simulated demo order. Real orders are not touched.")}
            >
              {t("Reset simulated demo")}
            </button>
          )}
        </div>
      </header>
      {/* One click used to wipe every simulated order (with its Arc transfer records), so it asks first. */}
      <ConfirmDialog open={resetOpen} danger busy={busy} title={t("Reset the simulated demo?")} confirmLabel={t("Delete and reset")}
        onConfirm={async () => {
          setBusy(true);
          try { await post("/api/reset"); setNotice(null); } finally { setBusy(false); setResetOpen(false); load(); }
        }}
        onClose={() => setResetOpen(false)}>
        <p style={{ margin: 0 }}>{t("This deletes every simulated order with its escrow, Arc transfer records, print jobs and files, then restores the demo order. Real orders are not touched.")}</p>
        <p style={{ margin: 0 }}><b>{t("It cannot be undone.")}</b></p>
      </ConfirmDialog>
      <ConfirmDialog open={labelOpen} busy={busy} confirmLabel={t(nextLabel === "simulated" ? "Mark simulated" : "Mark real")}
        title={t(nextLabel === "simulated" ? "Mark this order as simulated?" : "Mark this order as real?")}
        onConfirm={async (by) => {
          await act(`${base}/label`, { label: nextLabel, by }, t("Label changed."));
          setLabelOpen(false);
        }}
        onClose={() => setLabelOpen(false)}>
        <p style={{ margin: 0 }}>
          {t(nextLabel === "simulated"
            ? "It stops counting as a real order: not in traction, and the agent prints it only if a person sets its runs. “Reset simulated demo” would delete it."
            : "It counts as a real order from now on: traction, the next deadline and agent prints.")}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("Logged with your name.")}</p>
      </ConfirmDialog>

      <NowBanner next={next} states={states} tasks={bannerTasks} issueTexts={issueTexts} busy={busy} act={act} />

      {notice && (
        <div className={`alert ${notice.kind}`} role="status" style={{ marginBottom: 16 }}>
          <strong>{(notice.kind === "ok" ? t("Done:") : t("Blocked:")) + " "}</strong>{t(notice.text)}
          {notice.reasons && notice.reasons.length > 0 && <ul>{notice.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
        </div>
      )}

      <div className="order-layout">
        <div className="order-side">
          <section className="card">
            <h2>{t("Order")}</h2>
            <dl className="grid kv">
              <div><dt>{t("Order / Job")}</dt><dd className="mono">{order.id} · {order.jobId}</dd></div>
              <div><dt>{t("Quantity")}</dt><dd>{order.quantity}</dd></div>
              <div><dt>{t("Deadline")}</dt><dd>{order.deadline}</dd></div>
              <div><dt>{t("Design version")}</dt><dd>{order.designVersion}</dd></div>
              <div><dt>{t("Budget mandate")}</dt><dd>
                {budgetText(order, t, data.network.isTestnet)}
                {raised && <small className="muted" style={{ display: "block", fontWeight: 400 }}>{raised}</small>}
              </dd></div>
              {(order.material || order.preferredColors?.length) && (
                <div><dt>{t("Material")}</dt><dd>
                  {order.material ?? ""}
                  {order.preferredColors?.map((c) => (
                    <span key={c.type + c.color} style={{ whiteSpace: "nowrap" }}> <ColorSwatch color={c.color} size={14} /> {t(c.name ?? nameOf(c.color))}</span>
                  ))}
                </dd></div>
              )}
              <div><dt>{t("Status")}</dt><dd><b>{status}</b></dd></div>
            </dl>
          </section>

          <CustomerLink path={data.customerLink} name={order.customerName} note={order.customerNote} />
          <EscrowPanel order={order} escrow={escrow} network={data.network} hasPlan={Boolean(chosen)} busy={busy} act={act} onChange={load} />
          <MessagesPanel order={order} messages={data.messages ?? []} busy={busy} onChange={load} />
        </div>

        <div className="order-main">
          <StepCard id="model" state={states.model} summary={modelSummary}
            explain={<>{t("The customer's model and the order's other files.")}{" "}
              <Info>{t("Files stay with Kesuni and are never sent to the AI agent. A QC photo is also recorded as photo evidence; it does not replace the QC result.")}</Info></>}>
            <FilesPanel order={order} attachments={data.attachments} onChange={load} />
          </StepCard>

          <StepCard id="slice" state={states.slice} summary={sliceSummary}
            explain={t("The studio PC turns the model into a ready-to-print file, in the colour of the spool you pick.")}>
            <SlicePanel order={order} attachments={data.attachments} printers={data.printers} data={slices} t={t} locale={locale} />
          </StepCard>

          <StepCard id="price" state={states.price} summary={priceSummary}
            explain={t("The price comes from the slice's weight. The customer agrees and pays on their own page.")}>
            <WeightPricePanel order={order} quotes={quotes} pricing={data.pricing} budgetIdr={order.budgetIdr ?? Math.round((order.mandateMicro / 1e6) * data.idrPerUsdc)}
              minMarginPct={data.ownerRules.minMarginPct} busy={busy} act={act} attachments={data.attachments} agentMode={data.agent.mode}
              agreed={facts.agreed} agreementChanged={Boolean(order.agreement) && !data.agreementCurrent} paid={facts.paid} real={facts.real} />
          </StepCard>

          <StepCard id="print" state={states.print} summary={printSummary}
            explain={t("Start the print at the printer. Pause or stop it on My machines.")}>
            {collectStep === "print" && collectRows}
            <PrintPanel order={order} attachments={data.attachments} printers={data.printers} escrowState={escrow?.state ?? null} issueTexts={issueTexts} autoPrint={data.autoPrint}
              slices={slices} busy={busy} act={act} onChange={load} onJobs={setPrintJobs} />
          </StepCard>

          <StepCard id="qc" state={states.qc} summary={qcSummary}
            explain={t("Take the pieces off the bed, check them, then record the QC result.")}>
            {collectStep === "qc" && collectRows}
            <h3>{t("QC result")}{" "}
              <Info>{t("Needed before the customer's payment can be released. Add a QC photo in step 1 (Model); it does not replace this result.")}</Info>
            </h3>
            {/* A multi-run order: the parts of each run are kept; QC comes after the last one (a line only, no new block). */}
            {runsLeft && <p className="op-warn">{t("QC comes after the last run ({done} of {needed} printed).", { done: runsLeft.done, needed: runsLeft.needed })}</p>}
            <EvidenceList items={evidence.filter((e) => e.kind === "qc")} empty={t("No QC result yet.")} />
            {!evidenceOpen && <p className="muted">{t("Opens once a plan is chosen, after the price is agreed.")}</p>}
            <EvidenceForm kinds={["qc"]} disabled={busy || !evidenceOpen} button={t("Record QC result")}
              placeholder={t("e.g. All 5 checked: size, colour and finish OK")}
              onSubmit={(b) => act(`${base}/evidence`, b, t("Recorded {kind} evidence.", { kind: b.kind }))} />
            <p style={{ margin: "10px 0 0", fontSize: 13.5 }}><StepLink id="model">{t("Add a QC photo")}</StepLink></p>

            <details className="fold">
              <summary>{t("Add a production note")}</summary>
              <EvidenceList items={evidence.filter((e) => e.kind !== "qc")} empty={t("No evidence yet.")} />
              {!evidenceOpen && <p className="muted">{t("Opens once a plan is chosen, after the price is agreed.")}</p>}
              <EvidenceForm kinds={["log", "photo"]} disabled={busy || !evidenceOpen} button={t("Add evidence")}
                placeholder={t("e.g. Printed 4 legs, PLA, 6h")}
                onSubmit={(b) => act(`${base}/evidence`, b, t("Recorded {kind} evidence.", { kind: b.kind }))} />
            </details>
            {doneTasks.length > 0 && (
              <details className="fold">
                <summary>{t(doneTasks.length === 1 ? "{n} done task" : "{n} done tasks", { n: doneTasks.length })}</summary>
                <ul className="muted" style={{ margin: 0 }}>
                  {doneTasks.map((task) => <li key={task.id}>{oneLine(taskText(task, t, issueTexts))} ({task.doneBy})</li>)}
                </ul>
              </details>
            )}
          </StepCard>
          {/* "Part collected" only frees the bed, without a grant: it closes the printer's open collect task (which clears the
              bed with grant:false, src/lib/printer/actions.ts completeTask), else clear_bed. "Bed is empty" on My machines is
              what lets the agent print. */}
          <ConfirmDialog open={collecting !== null} title={t("Part collected from {printer}?", { printer: collecting?.name ?? "" })} confirmLabel={t("Part collected")} busy={busy}
            onConfirm={async (by) => {
              if (!collecting) return;
              const task = collectTask(collecting);
              if (task) await act(`/api/tasks/${task.id}`, { by }, t("Task marked done."));
              else await act(`/api/printers/${collecting.id}`, { action: "clear_bed", by }, t("{name}: bed marked empty.", { name: collecting.name }));
              setCollecting(null);
            }}
            onClose={() => setCollecting(null)}>
            <p style={{ margin: 0 }}>{t("This frees the printer for the next order. It does not start any print.")}</p>
          </ConfirmDialog>

          <StepCard id="handover" state={states.handover} summary={handoverSummary}
            explain={t("The customer accepts the pieces; then the payment is released.")}>
            <h3>{t("Acceptance")}</h3>
            {acceptance ? (
              <p><span className={`badge ${acceptance.accepted ? "ok" : "bad"}`}>{acceptance.accepted ? t("accepted") : t("rejected")}</span>{" "}
                {t("by {name}", { name: acceptance.by })}{acceptance.note && `: ${acceptance.note}`}</p>
            ) : <p className="muted">{t("A person decides this. Model output is never the release condition.")}</p>}
            <AcceptanceForm disabled={busy || order.status !== "EVIDENCE_SUBMITTED"}
              onSubmit={(b) => act(`${base}/acceptance`, b, b.accepted ? t("Order accepted.") : t("Order rejected."))} />

            <h3>{t("Payment")}{" "}
              <Info>{escrow
                ? t("The escrow release creates the payment intent, and the policy engine must approve it.")
                : t("Without an escrow this creates a payment intent only; no USDC is sent. Change the address or amount to see the policy block it.")}</Info>
            </h3>
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
          </StepCard>

          {/* Folded for tidiness only: the operator password opens all of it, as before. */}
          <details className="op-owner" id="owner-tools">
            <summary>
              <h2>{t("Owner & agent tools")}</h2>
              <span>{t("Price check, spec, owner's rules, quotes, agent log, plan vs actual")}</span>
            </summary>

            <AgreementPanel order={order} quotes={quotes} agreementCurrent={data.agreementCurrent} idrPerUsdc={data.idrPerUsdc} busy={busy} act={act} />

            <OwnerRules data={data} busy={busy} act={act} />

            <section className="card">
              <h2>{t("Production options and agent decision")}</h2>
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

            <ActualPanel key={order.actual?.at ?? "none"} order={order} busy={busy} act={act} />
          </details>
        </div>
      </div>
    </main>
  );
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

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
  const locale = useLocale();
  // The Chief's last thought is usually its summary word for word: show that text once.
  const summaries = new Set(log.filter((e) => e.tool === "agent_summary").map(outText));
  const rows = log.filter((e) => !(e.tool === "agent_thought" && summaries.has(outText(e))));
  return (
    <>
      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>{t("Decision log")}</h3>
      <ol className="log">
        {rows.map((e) => {
          const text = summarize(e, t, locale);
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

/** The step in plain words. Paragraphs (blank lines) after the first one only show in the fold. A message to the
 *  customer is quoted in the page's language, as the customer reads it. */
function summarize(e: AgentLogEntry, t: T, locale: Locale): string {
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
  if (e.tool === "customer_budget_raise") {
    return t("customer raised the budget to Rp{total} (quote {quote})", { total: Number(input.toIdr).toLocaleString("id-ID"), quote: String(input.quoteId) });
  }
  if (e.tool === "customer_colors") {
    const names = Array.isArray(input.colors) ? (input.colors as { name?: string; color?: string }[]).map((c) => t(c.name ?? nameOf(String(c.color)))) : [];
    return t("customer chose {choice}", { choice: [input.material ? String(input.material) : "", ...names].filter(Boolean).join(" · ") || t("none") });
  }
  if (e.tool === "start_print") return t("{name} started plate {plate} on {printer}", { name: String(input.by ?? ""), plate: String(input.plate ?? ""), printer: String(out?.printer ?? input.printerId ?? "") });
  if (e.tool === "printer_command") return `${String(input.kind ?? "")} · ${t("by {name}", { name: String(input.by ?? "") })}`;
  if (e.tool === "print_job") return t("sent to {printer}", { printer: String(out?.printer ?? "") });
  if (e.tool === "print_done_debug") return `${t("print marked done for testing (no real print)")} · ${t("by {name}", { name: String(input.by ?? "") })}`;
  if (e.tool === "remove_file") return t("{name} removed {file}", { name: String(input.by ?? ""), file: String(input.filename ?? "") });
  if (e.tool === "message_customer") {
    const said = { text: String(input.text ?? ""), textId: typeof input.textId === "string" ? input.textId : undefined };
    return t("wrote to the customer: “{text}”", { text: messageText(said, locale) });
  }
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

function EvidenceList({ items, empty }: { items: Evidence[]; empty: string }) {
  const t = useT();
  if (items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul>
      {items.map((e) => (
        <li key={e.id}><b>{t(e.kind.toUpperCase())}</b> {e.note} <span className="badge">{t(e.label)}</span>
          {e.attachmentId && <> <a href={`/api/files/${e.attachmentId}`} target="_blank" rel="noreferrer">{t("view photo")}</a></>}</li>
      ))}
    </ul>
  );
}

const EVIDENCE_KINDS = { log: "Production log", photo: "Photo note", qc: "QC result" } as const;

function EvidenceForm({ kinds, disabled, button, placeholder, onSubmit }: {
  kinds: (keyof typeof EVIDENCE_KINDS)[]; disabled: boolean; button: string; placeholder: string;
  onSubmit: (b: { kind: string; note: string; label: string }) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<string>(kinds[0]);
  const [note, setNote] = useState("");
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit({ kind, note, label: "manual" }); setNote(""); }}>
      <div className="row">
        {kinds.length > 1 && (
          <label style={{ flex: "0 0 140px" }}>{t("Type")}
            <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={disabled}>
              {kinds.map((k) => <option key={k} value={k}>{t(EVIDENCE_KINDS[k])}</option>)}
            </select>
          </label>
        )}
        <label style={{ flex: "1 1 240px" }}>{t("Note (entered by operator, labelled manual)")}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} disabled={disabled} required />
        </label>
      </div>
      <div><button disabled={disabled || !note.trim()}>{button}</button></div>
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
