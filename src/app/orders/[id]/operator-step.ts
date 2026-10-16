// The operator's order page as six steps (Model, Slice, Price, Print, Collect & QC, Hand-over & payment): which step the
// order is at, the one thing to do now, and which step cards are done. Pure (no React, no store): OrderView builds the
// facts from the data it already has. Read-only: nothing here allows or blocks an action; every gate stays on the server
// and in the panels.
import type { OrderLine } from "@/lib/printer/dispatch";
import { SLICER_NAME } from "@/lib/slice-rules";
import type { Attachment, Escrow, Evidence, OperatorTask, Order, OrderStatus, PrintJob, Printer, Quote, SliceJob, ThreeMfPlate } from "@/lib/types";
import type { ColorMode } from "@/lib/pricing";

export type StepId = "model" | "slice" | "price" | "print" | "qc" | "handover";
export type StepState = "done" | "now" | "wait" | "later";

export const STEPS: readonly StepId[] = ["model", "slice", "price", "print", "qc", "handover"];
export const STEP_N: Record<StepId, number> = { model: 1, slice: 2, price: 3, print: 4, qc: 5, handover: 6 };
export const STEP_TITLE: Record<StepId, string> = {
  model: "Model", slice: "Slice", price: "Price", print: "Print", qc: "Collect & QC", handover: "Hand-over & payment",
};

export interface StepFacts {
  status: OrderStatus;
  real: boolean;
  /** A design file that is not a STEP file. */
  hasModel: boolean;
  /** Design files, all STEP (cannot be sliced here). */
  onlyStep: boolean;
  /** A slice job queued or slicing. */
  sliceRunning: boolean;
  /** A sliced 3MF that is not an automatic weighing result (SliceJob.actor "system"). */
  printFile: boolean;
  /** Any sliced 3MF, or the order's slicerGrams or gramPricing. */
  weighed: boolean;
  /** gramPricing (or, once a plan is chosen, its chosen quote). */
  priced: boolean;
  /** CREATED: every quote is above the customer's budget (their page offers to raise it to Kesuni's price). */
  overBudget?: boolean;
  /** The Chief prices with the slicer's grams (Claude mode, slicerGrams without gramPricing). */
  chiefPricing: boolean;
  /** "claude": the Chief picks the plan by itself (heartbeat); "rules": a person presses Run agent. */
  agentMode?: "claude" | "rules";
  /** The customer approved this exact price and spec. */
  agreed: boolean;
  /** Escrow FUNDED or RELEASED. */
  paid: boolean;
  printing: { printer: string; printerId?: string; pct: number; leftMin: number | null; paused: boolean; staleMin: number | null } | null;
  /** A print job of this order on its way to a printer (queued, uploading, sent); nothing prints yet. */
  sending?: { printer: string | null } | null;
  /** Printed and finished, as the server's printFinished (src/lib/printer/actions.ts): every run printed and no failed
   *  print after the last one. The pieces wait for collection and QC. */
  printed: { printer: string | null; printerId?: string } | null;
  /** One run of several finished and its part is still on the bed: more runs to print before QC. */
  runDone?: { printer: string; printerId: string; done: number; needed: number } | null;
  /** The dispatcher's runs for this order (agent prints on or off), or null when unknown. */
  runs?: { done: number; needed: number } | null;
  qcDone: boolean;
  /** Agent prints on, with the dispatcher's runs for this order (runsNeeded follows src/lib/printer/autoprint.ts). */
  agent: { done: number; needed: number } | null;
  /** The dispatcher prints (or slices) this order by itself once a person confirms a bed; false when it waits for a
   *  reason only a person can solve (a file the agent may not print, a missing spool, ...). */
  agentPrints?: boolean;
}

export interface NextStep {
  step: StepId;
  n: number;
  state: "now" | "wait" | "done";
  /** English key (NOW_TEXTS). {left} and {ago} are minutes: the page writes them as a duration. */
  text: string;
  vars?: Record<string, string | number>;
  /** The action is not on a step card: on My machines (a printer's bed or state), or the escrow's release. */
  go?: "machines" | "payment";
  /** The printer on My machines (its #printer-<id> anchor). */
  printerId?: string;
}

// ---------- the texts ----------

const N = {
  N1: "Waiting for the model file. Upload it in step 1, or ask the customer for it.",
  N1b: "The model is a STEP file: export it as STL from the CAD program, then upload it in step 1.",
  N2a: "Weighing the model on the studio PC… Nothing to do now.",
  N2b: "Slicing on the studio PC… Nothing to do now.",
  N2c: "Slice the model to get its weight for the price.",
  N2d: "Slice the model in the customer's colour, ready to print.",
  N3a: "The Chief is making the price. Nothing to do now.",
  N3b: "Make the price from the slice.",
  N3c: "Price sent. Waiting for the customer to agree.",
  N3d: "Waiting for the customer to pay. Do not print yet.",
  // CREATED, priced, within the budget: no plan yet, so the customer does not see the price.
  N3e: "Price made. The Chief picks the plan next; then the customer sees the price. Nothing to do now.",
  N3f: "Price made. Press Run agent in step 3 so it picks the plan; then the customer sees the price.",
  N4a: "Ready to print. Go to the printer, check the bed is empty, then press Start print.",
  N4b: "The agent prints this order after someone confirms the bed on My machines.",
  N4c: "Printing on {printer} · {pct}% · about {left} left. Nothing to do until it ends.",
  N4c2: "Printing on {printer} · {pct}%. Nothing to do until it ends.",
  N4d: "Paused on {printer} at {pct}%. Check the printer on My machines.",
  N4e: "{printer} has not reported for {ago} (last: printing {pct}%). Check the printer.",
  N4f: "Sending the print to {printer}… Nothing to do now.",
  N4f2: "Sending the print to the printer… Nothing to do now.",
  N5a: "Print finished on {printer}. Take the pieces off, check them, then record the QC result.",
  N5a2: "Print finished. Take the pieces off, check them, then record the QC result.",
  N5b: "Print finished on {printer}. Take the pieces off, then confirm the bed on My machines so the agent prints the next one ({done} of {needed} done).",
  N6a: "QC done. Waiting for the customer to accept the pieces.",
  N6b: "The customer accepted. The payment is released next (step 6).",
  N6b2: "The customer accepted. Release the payment to Kesuni in Customer payment.",
  N6c: "Finished and paid. Nothing left to do.",
  N6d: "The customer rejected this order. The owner decides what happens next.",
} as const;

/** Every text nextStep can return (the i18n test checks each has an Indonesian entry). */
export const NOW_TEXTS: readonly string[] = Object.values(N);

/** The order's status in plain words (header, Order card). PLAN_CHOSEN comes before the customer agrees: statusWord. */
export const STATUS_WORDS: Record<OrderStatus, string> = {
  CREATED: "Being priced", PLAN_CHOSEN: "Price ready", IN_PRODUCTION: "In production",
  EVIDENCE_SUBMITTED: "QC done, waiting for the customer", ACCEPTED: "Accepted by the customer", REJECTED: "Rejected", PAID: "Paid",
};

/** The status word, with "Price agreed" only once the customer agreed (a plan is chosen before they do). */
export const statusWord = (status: OrderStatus, agreed: boolean): string =>
  status === "PLAN_CHOSEN" && agreed ? "Price agreed" : STATUS_WORDS[status];

// ---------- the decision ----------

const PRODUCTION: OrderStatus[] = ["PLAN_CHOSEN", "IN_PRODUCTION"];
/** QC is recorded (EVIDENCE_SUBMITTED) or later: steps 1 to 5 are behind the order. */
const PAST: OrderStatus[] = ["EVIDENCE_SUBMITTED", "ACCEPTED", "PAID", "REJECTED"];

/** The step the order is at and the one thing to do now. First match wins. */
export function nextStep(f: StepFacts): NextStep {
  const at = (step: StepId, state: NextStep["state"], text: string, vars?: NextStep["vars"], go?: Pick<NextStep, "go" | "printerId">): NextStep =>
    ({ step, n: STEP_N[step], state, text, ...(vars ? { vars } : {}), ...(go?.go ? { go: go.go } : {}), ...(go?.printerId ? { printerId: go.printerId } : {}) });
  if (f.status === "REJECTED") return at("handover", "done", N.N6d);
  if (f.status === "PAID") return at("handover", "done", N.N6c);
  // With an escrow the release is in the Customer payment card (beside the steps); without one, step 6 holds the payment.
  if (f.status === "ACCEPTED") return f.paid ? at("handover", "now", N.N6b2, undefined, { go: "payment" }) : at("handover", "now", N.N6b);
  if (f.status === "EVIDENCE_SUBMITTED") return at("handover", "wait", N.N6a);
  const p = f.printing;
  if (p) {
    const machine = { go: "machines" as const, printerId: p.printerId };
    if (p.paused) return at("print", "now", N.N4d, { printer: p.printer, pct: p.pct }, machine);
    if (p.staleMin !== null) return at("print", "now", N.N4e, { printer: p.printer, pct: p.pct, ago: p.staleMin }, machine);
    return p.leftMin !== null
      ? at("print", "wait", N.N4c, { printer: p.printer, pct: p.pct, left: p.leftMin })
      : at("print", "wait", N.N4c2, { printer: p.printer, pct: p.pct });
  }
  // A person's start (or the agent's) is on its way to the printer: the bridge uploads it, nothing to start again.
  if (f.sending) return f.sending.printer ? at("print", "wait", N.N4f, { printer: f.sending.printer }) : at("print", "wait", N.N4f2);
  if (f.printed && PRODUCTION.includes(f.status)) {
    const printer = f.printed.printer;
    return printer ? at("qc", "now", N.N5a, { printer }) : at("qc", "now", N.N5a2);
  }
  // One run of several finished: its part comes off, and the agent prints the next once a person confirms the bed. QC
  // comes after the last run. A person who prints the runs (or a run the agent cannot print) reads "Ready to print".
  const r = f.runDone;
  if (r && PRODUCTION.includes(f.status) && f.agentPrints) {
    return at("print", "now", N.N5b, { printer: r.printer, done: r.done, needed: r.needed }, { go: "machines", printerId: r.printerId });
  }
  if (!f.hasModel) return at("model", "now", f.onlyStep ? N.N1b : N.N1);
  if (f.status === "CREATED") {
    if (f.sliceRunning) return at("slice", "wait", N.N2a);
    if (f.priced && f.agreed) return at("price", "wait", N.N3d);
    // Over the budget: the customer's page offers to raise it to Kesuni's price.
    if (f.priced && f.overBudget) return at("price", "wait", N.N3c);
    // Within the budget: the customer sees the price once a plan is chosen.
    if (f.priced) return f.agentMode === "rules" ? at("price", "now", N.N3f) : at("price", "wait", N.N3e);
    if (f.chiefPricing) return at("price", "wait", N.N3a);
    if (f.weighed) return at("price", "now", N.N3b);
    return at("slice", "now", N.N2c);
  }
  // PLAN_CHOSEN or IN_PRODUCTION
  if (f.real && !f.paid) return at("price", "wait", N.N3d);
  if (f.sliceRunning) return at("slice", "wait", N.N2b);
  if (!f.printFile) return at("slice", "now", N.N2d);
  if (f.agent && f.agent.needed > f.agent.done && f.agentPrints) return at("print", "wait", N.N4b, undefined, { go: "machines" });
  return at("print", "now", N.N4a);
}

/** Done, now, waiting or later for each step card. The next step's card takes the banner's state unless it is done. */
export function stepStates(f: StepFacts, next: NextStep): Record<StepId, StepState> {
  const past = PAST.includes(f.status);
  const priceDone = past || (f.priced && f.status !== "CREATED" && (f.paid || !f.real));
  const done: Record<StepId, boolean> = {
    model: f.hasModel || past,
    // Before the payment the weighing slice is enough; after it, a file in the customer's colour is.
    slice: past || f.printFile || (f.weighed && !priceDone) || Boolean(f.printed),
    price: priceDone,
    // Every run printed (a multi-run order between runs is not), and nothing printing or on its way now.
    print: past || (Boolean(f.printed) && !f.printing && !f.sending),
    qc: past || f.qcDone,
    handover: f.status === "PAID" || f.status === "REJECTED",
  };
  const out = {} as Record<StepId, StepState>;
  for (const s of STEPS) out[s] = done[s] ? "done" : s === next.step ? next.state === "done" ? "done" : next.state : "later";
  return out;
}

// ---------- the facts, from what the order page already loaded ----------

const isStep = (a: Attachment) => /\.(step|stp)$/i.test(a.filename);
const isSliced3mf = (a: Attachment) => a.filename.toLowerCase().endsWith(".3mf") && Boolean(a.parsed3mf?.sliced);
const ON_PRINTER = ["PREPARE", "RUNNING", "PAUSE"];
const IN_FLIGHT: PrintJob["state"][] = ["queued", "uploading", "sent"];
const STALE_MS = 2 * 60 * 1000;
/** Dispatcher reasons that only wait for a person's bed confirmation or for the studio PC: the agent still prints. */
const AGENT_STILL_PRINTS = new Set([
  "Waiting for a person to confirm the bed on {printer}", "The bed of {printer} holds a finished print: a person empties it",
  "Confirm the bed on {printer} again: the last check is over 2 h old", "Run {n} of {needed} is on the printer",
  "Waiting for {printer}: {order} goes first", "Slicing on the studio PC…", "Waiting for the studio PC's slicer (is the bridge running?)",
]);

/**
 * The agent prints (or slices) this order by itself once a person confirms a bed: runs are left after those printed and
 * on their way, and the dispatcher plans a print or slice, or only waits for a bed confirmation or the studio PC. False
 * when it waits for something only a person solves (a file the agent may not print, a missing spool, a reprint task,
 * the payment), and when the runs on the printer are the last ones. Step 4's who-prints line and the banner use it.
 */
export function agentWillPrint(line: OrderLine | null | undefined): boolean {
  if (!line || line.runsDone + line.runsActive >= line.runsNeeded) return false;
  return line.action !== "wait" || AGENT_STILL_PRINTS.has(line.why.key);
}

/**
 * An automatic weighing's slice (it only priced the design, in any colour). A file the studio PC sliced counts as one
 * unless a finished slice job of a person or the agent made it: before the slices load, and when a slice started after
 * they loaded, the page never calls a weighing file ready to print (the warning only adds a tick).
 */
export function isWeighing(a: Attachment, slices: SliceJob[] | null): boolean {
  const job = slices?.find((j) => j.state === "done" && j.resultAttachmentId === a.id);
  return job ? job.actor === "system" : a.uploadedBy === SLICER_NAME;
}

/** The order's sliced 3MFs, newest first. */
export const slicedFiles = (attachments: Attachment[]): Attachment[] => attachments.filter(isSliced3mf).reverse();

/** The newest sliced 3MF that is not a weighing result, or undefined. */
export function printFileOf(attachments: Attachment[], slices: SliceJob[] | null): Attachment | undefined {
  return slicedFiles(attachments).find((a) => !isWeighing(a, slices));
}

/** The first plate with a weight of a sliced file. */
export const weighedPlate = (a: Attachment | undefined): ThreeMfPlate | undefined => a?.parsed3mf?.plates.find((p) => p.weightG != null);

/**
 * The newest sliced 3MF's grams per piece: its first plate with a weight, divided by the pieces on it (its objects, at
 * most the order's quantity). The source text is the one the price row on Colours & print used.
 */
export function sliceGrams(attachments: Attachment[], quantity: number):
  { gramsPerUnit: number; source: string; file: string; colorMode: ColorMode } | null {
  for (const file of slicedFiles(attachments)) {
    const plate = weighedPlate(file);
    if (!plate?.weightG) continue;
    const perPlate = plate.objects && plate.objects > 1 ? Math.max(1, Math.min(plate.objects, quantity)) : 1;
    return {
      gramsPerUnit: Math.round((plate.weightG / perPlate) * 100) / 100,
      source: `Bambu Studio sliced file ${file.filename}, plate ${plate.index}${perPlate > 1 ? `, ${perPlate} units on the plate` : ""}`,
      file: file.filename,
      colorMode: plate.filaments.length > 1 ? "multi" : "single",
    };
  }
  return null;
}

export interface FactsInput {
  order: Order;
  attachments: Attachment[];
  /** The order's slice jobs, or null while they have not loaded. */
  slices: SliceJob[] | null;
  printers: Printer[];
  tasks: OperatorTask[];
  evidence: Evidence[];
  escrow: Escrow | null;
  agreementCurrent: boolean;
  agentMode: "claude" | "rules";
  autoPrint?: { on: boolean; line: OrderLine | null } | null;
  /** The order's quotes (a price over the customer's budget waits for them, not for a plan). */
  quotes?: Quote[];
  /** The order's print jobs as step 4 last read them (a start on its way to the printer). */
  jobs?: PrintJob[];
  now: number;
}

export function stepFacts(i: FactsInput): StepFacts {
  const { order, attachments, printers, tasks } = i;
  const designs = attachments.filter((a) => a.kind === "design");
  const sliced = slicedFiles(attachments);
  const name = (id?: string) => printers.find((p) => p.id === id)?.name ?? null;
  const line = i.autoPrint?.line ?? null;

  const on = printers.find((p) => p.currentOrderId === order.id && ON_PRINTER.includes(p.snapshot?.state ?? ""));
  const s = on?.snapshot;
  const age = on?.lastSeen ? i.now - Date.parse(on.lastSeen) : 0;
  const printing = on && s ? {
    printer: on.name, printerId: on.id, pct: Math.floor(s.percent), leftMin: s.state === "RUNNING" ? s.remainingMin ?? null : null, paused: s.state === "PAUSE",
    staleMin: age > STALE_MS ? Math.round(age / 60_000) : null,
  } : null;
  // On its way: a job step 4 follows, or a run the dispatcher counts as active while no printer prints it yet.
  const flying = (i.jobs ?? []).find((j) => IN_FLIGHT.includes(j.state));
  const sending = !printing && (flying || (line?.runsActive ?? 0) > 0)
    ? { printer: name(flying?.printerId) ?? printers.find((p) => p.currentOrderId === order.id)?.name ?? null } : null;

  // Printed, as the server's printFinished: a failed or stopped print (a reprint task after the last collect task) is
  // not printed, whatever the bed or the runs say; a multi-run order is printed once every run is. The bed alone counts
  // for a print that finished (not one that failed), so do collect tasks, the dispatcher's finished runs, and a test
  // order a person marked printed.
  const bedTasks = tasks.filter((t) => t.kind === "collect_and_qc" || t.kind === "reprint");
  const failed = bedTasks.at(-1)?.kind === "reprint";
  const bed = printers.find((p) => p.bedOccupiedBy === order.id && p.snapshot?.state !== "FAILED");
  const collect = tasks.filter((t) => t.kind === "collect_and_qc");
  const openCollect = collect.filter((t) => t.status === "open").at(-1);
  const lastCollect = collect.filter((t) => t.printerId).at(-1);
  const runs = line ? { done: line.runsDone, needed: line.runsNeeded } : null;
  const runsLeft = Boolean(runs && runs.needed > 1 && runs.done < runs.needed);
  const ranOnce = Boolean(bed || openCollect || lastCollect || (runs?.done ?? 0) > 0);
  const finished = Boolean(order.printDoneDebug) || (!failed && ranOnce && !runsLeft);
  const printerId = bed?.id ?? openCollect?.printerId ?? lastCollect?.printerId;
  const printed = finished ? { printer: name(printerId), ...(printerId ? { printerId } : {}) } : null;
  const runDone = !order.printDoneDebug && !failed && runsLeft && runs && bed && bedTasks.at(-1)?.kind === "collect_and_qc"
    ? { printer: bed.name, printerId: bed.id, done: runs.done, needed: runs.needed } : null;

  const agent = i.autoPrint?.on && line ? { done: line.runsDone, needed: line.runsNeeded } : null;
  const quotes = i.quotes ?? [];
  return {
    status: order.status,
    real: order.label === "real",
    hasModel: designs.some((a) => !isStep(a)),
    onlyStep: designs.length > 0 && designs.every(isStep),
    // The dispatcher's line also knows of a slice the agent asked for after the page loaded its slices.
    sliceRunning: (i.slices ?? []).some((j) => j.state === "queued" || j.state === "slicing") || line?.action === "slicing",
    printFile: sliced.some((a) => !isWeighing(a, i.slices)),
    weighed: sliced.length > 0 || Boolean(order.slicerGrams) || Boolean(order.gramPricing),
    priced: Boolean(order.gramPricing) || (order.status !== "CREATED" && Boolean(order.chosenQuoteId)),
    overBudget: quotes.length > 0 && quotes.every((q) => q.priceMicro > order.mandateMicro),
    chiefPricing: Boolean(order.slicerGrams) && !order.gramPricing && i.agentMode === "claude",
    agentMode: i.agentMode,
    agreed: Boolean(order.agreement) && i.agreementCurrent,
    paid: i.escrow?.state === "FUNDED" || i.escrow?.state === "RELEASED",
    printing,
    sending,
    printed,
    runDone,
    runs,
    qcDone: i.evidence.some((e) => e.kind === "qc"),
    agent,
    agentPrints: Boolean(agent) && agentWillPrint(line),
  };
}
