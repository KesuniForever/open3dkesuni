"use client";

import Link from "next/link";
import { useState } from "react";
import type { OrderLine } from "@/lib/printer/dispatch";
import { MAX_RUNS } from "@/lib/printer/autoprint-rules";
import { whyLine } from "@/lib/printer/why-text";
import type { Order } from "@/lib/types";
import type { T } from "@/i18n/core";
import Info from "@/app/components/Info";
import { ConfirmDialog } from "@/app/components/PrinterControls";

export interface OrderAutoPrintView { on: boolean; line: OrderLine | null; runsSet: boolean }

/**
 * "Agent" on Colours & print: whether the agent prints this order by itself, its runs (a person sets them; each finished
 * print counts one) and what the dispatcher does next or why it waits. One line; details behind the (i).
 */
export default function AgentPrintRow({ order, data, busy, act, t }: {
  order: Order;
  data: OrderAutoPrintView | null | undefined;
  busy: boolean;
  act: (url: string, body: unknown, success: string) => Promise<void>;
  t: T;
}) {
  const [editing, setEditing] = useState(false);
  const line = data?.line ?? null;
  const done = line?.runsDone ?? 0;
  const needed = line?.runsNeeded ?? order.autoPrint?.runsNeeded ?? (order.label === "real" ? 1 : 0);
  const [runs, setRuns] = useState(String(needed));
  const n = Number(runs);
  const valid = runs.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= MAX_RUNS;
  if (!data) return null;

  return (
    <div className="pp-agent">
      <span className="pp-agent-head">
        <b>{t("Agent")}</b>
        <Link href="/chief" className={`badge${data.on ? " ok" : ""}`}>{data.on ? t("On") : t("Off")}</Link>
        <span>{t("Runs {done} of {needed}", { done, needed })}</span>
        <button className="pp-agent-edit" disabled={busy} onClick={() => { setRuns(String(needed)); setEditing(true); }}>{t("Edit")}</button>
        <Info>{t("With agent prints on, code starts this order by itself on a printer whose bed a person confirmed empty, until the runs are printed. 0 runs: never. An order that is not real needs its runs set first.")}</Info>
      </span>
      {line && <small className="muted pp-agent-why">{whyLine(t, line.why)}</small>}

      <ConfirmDialog open={editing} title={t("Runs for the agent")} confirmLabel={t("Save")} busy={busy} ready={valid}
        onConfirm={(by) => { setEditing(false); void act(`/api/orders/${order.id}/auto-print`, { runsNeeded: n, by }, t("Runs saved.")); }}
        onClose={() => setEditing(false)}>
        <label>{t("Prints needed (0 to {max})", { max: MAX_RUNS })}
          <input type="number" min={0} max={MAX_RUNS} step={1} value={runs} onChange={(e) => setRuns(e.target.value)} disabled={busy} />
        </label>
        <p className="muted" style={{ margin: 0 }}>{t("Each finished print of this order counts one, also a person's.")}</p>
      </ConfirmDialog>
    </div>
  );
}
