import { describe, expect, it } from "vitest";
import type { OrderLine } from "@/lib/printer/dispatch";
import { SLICER_NAME } from "@/lib/slice-rules";
import type { Attachment, OperatorTask, Order, PrintJob, Printer, Quote, SliceJob, ThreeMfInfo } from "@/lib/types";
import { emptySnapshot } from "@/lib/printer/bambu";
import {
  agentWillPrint, NOW_TEXTS, nextStep, printFileOf, sliceGrams, statusWord, STEPS, stepFacts, stepStates, type StepFacts, type StepState,
} from "./operator-step";

// The order page's six steps: one case per situation the redesign names (ORD-090, 005, 006, 007, 008, 003 shapes), the
// cards' states, and the facts read from the order's data.
const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  status: "CREATED", real: true, hasModel: true, onlyStep: false, sliceRunning: false, printFile: false, weighed: false,
  priced: false, chiefPricing: false, agreed: false, paid: false, printing: null, printed: null, qcDone: false, agent: null, agentPrints: false, ...over,
});
const row = (f: StepFacts) => {
  const next = nextStep(f);
  const s = stepStates(f, next);
  return { now: `${next.step}:${next.state}:${next.text}`, cards: STEPS.map((x) => s[x]).join(" ") };
};
const cards = (...s: StepState[]) => s.join(" ");
const PAID: Partial<StepFacts> = { status: "PLAN_CHOSEN", weighed: true, priced: true, agreed: true, paid: true };

describe("the Now line and the step cards", () => {
  it("a new order without a model, and one with only a STEP file", () => {
    expect(row(facts({ hasModel: false }))).toEqual({
      now: "model:now:Waiting for the model file. Upload it in step 1, or ask the customer for it.", cards: cards("now", "later", "later", "later", "later", "later"),
    });
    expect(nextStep(facts({ hasModel: false, onlyStep: true })).text).toMatch(/^The model is a STEP file/);
  });

  it("ORD-090: a new STL, not weighed; then weighing; then grams known", () => {
    expect(row(facts())).toEqual({ now: "slice:now:Slice the model to get its weight for the price.", cards: cards("done", "now", "later", "later", "later", "later") });
    expect(row(facts({ sliceRunning: true }))).toEqual({
      now: "slice:wait:Weighing the model on the studio PC… Nothing to do now.", cards: cards("done", "wait", "later", "later", "later", "later"),
    });
    expect(row(facts({ weighed: true }))).toEqual({ now: "price:now:Make the price from the slice.", cards: cards("done", "done", "now", "later", "later", "later") });
  });

  it("the Chief prices; priced without a plan; ORD-005: over the budget, waiting for the customer; agreed, not paid", () => {
    expect(row(facts({ weighed: true, chiefPricing: true }))).toEqual({
      now: "price:wait:The Chief is making the price. Nothing to do now.", cards: cards("done", "done", "wait", "later", "later", "later"),
    });
    // Within the budget, no plan yet: the customer does not see the price until the agent picks the plan.
    expect(row(facts({ weighed: true, priced: true, agentMode: "claude" }))).toEqual({
      now: "price:wait:Price made. The Chief picks the plan next; then the customer sees the price. Nothing to do now.",
      cards: cards("done", "done", "wait", "later", "later", "later"),
    });
    expect(row(facts({ weighed: true, priced: true, agentMode: "rules" }))).toEqual({
      now: "price:now:Price made. Press Run agent in step 3 so it picks the plan; then the customer sees the price.",
      cards: cards("done", "done", "now", "later", "later", "later"),
    });
    // Over the budget: the customer's page offers to raise it.
    expect(row(facts({ weighed: true, priced: true, overBudget: true }))).toEqual({
      now: "price:wait:Price sent. Waiting for the customer to agree.", cards: cards("done", "done", "wait", "later", "later", "later"),
    });
    expect(nextStep(facts({ weighed: true, priced: true, agreed: true })).text).toBe("Waiting for the customer to pay. Do not print yet.");
  });

  it("the status in words: a plan is chosen before the customer agrees", () => {
    expect(statusWord("PLAN_CHOSEN", false)).toBe("Price ready");
    expect(statusWord("PLAN_CHOSEN", true)).toBe("Price agreed");
    expect(statusWord("CREATED", true)).toBe("Being priced");
  });

  it("ORD-006: plan chosen, real, unpaid: do not print yet", () => {
    expect(row(facts({ status: "PLAN_CHOSEN", weighed: true, priced: true, agreed: true }))).toEqual({
      now: "price:wait:Waiting for the customer to pay. Do not print yet.", cards: cards("done", "done", "wait", "later", "later", "later"),
    });
  });

  it("paid with only the weighing slice: slice in the customer's colour; slicing; then a person or the agent prints", () => {
    expect(row(facts(PAID))).toEqual({
      now: "slice:now:Slice the model in the customer's colour, ready to print.", cards: cards("done", "now", "done", "later", "later", "later"),
    });
    expect(nextStep(facts({ ...PAID, sliceRunning: true })).text).toBe("Slicing on the studio PC… Nothing to do now.");
    expect(row(facts({ ...PAID, printFile: true }))).toEqual({
      now: "print:now:Ready to print. Go to the printer, check the bed is empty, then press Start print.", cards: cards("done", "done", "done", "now", "later", "later"),
    });
    // A real order printed only by the agent: one run per piece (src/lib/printer/autoprint.ts).
    expect(row(facts({ ...PAID, printFile: true, agent: { done: 0, needed: 5 }, agentPrints: true }))).toEqual({
      now: "print:wait:The agent prints this order after someone confirms the bed on My machines.", cards: cards("done", "done", "done", "wait", "later", "later"),
    });
    // The bed is confirmed on My machines: the banner links there too.
    expect(nextStep(facts({ ...PAID, printFile: true, agent: { done: 0, needed: 5 }, agentPrints: true })).go).toBe("machines");
    // The agent is on but cannot print this file (or waits for something only a person solves): a person prints.
    expect(nextStep(facts({ ...PAID, printFile: true, agent: { done: 0, needed: 5 }, agentPrints: false })).step).toBe("print");
    expect(nextStep(facts({ ...PAID, printFile: true, agent: { done: 0, needed: 5 }, agentPrints: false })).state).toBe("now");
    // A test order needs no payment.
    expect(nextStep(facts({ status: "PLAN_CHOSEN", real: false, weighed: true, priced: true })).text).toBe("Slice the model in the customer's colour, ready to print.");
  });

  it("ORD-008: printing, live, stale or paused", () => {
    const printing = { printer: "A1 Combo #2", pct: 42, leftMin: 35, paused: false, staleMin: null };
    expect(nextStep(facts({ ...PAID, printFile: true, printing }))).toEqual({
      step: "print", n: 4, state: "wait", text: "Printing on {printer} · {pct}% · about {left} left. Nothing to do until it ends.", vars: { printer: "A1 Combo #2", pct: 42, left: 35 },
    });
    expect(row(facts({ ...PAID, printFile: true, printing })).cards).toBe(cards("done", "done", "done", "wait", "later", "later"));
    expect(nextStep(facts({ ...PAID, printing: { ...printing, leftMin: null } })).text).toBe("Printing on {printer} · {pct}%. Nothing to do until it ends.");
    const stale = nextStep(facts({ ...PAID, printFile: true, printing: { ...printing, printerId: "a1-2", staleMin: 120 } }));
    expect([stale.state, stale.text, stale.vars]).toEqual(["now", "{printer} has not reported for {ago} (last: printing {pct}%). Check the printer.", { printer: "A1 Combo #2", pct: 42, ago: 120 }]);
    // The printer is checked on My machines: the banner's button goes to it.
    expect([stale.go, stale.printerId]).toEqual(["machines", "a1-2"]);
    expect(row(facts({ ...PAID, printFile: true, printing: { ...printing, staleMin: 120 } })).cards).toBe(cards("done", "done", "done", "now", "later", "later"));
    const paused = nextStep(facts({ ...PAID, printing: { ...printing, paused: true } }));
    expect([paused.text, paused.go]).toEqual(["Paused on {printer} at {pct}%. Check the printer on My machines.", "machines"]);
    // A second run printing after the first: step 4 is not done while it prints.
    expect(row(facts({ ...PAID, printFile: true, printing, printed: { printer: "A1 Combo #2" } })).cards).toBe(cards("done", "done", "done", "wait", "later", "later"));
  });

  it("a start on its way to the printer: nothing to do, never Start print again", () => {
    expect(row(facts({ ...PAID, printFile: true, sending: { printer: "A1 Combo #1" } }))).toEqual({
      now: "print:wait:Sending the print to {printer}… Nothing to do now.", cards: cards("done", "done", "done", "wait", "later", "later"),
    });
    // Also with agent prints on (the dispatcher counts the run as on the printer), and after an earlier print.
    expect(nextStep(facts({ ...PAID, printFile: true, sending: { printer: null }, agent: { done: 0, needed: 1 }, agentPrints: false })).text)
      .toBe("Sending the print to the printer… Nothing to do now.");
    expect(row(facts({ ...PAID, printFile: true, sending: { printer: "A1 Combo #1" }, printed: { printer: "A1 Combo #1" } })).cards)
      .toBe(cards("done", "done", "done", "wait", "later", "later"));
  });

  it("ORD-007: printed, no QC", () => {
    expect(row(facts({ ...PAID, printFile: true, printed: { printer: "A1 Combo #1" } }))).toEqual({
      now: "qc:now:Print finished on {printer}. Take the pieces off, check them, then record the QC result.", cards: cards("done", "done", "done", "done", "now", "later"),
    });
    expect(nextStep(facts({ ...PAID, printed: { printer: null } })).text).toBe("Print finished. Take the pieces off, check them, then record the QC result.");
    // Printed from the weighing slice only (the real ORD-007): step 2 is behind the order, not Later.
    expect(row(facts({ ...PAID, printed: { printer: "A1 Combo #3" } })).cards).toBe(cards("done", "done", "done", "done", "now", "later"));
    // A person printed it: one run covers the whole quantity (autoprint.ts), so 1 of 1 and no next run.
    expect(nextStep(facts({ ...PAID, printFile: true, printed: { printer: "A1 Combo #1" }, agent: { done: 1, needed: 1 } })).text).toMatch(/^Print finished on \{printer\}\. Take the pieces off, check them/);
  });

  it("a multi-run order between runs: step 4 is not done and QC is not asked for; the agent prints the next one", () => {
    const between = { ...PAID, printFile: true, runDone: { printer: "A1 Combo #1", printerId: "a1", done: 1, needed: 3 }, runs: { done: 1, needed: 3 }, agent: { done: 1, needed: 3 } };
    const more = nextStep(facts({ ...between, agentPrints: true }));
    expect([more.step, more.state, more.vars, more.go, more.printerId]).toEqual(["print", "now", { printer: "A1 Combo #1", done: 1, needed: 3 }, "machines", "a1"]);
    expect(more.text).toMatch(/so the agent prints the next one \(\{done\} of \{needed\} done\)/);
    expect(row(facts({ ...between, agentPrints: true })).cards).toBe(cards("done", "done", "done", "now", "later", "later"));
    // The agent cannot print the next run (or prints are off): a person starts it; never "agent prints the next one".
    expect(row(facts({ ...between, agentPrints: false }))).toEqual({
      now: "print:now:Ready to print. Go to the printer, check the bed is empty, then press Start print.", cards: cards("done", "done", "done", "now", "later", "later"),
    });
    expect(nextStep(facts({ ...between, agent: null, agentPrints: false })).text).toMatch(/^Ready to print\./);
  });

  it("the payment's release is in Customer payment when there is an escrow", () => {
    const accepted = nextStep(facts({ ...PAID, status: "ACCEPTED", qcDone: true }));
    expect([accepted.step, accepted.state, accepted.text, accepted.go]).toEqual(["handover", "now", "The customer accepted. Release the payment to Kesuni in Customer payment.", "payment"]);
    // Without an escrow (an old demo order): step 6 holds the payment.
    const local = nextStep(facts({ ...PAID, status: "ACCEPTED", paid: false, qcDone: true }));
    expect([local.text, local.go]).toEqual(["The customer accepted. The payment is released next (step 6).", undefined]);
  });

  it("QC done; accepted; ORD-003 paid; rejected", () => {
    expect(row(facts({ ...PAID, status: "EVIDENCE_SUBMITTED", printFile: true, printed: { printer: null }, qcDone: true }))).toEqual({
      now: "handover:wait:QC done. Waiting for the customer to accept the pieces.", cards: cards("done", "done", "done", "done", "done", "wait"),
    });
    expect(row(facts({ ...PAID, status: "ACCEPTED", qcDone: true })).cards).toBe(cards("done", "done", "done", "done", "done", "now"));
    // An old demo order with no files still reads as finished.
    expect(row(facts({ status: "PAID", hasModel: false, paid: true }))).toEqual({
      now: "handover:done:Finished and paid. Nothing left to do.", cards: cards("done", "done", "done", "done", "done", "done"),
    });
    expect(row(facts({ status: "REJECTED", qcDone: true }))).toEqual({
      now: "handover:done:The customer rejected this order. The owner decides what happens next.", cards: cards("done", "done", "done", "done", "done", "done"),
    });
  });

  it("every text it can return is listed for the translation test", () => {
    const seen = new Set<string>();
    const all: Partial<StepFacts>[] = [
      { hasModel: false }, { hasModel: false, onlyStep: true }, {}, { sliceRunning: true }, { weighed: true }, { weighed: true, chiefPricing: true },
      { priced: true }, { priced: true, agentMode: "rules" }, { priced: true, overBudget: true }, { priced: true, agreed: true },
      PAID, { ...PAID, sliceRunning: true }, { ...PAID, printFile: true },
      { ...PAID, printFile: true, agent: { done: 0, needed: 2 }, agentPrints: true },
      { ...PAID, printing: { printer: "p", pct: 1, leftMin: 3, paused: false, staleMin: null } }, { ...PAID, printing: { printer: "p", pct: 1, leftMin: null, paused: false, staleMin: null } },
      { ...PAID, printing: { printer: "p", pct: 1, leftMin: null, paused: true, staleMin: null } }, { ...PAID, printing: { printer: "p", pct: 1, leftMin: null, paused: false, staleMin: 9 } },
      { ...PAID, sending: { printer: "p" } }, { ...PAID, sending: { printer: null } },
      { ...PAID, printed: { printer: "p" } }, { ...PAID, printed: { printer: null } },
      { ...PAID, runDone: { printer: "p", printerId: "a1", done: 1, needed: 2 }, agentPrints: true },
      { status: "EVIDENCE_SUBMITTED" }, { status: "ACCEPTED" }, { status: "ACCEPTED", paid: true }, { status: "PAID" }, { status: "REJECTED" },
    ];
    for (const f of all) seen.add(nextStep(facts(f)).text);
    expect([...seen].sort()).toEqual([...NOW_TEXTS].sort());
  });
});

// ---------- the facts, from the order page's data ----------
const AT = new Date("2026-10-17T03:00:00Z").getTime();
const sliced = (plates: ThreeMfInfo["plates"]): ThreeMfInfo => ({ sliced: true, printerModel: "Bambu Lab A1", nozzle: "0.4", plates });
const plate = (weightG: number, objects = 1) => ({ index: 1, predictionSec: 1800, weightG, objects, filaments: [{ id: 1, type: "PLA", color: "#FEC600", usedG: weightG }] });
const att = (id: string, filename: string, over: Partial<Attachment> = {}): Attachment => ({
  id, orderId: "ORD-9", kind: "design", filename, size: 1, mime: "model/3mf", uploadedBy: SLICER_NAME, at: "2026-10-17T01:00:00Z", storageKey: id, ...over,
});
const order = (over: Partial<Order> = {}): Order => ({
  id: "ORD-9", jobId: "J", product: "Clip", quantity: 5, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 1, status: "PLAN_CHOSEN", label: "real", ...over,
});
const sliceJob = (resultAttachmentId: string, actor: SliceJob["actor"]): SliceJob => ({
  id: `SJ-${resultAttachmentId}`, orderId: "ORD-9", attachmentId: "F-stl", sourceName: "Clip.stl", mode: "mesh", printerId: "a1", tray: 0, material: "PLA",
  color: "#FEC600", quality: "standard", infillPct: 15, supports: "auto", key: "k", state: "done", actor, by: "x", createdAt: "", updatedAt: "", resultAttachmentId,
});
const stl = att("F-stl", "Clip.stl", { uploadedBy: "Aini", mime: "model/stl" });
const weigh = att("F-w", "Clip.gcode.3mf", { parsed3mf: sliced([plate(55.29)]) });
const toPrint = att("F-p", "Clip.gcode.3mf", { parsed3mf: sliced([plate(11.2)]), at: "2026-10-17T02:00:00Z" });
const printer = (over: Partial<Printer> = {}): Printer => ({ id: "a1", name: "A1 Combo #1", lastSeen: new Date(AT).toISOString(), ...over });
const input = (over: Partial<Parameters<typeof stepFacts>[0]> = {}): Parameters<typeof stepFacts>[0] => ({
  order: order(), attachments: [stl], slices: [], printers: [], tasks: [], evidence: [], escrow: null, agreementCurrent: false, agentMode: "claude",
  autoPrint: null, now: AT, ...over,
});
const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  orderId: "ORD-9", why: { key: "Waiting for a person to confirm the bed on {printer}", vars: { printer: "A1 Combo #1" } }, action: "wait",
  runsDone: 0, runsNeeded: 5, runsActive: 0, ...over,
});

describe("the facts", () => {
  it("a weighing result is never the file to print; until the slices load, the studio PC's files count as weighing", () => {
    const slices = [sliceJob("F-w", "system"), sliceJob("F-p", "person")];
    expect(stepFacts(input({ attachments: [stl, weigh], slices: [sliceJob("F-w", "system")] }))).toMatchObject({ printFile: false, weighed: true });
    expect(stepFacts(input({ attachments: [stl, weigh, toPrint], slices }))).toMatchObject({ printFile: true });
    expect(stepFacts(input({ attachments: [stl, weigh, toPrint], slices: null }))).toMatchObject({ printFile: false });
    expect(printFileOf([stl, toPrint, weigh], slices)?.id).toBe("F-p");
    // A .gcode.3mf a person uploaded is a file to print.
    expect(stepFacts(input({ attachments: [att("F-u", "mine.gcode.3mf", { uploadedBy: "Khelda", parsed3mf: sliced([plate(9)]) })], slices: null }))).toMatchObject({ printFile: true, hasModel: true });
    // A weighing that started after the slices loaded (the customer added the design later): the studio PC's file with
    // no known slice job counts as a weighing, never as the file to print.
    const later = att("F-later", "Clip.gcode.3mf", { parsed3mf: sliced([plate(55)]), at: "2026-10-17T02:30:00Z" });
    expect(printFileOf([stl, toPrint, later], [sliceJob("F-p", "person")])?.id).toBe("F-p");
    expect(stepFacts(input({ attachments: [stl, later], slices: [sliceJob("F-p", "person")] })).printFile).toBe(false);
  });

  it("a slice the agent asked for after the page loaded its slices: the dispatcher's line says it is slicing", () => {
    expect(stepFacts(input({ autoPrint: { on: true, line: line({ action: "slicing", why: { key: "Slicing on the studio PC…" } }) } })).sliceRunning).toBe(true);
  });

  it("only STEP files: no model yet", () => {
    expect(stepFacts(input({ attachments: [att("F-s", "Bracket.step", { uploadedBy: "Aini" })] }))).toMatchObject({ hasModel: false, onlyStep: true });
    expect(stepFacts(input({ attachments: [] }))).toMatchObject({ hasModel: false, onlyStep: false });
  });

  it("printing: live, paused, or a printer that stopped reporting", () => {
    const run = (snap: Partial<NonNullable<Printer["snapshot"]>>, lastSeen = new Date(AT).toISOString()) =>
      stepFacts(input({ printers: [printer({ currentOrderId: "ORD-9", lastSeen, snapshot: { ...emptySnapshot(lastSeen), ...snap } })] })).printing;
    expect(run({ state: "RUNNING", percent: 42.7, remainingMin: 35 })).toEqual({ printer: "A1 Combo #1", printerId: "a1", pct: 42, leftMin: 35, paused: false, staleMin: null });
    expect(run({ state: "PAUSE", percent: 10, remainingMin: 50 })).toMatchObject({ paused: true, leftMin: null });
    expect(run({ state: "RUNNING", percent: 42, remainingMin: 35 }, new Date(AT - 2 * 3600_000).toISOString())).toMatchObject({ staleMin: 120 });
    expect(run({ state: "IDLE", percent: 0 })).toBeNull();
  });

  const task = (over: Partial<OperatorTask> = {}): OperatorTask => ({
    id: "T-1", orderId: "ORD-9", kind: "collect_and_qc", printerId: "a1", text: "Collect", status: "open", createdBy: "agent", at: "", ...over,
  });

  it("printed: the part on a bed, a collect task, a finished run, or a test order marked printed", () => {
    expect(stepFacts(input({ printers: [printer({ bedOccupiedBy: "ORD-9" })] })).printed).toEqual({ printer: "A1 Combo #1", printerId: "a1" });
    // The part was collected and the task closed: still printed (the page must not ask for the print again).
    expect(stepFacts(input({ printers: [printer()], tasks: [task({ status: "done" })] })).printed).toEqual({ printer: "A1 Combo #1", printerId: "a1" });
    expect(stepFacts(input({ autoPrint: { on: false, line: line({ runsDone: 1, runsNeeded: 1 }) } })).printed).toEqual({ printer: null });
    expect(stepFacts(input({ order: order({ label: "simulated", printDoneDebug: { by: "Khelda", at: "" } }) })).printed).toEqual({ printer: null });
    expect(stepFacts(input()).printed).toBeNull();
  });

  it("a failed or stopped print is not printed (as printFinished): the reprint task after the last collect task decides", () => {
    const failedBed = printer({ bedOccupiedBy: "ORD-9", snapshot: { ...emptySnapshot(new Date(AT).toISOString()), state: "FAILED" } });
    const reprint = task({ id: "T-2", kind: "reprint", text: "Print failed on A1 Combo #1" });
    const f = stepFacts(input({ printers: [failedBed], tasks: [reprint], escrow: { state: "FUNDED" } as Parameters<typeof stepFacts>[0]["escrow"],
      attachments: [stl, att("F-u", "mine.gcode.3mf", { uploadedBy: "Khelda", parsed3mf: sliced([plate(9)]) })] }));
    expect([f.printed, f.runDone]).toEqual([null, null]);
    // The banner does not ask for QC: a person prints again (the open reprint task shows in the banner).
    expect(nextStep(f).text).toMatch(/^Ready to print\./);
    expect(stepStates(f, nextStep(f)).print).toBe("now");
    // An earlier print was collected, then the next one failed: still not printed, also with a finished run counted.
    expect(stepFacts(input({ printers: [printer({ bedOccupiedBy: "ORD-9" })], tasks: [task({ status: "done" }), reprint],
      autoPrint: { on: true, line: line({ runsDone: 1, runsNeeded: 1 }) } })).printed).toBeNull();
    // The reprint was printed and finished: printed again.
    expect(stepFacts(input({ printers: [printer({ bedOccupiedBy: "ORD-9" })], tasks: [reprint, task({ id: "T-3" })] })).printed).toEqual({ printer: "A1 Combo #1", printerId: "a1" });
    // A bed whose printer reports FAILED, with no task yet, is no finished print either.
    expect(stepFacts(input({ printers: [failedBed] })).printed).toBeNull();
  });

  it("a multi-run order: printed only after the last run; between runs the part on the bed is one run done", () => {
    const bed = printer({ bedOccupiedBy: "ORD-9", snapshot: { ...emptySnapshot(new Date(AT).toISOString()), state: "FINISH" } });
    const run1 = task({ text: "Run 1 of 3 finished on A1 Combo #1" });
    const f = stepFacts(input({ printers: [bed], tasks: [run1], autoPrint: { on: true, line: line({ runsDone: 1, runsNeeded: 3,
      why: { key: "The bed of {printer} holds a finished print: a person empties it", vars: { printer: "A1 Combo #1" } } }) } }));
    expect(f).toMatchObject({ printed: null, runDone: { printer: "A1 Combo #1", printerId: "a1", done: 1, needed: 3 }, runs: { done: 1, needed: 3 }, agentPrints: true });
    // The part was collected: no run on a bed, nothing printed yet; the agent waits for a bed confirmation.
    const collected = stepFacts(input({ printers: [printer()], tasks: [{ ...run1, status: "done" }], autoPrint: { on: true, line: line({ runsDone: 1, runsNeeded: 3 }) } }));
    expect([collected.printed, collected.runDone]).toEqual([null, null]);
    // Every run printed: printed.
    expect(stepFacts(input({ printers: [bed], tasks: [run1, task({ id: "T-3" })], autoPrint: { on: true, line: line({ runsDone: 3, runsNeeded: 3 }) } })).printed)
      .toEqual({ printer: "A1 Combo #1", printerId: "a1" });
  });

  it("a print on its way: a job step 4 follows, or a run the dispatcher counts as active", () => {
    const job = { id: "PJ-1", orderId: "ORD-9", printerId: "a1", state: "uploading" } as PrintJob;
    expect(stepFacts(input({ printers: [printer({ currentOrderId: "ORD-9", snapshot: { ...emptySnapshot(new Date(AT).toISOString()), state: "IDLE" } })], jobs: [job] })).sending)
      .toEqual({ printer: "A1 Combo #1" });
    expect(stepFacts(input({ printers: [printer({ currentOrderId: "ORD-9" })], autoPrint: { on: true, line: line({ runsActive: 1 }) } })).sending).toEqual({ printer: "A1 Combo #1" });
    expect(stepFacts(input({ jobs: [{ ...job, state: "failed" }] })).sending).toBeNull();
    // Printing already: the printer's state says so instead.
    expect(stepFacts(input({ printers: [printer({ currentOrderId: "ORD-9", snapshot: { ...emptySnapshot(new Date(AT).toISOString()), state: "RUNNING", percent: 3 } })], jobs: [job] })).sending)
      .toBeNull();
  });

  it("the agent: its runs from the dispatcher, and whether it prints by itself", () => {
    expect(stepFacts(input({ autoPrint: { on: false, line: line() } })).agent).toBeNull();
    expect(stepFacts(input({ autoPrint: { on: true, line: line() } }))).toMatchObject({ agent: { done: 0, needed: 5 }, agentPrints: true });
    expect(stepFacts(input({ autoPrint: { on: true, line: line({ action: "print" }) } })).agentPrints).toBe(true);
    const personFile = line({ why: { key: "The agent prints only files the studio PC sliced from an STL or OBJ: a person prints this one" } });
    expect(stepFacts(input({ autoPrint: { on: true, line: personFile } })).agentPrints).toBe(false);
    // The run on the printer is the last one (a person's start of a 1-run order): the agent prints no more.
    const onPrinter = line({ runsNeeded: 1, runsActive: 1, why: { key: "Run {n} of {needed} is on the printer", vars: { n: 1, needed: 1 } } });
    expect(agentWillPrint(onPrinter)).toBe(false);
    expect(agentWillPrint(line({ runsDone: 1, runsActive: 1, why: { key: "Run {n} of {needed} is on the printer", vars: { n: 2, needed: 5 } } }))).toBe(true);
    expect(agentWillPrint(line({ why: { key: "A print failed: a person decides on a reprint (close its task)" } }))).toBe(false);
    expect(agentWillPrint(null)).toBe(false);
  });

  it("over the budget: every quote is above the customer's budget", () => {
    const q = (priceMicro: number) => ({ id: `Q-${priceMicro}`, orderId: "ORD-9", vendorId: "own", priceMicro, etaHours: 4, source: "own" }) as Quote;
    const created = order({ status: "CREATED", mandateMicro: 10 });
    expect(stepFacts(input({ order: created, quotes: [q(11)] })).overBudget).toBe(true);
    expect(stepFacts(input({ order: created, quotes: [q(11), q(9)] })).overBudget).toBe(false);
    expect(stepFacts(input({ order: created, quotes: [] })).overBudget).toBe(false);
  });

  it("price, agreement, payment and the Chief", () => {
    const gp = { gramsPerUnit: 11, quantity: 5, pricePerGramIdr: 1, costPerGramIdr: 1, unitPriceIdr: 1, totalIdr: 5, costIdr: 1, source: "s", quoteId: "Q", by: "agent" as const, at: "" };
    const sg = { gramsPerUnit: 11, source: "s", by: "slicer", at: "" };
    expect(stepFacts(input({ order: order({ status: "CREATED", slicerGrams: sg }) }))).toMatchObject({ chiefPricing: true, weighed: true, priced: false });
    expect(stepFacts(input({ order: order({ status: "CREATED", slicerGrams: sg }), agentMode: "rules" })).chiefPricing).toBe(false);
    expect(stepFacts(input({ order: order({ gramPricing: gp, agreement: { version: 1, hash: "h", by: "Aini", at: "" } as Order["agreement"] }), agreementCurrent: true })))
      .toMatchObject({ priced: true, agreed: true, chiefPricing: false });
    const escrow = (state: "FUNDED" | "RELEASED" | "AWAITING_DEPOSIT") => ({ state } as Parameters<typeof stepFacts>[0]["escrow"]);
    expect(stepFacts(input({ escrow: escrow("FUNDED") })).paid).toBe(true);
    expect(stepFacts(input({ escrow: escrow("RELEASED") })).paid).toBe(true);
    expect(stepFacts(input({ escrow: escrow("AWAITING_DEPOSIT") })).paid).toBe(false);
  });

  it("the slice's grams per piece: the newest sliced file, divided by the pieces on its plate", () => {
    expect(sliceGrams([stl, weigh], 5)).toEqual({ gramsPerUnit: 55.29, source: "Bambu Studio sliced file Clip.gcode.3mf, plate 1", file: "Clip.gcode.3mf", colorMode: "single" });
    const four = att("F-4", "Four.gcode.3mf", { parsed3mf: sliced([plate(40, 4)]) });
    expect(sliceGrams([four], 3)).toMatchObject({ gramsPerUnit: 13.33, source: "Bambu Studio sliced file Four.gcode.3mf, plate 1, 3 units on the plate" });
    expect(sliceGrams([stl], 1)).toBeNull();
  });
});
