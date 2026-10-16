"use client";

import { useState } from "react";
import type { OrderLine } from "@/lib/printer/dispatch";
import { MAX_RUNS } from "@/lib/printer/autoprint-rules";
import { whyLine } from "@/lib/printer/why-text";
import type { Order } from "@/lib/types";
import type { T } from "@/i18n/core";
import Info from "@/app/components/Info";
import { ConfirmDialog } from "@/app/components/PrinterControls";
import { agentWillPrint } from "./operator-step";
import { units } from "./rich";

export interface OrderAutoPrintView { on: boolean; line: OrderLine | null; runsSet: boolean }

/**
 * The runs the agent prints for this order. The dispatcher's own count when it has one (src/lib/printer/autoprint.ts:
 * a real order printed only by the agent needs one run per piece; once a person printed it, 1 run covers the whole
 * quantity). Without it (before a plan is chosen), the same default: one per piece on a real order, 0 otherwise.
 */
export function agentRuns(order: Order, data: OrderAutoPrintView | null | undefined): { done: number; needed: number } {
  const line = data?.line ?? null;
  return {
    done: line?.runsDone ?? 0,
    needed: line?.runsNeeded ?? order.autoPrint?.runsNeeded ?? (order.label === "real" ? Math.max(1, order.quantity) : 0),
  };
}

/**
 * The number "Change agent prints" starts with: the dispatcher's count, or the runs a person set. Without either it
 * stays empty, so saving never stores a default by accident (a stored number stays after a person prints a full plate).
 */
const editStart = (order: Order, data: OrderAutoPrintView | null | undefined): string => {
  const n = data?.line?.runsNeeded ?? order.autoPrint?.runsNeeded;
  return n === undefined ? "" : String(n);
};

/**
 * Who prints this order, on step 4 · Print. mode "line": one sentence (a person, or the agent with its prints done) and,
 * why the agent waits or cannot print it. It follows the same rule as the Now banner (agentWillPrint). Details behind
 * the (i). mode "edit": "Change agent prints" (in More options), where a person sets the runs.
 */
export default function AgentPrintRow({ order, data, busy, act, t, mode = "line" }: {
  order: Order;
  data: OrderAutoPrintView | null | undefined;
  busy: boolean;
  act: (url: string, body: unknown, success: string) => Promise<void>;
  t: T;
  mode?: "line" | "edit";
}) {
  const [editing, setEditing] = useState(false);
  const { done, needed } = agentRuns(order, data);
  const [runs, setRuns] = useState(() => editStart(order, data));
  const n = Number(runs);
  const valid = runs.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= MAX_RUNS;
  if (!data) return null;

  if (mode === "line") {
    const line = data.line;
    const agentPrints = data.on && agentWillPrint(line);
    // Never "x of 0": with agent prints off or no runs, a person starts the print. A run on the printer says so (the
    // job list below says whose). When the agent cannot print it now, a person does, and the line says why.
    const onPrinter = data.on && needed > 0 && done < needed && Boolean(line && line.runsActive > 0);
    const sentence = !data.on ? t("You start this print here. Agent prints are off.")
      : needed === 0 ? t("You start this print here. The agent does not print this order (0 prints set).")
        : done >= needed ? t("{done} of {needed} prints done. The agent prints no more of this order.", { done, needed })
          : onPrinter ? t("Run {n} of {needed} is on the printer", { n: Math.min(needed, done + 1), needed })
            : agentPrints ? t("The agent prints this order: {done} of {needed} prints done. It starts only after someone confirms the bed on My machines.", { done, needed })
              : line ? t("You start this print here. The agent cannot print it now:") : t("You start this print here.");
    const why = line && !onPrinter && data.on && needed > 0 && done < needed ? whyLine(t, line.why) : "";
    return (
      <div className="pp-agent">
        <span className="pp-agent-head">
          <span>{sentence}</span>
          <Info>{t("With agent prints on, code starts this order by itself on a printer whose bed a person confirmed empty, until the runs are printed. 0 runs: never. An order that is not real needs its runs set first.")}</Info>
        </span>
        {why && <small className="muted pp-agent-why">{why}</small>}
      </div>
    );
  }

  return (
    <>
      <button disabled={busy} onClick={() => { setRuns(editStart(order, data)); setEditing(true); }}>{t("Change agent prints")}</button>
      <ConfirmDialog open={editing} title={t("Prints for the agent")} confirmLabel={t("Save")} busy={busy} ready={valid}
        onConfirm={(by) => { setEditing(false); void act(`/api/orders/${order.id}/auto-print`, { runsNeeded: n, by }, t("Runs saved.")); }}
        onClose={() => setEditing(false)}>
        <label>{t("Prints needed (0 to {max})", { max: MAX_RUNS })}
          <input type="number" min={0} max={MAX_RUNS} step={1} value={runs} onChange={(e) => setRuns(e.target.value)} disabled={busy} />
        </label>
        <p className="muted" style={{ margin: 0 }}>{t("This order has {units}; one print is one plate.", { units: units(t, order.quantity) })}</p>
        <p className="muted" style={{ margin: 0 }}>{t("Each finished print of this order counts one, also a person's.")}</p>
        <p className="muted" style={{ margin: 0 }}>{t("The agent may start at once if a printer's bed is already confirmed empty.")}</p>
      </ConfirmDialog>
    </>
  );
}
