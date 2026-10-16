// The Chief's proactive rounds (heartbeat). Every KESUNI_HEARTBEAT_SECONDS (default 120, 0 = off) cheap code
// checks look at active orders and printers. What code can handle is handled for free: sync a pending payment,
// open an operator task. Claude is woken only when an order needs a decision, at most 3 orders per beat, and
// never again for the same unchanged problem: each finding has a stable key, and keys already handled are kept
// in the meta table until the problem goes away (then it may fire again later). Last, once per Jakarta day after
// KESUNI_DAILY_REVIEW_HOUR, it writes the Chief's daily review for the owner (daily-review.ts). Never throws.
// Also a free code action each beat: up to 5 COMPLETE escrow transfers are checked on Arc (arc-verify.ts, read-only).
// And the agent dispatcher (src/lib/printer/dispatch.ts, code, no Claude) runs on each beat before any wake: when a
// person turned agent prints on, a paid order waiting for a printer is the dispatcher's job, not a reason to wake Claude.
import * as store from "../store";
import { deadlineEnd } from "../owner-rules";
import { refreshPayment } from "../customer";
import { createTask, notReadyReason, printFinished } from "../printer/actions";
import { agentMode, runChief, type ChiefRun } from "./chief";
import { maybeRunDailyReview } from "./daily-review";
import { agentText } from "./tools";
import { openArcMismatchTask, verifyBatch } from "../arc-verify";
import { microToUsdc } from "../policy";
import { planDispatch, safeDispatch } from "../printer/dispatch";
import { whyText } from "../printer/autoprint-rules";
import { autoWeighState } from "../slicing";
import type { ChainTx, OperatorTask, Order } from "../types";

export type FindingKind =
  | "needs_price" | "needs_plan" | "payment_pending" | "start_production" | "deadline_risk" | "printer_offline" | "task_stale";

export interface Finding {
  key: string;          // the same for the same unchanged problem
  orderId?: string;
  kind: FindingKind;
  text: string;         // simple English, for people
  wake: boolean;        // needs the Chief (Claude) to decide
  /** Code action: open this operator task (text = the finding's text) when the problem first appears. */
  task?: { kind: OperatorTask["kind"]; printerId?: string };
}

export type WakeOutcome = ChiefRun["outcome"] | "needs_claude" | "deferred";
export interface HeartbeatSummary {
  at: string;
  trigger: "timer" | "button";
  mode: "claude" | "rules";
  findings: (Finding & { since: string; isNew: boolean })[];
  woke: { orderId: string; outcome: WakeOutcome; summary?: string }[];
  actions: string[];
  errors: string[];
  durationMs: number;
}
export type HeartbeatResult = { ok: true; summary: HeartbeatSummary } | { ok: false; busy: true; error: string };

const HOUR = 3_600_000;
const MAX_WAKES = 3;
export const ARC_CHECKS_PER_BEAT = 5;
const FIRST_BEAT_MS = 20_000;
const FINAL: ChainTx["state"][] = ["COMPLETE", "FAILED", "DENIED", "CANCELLED"];
const UNFINISHED: Order["status"][] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"];
export const SEEN_KEY = "heartbeatSeen";
const LAST_KEY = "heartbeatLast";
/** After a failed Claude call (no credits, overloaded, timeout), wake again for the same problem after this. */
const RETRY_MS = 30 * 60_000;
/** handled: the Chief was woken for it (or code dealt with it), so do not wake again while it stays.
 *  failedAt: the wake failed because Claude was unavailable; try again after RETRY_MS. */
type Seen = Record<string, { since: string; handled?: boolean; failedAt?: string }>;

// Survives hot reloads: one busy flag and one timer per server process. The timer calls the latest code.
type State = {
  busy: boolean; timer?: ReturnType<typeof setTimeout>; nextRunAt?: number; intervalMs?: number;
  run?: (o: { trigger: "timer" | "button" }) => Promise<HeartbeatResult>;
};
const g = globalThis as unknown as { __kesuniHeartbeat?: State };
const state = (g.__kesuniHeartbeat ??= { busy: false });

/** The checks. Pure code: reads the store, no Claude, no Circle, no writes. */
export function checkHeartbeat(now: Date = new Date()): Finding[] {
  const t = now.getTime();
  const findings: Finding[] = [];
  const printers = store.listPrinters();
  const open = store.listOpenTasks();
  const hasOpen = (orderId: string, kind: OperatorTask["kind"]) => open.some((x) => x.orderId === orderId && x.kind === kind);
  // Agent prints on: the dispatcher (code) handles paid orders that wait for a printer. Read-only here; if the plan
  // cannot be made, the beat goes on as with agent prints off.
  let plan: ReturnType<typeof planDispatch> | null = null;
  try { plan = planDispatch(t); } catch { plan = null; }

  for (const o of store.listOrders()) {
    // Finding texts go to Claude: no customer name, phone or address from the product text.
    const label = `${o.id} (${agentText(o.product, o)})`;
    const escrow = store.getEscrow(o.id);
    // Payments are synced for every order, also rejected ones waiting for their refund.
    if (escrow?.txs.some((x) => !FINAL.includes(x.state))) {
      findings.push({ key: `payment_pending:${o.id}`, orderId: o.id, kind: "payment_pending", wake: false,
        text: `Payment for ${o.id} is still processing on the network; checked automatically.` });
    }
    if (o.status === "REJECTED" || o.status === "PAID") continue;

    if (o.status === "CREATED" && !hasOpen(o.id, "needs_info")) {
      // The customer's own design is being weighed automatically: its grams wake the Chief (src/lib/auto-weigh.ts).
      const weigh = !o.slicerGrams ? autoWeighState(o.id, t) : null;
      findings.push(store.listQuotes(o.id).length > 0
        ? { key: `needs_plan:${o.id}`, orderId: o.id, kind: "needs_plan", wake: true,
            text: `${label} has quotes but no plan yet. Choose a plan or ask the owner for approval.` }
        : weigh?.state === "weighing"
          ? { key: `weighing:${o.id}`, orderId: o.id, kind: "needs_price", wake: false,
              text: `${label}: the studio's slicer is weighing the customer's design; the price follows when the grams arrive.` }
          : { key: `needs_price:${o.id}`, orderId: o.id, kind: "needs_price", wake: true,
              text: weigh && weigh.state !== "done"
                ? `${label} has no price yet: the automatic weighing of the customer's design did not finish. Ask the operator for the grams per unit from the slicer.`
                : `${label} has no price yet. Price it by weight, or ask for the grams per unit from the slicer.` });
    }

    const onPrinter = printers.some((p) => p.currentOrderId === o.id || p.bedOccupiedBy === o.id);
    // A finished print that was collected waits for QC, not for a new production run.
    if (escrow?.state === "FUNDED" && (o.status === "PLAN_CHOSEN" || o.status === "IN_PRODUCTION")
      && !onPrinter && !hasOpen(o.id, "check_printer") && !printFinished(o.id)) {
      const line = plan?.on ? plan.orders[o.id] : undefined;
      findings.push(plan?.on
        ? { key: `start_production:${o.id}`, orderId: o.id, kind: "start_production", wake: false,
            text: `${label} is paid into escrow but has no printer yet. Agent prints are on; the dispatcher: ${line ? whyText(line.why) : "not in production"}.` }
        : { key: `start_production:${o.id}`, orderId: o.id, kind: "start_production", wake: true,
            text: `${label} is paid into escrow but has no printer yet. Start production.` });
    }

    const end = deadlineEnd(o);
    if (UNFINISHED.includes(o.status) && Number.isFinite(end) && end - t <= 24 * HOUR) {
      findings.push({
        key: `deadline_risk:${o.id}:${o.deadline}`, orderId: o.id, kind: "deadline_risk", wake: true,
        text: end <= t
          ? `The deadline of ${label} has passed (${o.deadline}) and the order is not finished. Check it and tell the customer.`
          : `The deadline of ${label} is less than 24 hours away (${o.deadline}) and the order is not finished. Check whether it can be on time.`,
        task: { kind: o.status === "CREATED" ? "needs_info" : "check_printer" },
      });
    }
  }

  for (const p of printers) {
    if (!p.currentOrderId || !(notReadyReason(p, t) ?? "").startsWith("offline")) continue;
    findings.push({
      key: `printer_offline:${p.id}:${p.currentOrderId}`, orderId: p.currentOrderId, kind: "printer_offline", wake: false,
      text: `${p.name} is offline while in use for ${p.currentOrderId}. Check the power, Wi-Fi and the printer's LAN bridge.`,
      task: { kind: "check_printer", printerId: p.id },
    });
  }

  for (const task of open) {
    if (t - Date.parse(task.at) <= 6 * HOUR) continue;
    const short = task.text.length > 140 ? `${task.text.slice(0, 140)}…` : task.text;
    findings.push({ key: `task_stale:${task.id}`, orderId: task.orderId, kind: "task_stale", wake: false,
      text: `Task for ${task.orderId} has been open for more than 6 hours: "${short}"` });
  }
  return findings;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One beat: checks, code actions, then wake the Chief for new problems. Refuses to overlap; never throws. */
export async function runHeartbeat(opts: { now?: Date; trigger: "timer" | "button" }): Promise<HeartbeatResult> {
  if (state.busy) return { ok: false, busy: true, error: "A heartbeat is already running" };
  state.busy = true;
  const started = Date.now();
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const mode = agentMode();
  const actions: string[] = [];
  const errors: string[] = [];
  const woke: HeartbeatSummary["woke"] = [];
  let findings: Finding[] = [];
  const seen: Seen = {};
  const freshKeys = new Set<string>();
  let checked = false; // only then may the seen-map be saved: a failed check must not forget what was handled
  try {
    const prev = store.getMeta<Seen>(SEEN_KEY) ?? {};
    findings = checkHeartbeat(now);
    // A key that is gone is forgotten, so the same problem can fire again later.
    for (const f of findings) seen[f.key] = prev[f.key] ?? { since: at };
    checked = true;
    const fresh = findings.filter((f) => !prev[f.key]);
    for (const f of fresh) freshKeys.add(f.key);

    // What the Chief noticed, in each order's decision log.
    const byOrder = new Map<string, Finding[]>();
    for (const f of fresh) if (f.orderId) byOrder.set(f.orderId, [...(byOrder.get(f.orderId) ?? []), f]);
    for (const [orderId, list] of byOrder) {
      store.addLog({ orderId, actor: "agent", tool: "heartbeat", input: { trigger: opts.trigger }, ok: true,
        output: { findings: list.map((f) => ({ kind: f.kind, text: f.text })) }, at });
    }

    // Code actions (free): operator tasks for new problems, payment sync.
    for (const f of fresh) {
      if (!f.task || !f.orderId) continue;
      try {
        if (store.listTasks(f.orderId).some((x) => x.status === "open" && x.text === f.text)) continue;
        createTask(f.orderId, f.task.kind, f.text, f.task.printerId);
        actions.push(`Task for ${f.orderId}: ${f.text}`);
      } catch (e) {
        errors.push(`Task for ${f.orderId}: ${errText(e)}`);
      }
    }
    for (const f of findings) {
      if (f.kind !== "payment_pending" || !f.orderId) continue;
      try {
        const before = store.getEscrow(f.orderId)?.state;
        await refreshPayment(f.orderId);
        const after = store.getEscrow(f.orderId)?.state;
        actions.push(`Synced payment of ${f.orderId}${before !== after ? `: ${before} → ${after}` : ""}`);
      } catch (e) {
        errors.push(`Payment sync ${f.orderId}: ${errText(e)}`);
      }
    }

    // The agent dispatcher (code, free): may queue a print or ask for a slice when agent prints are on. Never throws.
    const d = safeDispatch("heartbeat", now.getTime());
    for (const s of d.started) actions.push(`Agent print ${s.jobId} for ${s.orderId} queued on ${s.printerId}`);
    for (const s of d.sliced) actions.push(`Agent asked the studio PC to slice for ${s.orderId} (${s.sliceId})`);
    if (d.error) errors.push(`Agent dispatcher: ${d.error}`);

    // Wake the Chief, one order at a time, only for problems not handled yet.
    const toWake = new Map<string, Finding[]>();
    const retryAt = (f: Finding) => { const t = Date.parse(seen[f.key].failedAt ?? ""); return Number.isFinite(t) ? t + RETRY_MS : 0; };
    for (const f of findings) {
      if (!f.wake || !f.orderId || seen[f.key].handled) continue;
      if (retryAt(f) > now.getTime()) {
        if (!woke.some((w) => w.orderId === f.orderId)) {
          woke.push({ orderId: f.orderId, outcome: "deferred", summary: `Claude was unavailable; retry after ${new Date(retryAt(f)).toISOString()}` });
        }
        continue;
      }
      toWake.set(f.orderId, [...(toWake.get(f.orderId) ?? []), f]);
    }
    let wakes = 0;
    for (const [orderId, list] of toWake) {
      // Rules mode: only "choose a plan" has a rule-based planner; the rest waits for Claude.
      const runnable = mode === "claude" ? list : list.filter((f) => f.kind === "needs_plan");
      if (runnable.length < list.length) woke.push({ orderId, outcome: "needs_claude", summary: "Needs Claude (rules mode)" });
      if (runnable.length === 0) continue;
      if (wakes >= MAX_WAKES) {
        woke.push({ orderId, outcome: "deferred", summary: `Next beat (max ${MAX_WAKES} wakes per beat)` });
        continue;
      }
      wakes++;
      let r: ChiefRun;
      try {
        r = await runChief(orderId, `Heartbeat check (${opts.trigger}) found: ${runnable.map((f) => f.text).join(" ")}`);
      } catch (e) {
        r = { mode, outcome: "error", summary: "", turns: 0, error: errText(e) };
      }
      woke.push({ orderId, outcome: r.outcome, summary: r.summary.slice(0, 300) || undefined });
      if (r.error) errors.push(`Chief on ${orderId}: ${r.error}`);
      // Busy: the Chief is already on this order; try again next beat if the problem is still there.
      // Claude unavailable (r.error): not handled; try again after RETRY_MS so a dead key does not cost a call every beat.
      if (r.outcome === "busy") continue;
      for (const f of runnable) seen[f.key] = r.error ? { ...seen[f.key], failedAt: at } : { since: seen[f.key].since, handled: true };
    }
  } catch (e) {
    errors.push(errText(e));
  }

  // Arc receipt check (code, no Claude): read-only, never changes escrow state. A mismatch opens one needs_info task;
  // an RPC outage is only noted and retried next beat.
  try {
    const arc = await verifyBatch({ limit: ARC_CHECKS_PER_BEAT, now });
    for (const c of arc.checked) {
      const { orderId, tx, saved } = c;
      if (!saved) continue; // not on Arc yet: retried next beat
      const input = { kind: tx.kind, txHash: tx.txHash, amountUsdc: microToUsdc(tx.amountMicro) };
      store.addLog({ orderId, actor: "agent", tool: "arc_verify", input, ok: saved.ok,
        output: saved.ok ? { verified: true, logId: saved.logId, internal: saved.internal } : { verified: false, reason: saved.reason }, at });
      if (saved.ok) {
        actions.push(`Verified on Arc: ${tx.kind} of ${orderId}`);
        continue;
      }
      try {
        openArcMismatchTask(orderId, tx, saved);
        actions.push(`Arc mismatch on ${tx.kind} of ${orderId}: task opened`);
      } catch (e) {
        errors.push(`Task for ${orderId}: ${errText(e)}`);
      }
    }
    if (arc.unavailable) actions.push(`Arc check postponed (retry next beat): ${arc.unavailable}`);
  } catch (e) {
    errors.push(`Arc check: ${errText(e)}`);
  }

  // Last, so a slow report never delays the checks above. Once per Jakarta day after the review hour; never throws.
  const review = await maybeRunDailyReview(now);
  if (review.ran) actions.push(`Daily review for ${review.day} written (${review.review?.mode === "claude" ? "Claude" : "code template"})`);
  if (review.error) errors.push(`Daily review: ${review.error}`);
  else if (review.review?.error) errors.push(`Daily review used the code template: ${review.review.error}`);

  const summary: HeartbeatSummary = {
    at, trigger: opts.trigger, mode,
    findings: findings.map((f) => ({ ...f, since: seen[f.key]?.since ?? at, isNew: freshKeys.has(f.key) })),
    woke, actions, errors, durationMs: Date.now() - started,
  };
  try {
    if (checked) store.setMeta(SEEN_KEY, seen);
    store.setMeta(LAST_KEY, summary);
  } catch (e) {
    summary.errors.push(`Saving the heartbeat: ${errText(e)}`);
  } finally {
    state.busy = false;
  }
  return { ok: true, summary };
}
state.run = runHeartbeat; // the timer always calls the newest code after a hot reload

// ---------- scheduler (started from src/instrumentation.ts) ----------

/** Seconds between beats: KESUNI_HEARTBEAT_SECONDS, default 120, 0 = off, at least 10. */
export function heartbeatIntervalSeconds(): number {
  const raw = process.env.KESUNI_HEARTBEAT_SECONDS;
  const n = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(n) || n < 0) return 120;
  return n === 0 ? 0 : Math.max(10, Math.round(n));
}

export function startHeartbeatScheduler(): { started: boolean; reason?: string } {
  if (process.env.VITEST) return { started: false, reason: "tests" };
  const seconds = heartbeatIntervalSeconds();
  if (seconds === 0) return { started: false, reason: "off (KESUNI_HEARTBEAT_SECONDS=0)" };
  if (state.timer) return { started: false, reason: "already running" };
  const ms = seconds * 1000;
  const beat = () => {
    state.nextRunAt = Date.now() + ms;
    void state.run?.({ trigger: "timer" }).catch(() => undefined);
  };
  state.intervalMs = ms;
  state.nextRunAt = Date.now() + FIRST_BEAT_MS;
  state.timer = setTimeout(() => {
    beat();
    state.timer = setInterval(beat, ms);
    state.timer.unref?.();
  }, FIRST_BEAT_MS);
  state.timer.unref?.();
  return { started: true };
}

/** For the operator's Heartbeat card and GET /api/heartbeat. */
export function heartbeatStatus() {
  const last = store.getMeta<HeartbeatSummary>(LAST_KEY) ?? null;
  const intervalSeconds = heartbeatIntervalSeconds();
  // Route handlers may run where the timer's state is not visible: estimate from the last beat then.
  const estimate = last && intervalSeconds ? Date.parse(last.at) + intervalSeconds * 1000 : null;
  const next = state.nextRunAt ?? estimate;
  return {
    last, intervalSeconds, enabled: intervalSeconds > 0, schedulerRunning: Boolean(state.timer),
    nextRunAt: intervalSeconds > 0 && next ? new Date(next).toISOString() : null,
    running: state.busy, mode: agentMode(),
  };
}
export type HeartbeatStatus = ReturnType<typeof heartbeatStatus>;
