"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { OperatorTask } from "@/lib/types";
import { oneLine } from "@/lib/text";
import { duration } from "@/lib/machines";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/core";
import MoreText from "@/app/components/MoreText";
import { ConfirmDialog } from "@/app/components/PrinterControls";
import { taskText, type IssueTexts } from "@/app/machines/printer-details";
import { STEP_N, STEP_TITLE, STEPS, type NextStep, type StepId, type StepState } from "./operator-step";
import "./steps.css";

type Act = (url: string, body: unknown, success: string) => Promise<void>;

/** Open a step card and scroll to it (the Now banner's button, the step strip, "Go to step n" links). */
export function openStep(id: StepId): void {
  const card = document.getElementById(`step-${id}`);
  const fold = card?.querySelector<HTMLDetailsElement>(":scope > details");
  if (fold) fold.open = true;
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Scroll to the Customer payment card (EscrowPanel, beside the steps): the escrow's release is there. */
function openPayment(): void {
  document.getElementById("payment")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** A link-looking button that opens a step: <StepLink id="model">Add a QC photo</StepLink>. */
export function StepLink({ id, children }: { id: StepId; children: ReactNode }) {
  return <a href={`#step-${id}`} onClick={(e) => { e.preventDefault(); openStep(id); }}>{children}</a>;
}

const CHIP: Record<StepState, { text: string; tone: string }> = {
  done: { text: "Done ✓", tone: "ok" }, now: { text: "Now", tone: "op-chip-now" }, wait: { text: "Waiting", tone: "warn" }, later: { text: "Later", tone: "" },
};

export function StepChip({ state }: { state: StepState }) {
  const t = useT();
  return <span className={`badge ${CHIP[state].tone}`}>{t(CHIP[state].text)}</span>;
}

/**
 * One step of the order page. It opens itself when it becomes the step to do (or wait for) and never closes itself:
 * the 5-second reload neither folds a card a person opened nor closes one with a dialog open. Done and later cards start
 * closed. summary: one line shown while the card is closed.
 */
export function StepCard({ id, state, summary, explain, children }: {
  id: StepId; state: StepState; summary?: ReactNode; explain: ReactNode; children?: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if ((state === "now" || state === "wait") && ref.current) ref.current.open = true;
  }, [state]);
  return (
    <section className={`card op-step ${state}`} id={`step-${id}`}>
      <details ref={ref}>
        <summary>
          <h2><span className="step">{STEP_N[id]}</span> {t(STEP_TITLE[id])} <StepChip state={state} /></h2>
          {summary ? <span className="op-sum">{summary}</span> : null}
        </summary>
        <div className="op-body">
          <p className="muted op-explain">{explain}</p>
          {children}
        </div>
      </details>
    </section>
  );
}

const STATE_WORD: Record<NextStep["state"], string> = { now: "Now", wait: "Waiting", done: "Done" };

/** The Now line's values in words: {left} and {ago} are minutes. */
export function nowText(next: NextStep, t: T): string {
  const vars = { ...next.vars };
  for (const k of ["left", "ago"]) if (typeof vars[k] === "number") vars[k] = duration(vars[k] as number, false, t);
  return t(next.text, vars);
}

/**
 * The top of the order page: where the order is, the one thing to do now with one button, the operator tasks that are
 * open, and the six steps (each opens its card). When the thing to do is on My machines (a bed to confirm, a paused or
 * silent printer) or in the Customer payment card (the escrow's release), the button goes there; the step stays a link.
 */
export function NowBanner({ next, states, tasks, issueTexts, busy, act }: {
  next: NextStep; states: Record<StepId, StepState>; tasks: OperatorTask[]; issueTexts: IssueTexts; busy: boolean; act: Act;
}) {
  const t = useT();
  const [asking, setAsking] = useState<OperatorTask | null>(null);
  const open = tasks.filter((x) => x.status === "open");
  const go = t("Go to step {n}", { n: next.n });
  const machines = next.go === "machines" ? `/machines${next.printerId ? `#printer-${next.printerId}` : ""}` : null;
  return (
    <section className={`card op-now ${next.state}`} aria-label={t("Now")}>
      <p className="eyebrow op-now-eyebrow">
        {t(STATE_WORD[next.state])} · {t("Step {n} of 6", { n: next.n })} · {t(STEP_TITLE[next.step])}
      </p>
      <p className="op-now-text">{nowText(next, t)}</p>
      <div className="row op-now-go">
        {next.go === "payment" ? (
          <button className="primary" onClick={openPayment}>{t("Go to the payment")}</button>
        ) : machines && next.state === "now" ? (
          <>
            <Link className="btn-link" href={machines}>{t("My machines")}</Link>
            <StepLink id={next.step}>{go}</StepLink>
          </>
        ) : next.state === "now" ? (
          <button className="primary" onClick={() => openStep(next.step)}>{go}</button>
        ) : (
          <>
            <StepLink id={next.step}>{go}</StepLink>
            {machines && <Link href={machines}>{t("My machines")}</Link>}
          </>
        )}
      </div>

      {open.length > 0 && (
        <div className="op-tasks">
          <h3>{t("Open tasks")}</h3>
          <ul>
            {open.map((task) => {
              const full = taskText(task, t, issueTexts);
              return (
                <li key={task.id}>
                  <span className="op-task-line">
                    <span>{oneLine(full)}</span>
                    <button disabled={busy} onClick={() => setAsking(task)}>{t("Done")}</button>
                  </span>
                  <MoreText text={full} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ol className="timeline op-strip" aria-label={t("Order progress")}>
        {STEPS.map((s) => (
          <li key={s} className={states[s] === "done" ? "done" : states[s] === "now" || states[s] === "wait" ? "now" : ""}>
            <StepLink id={s}>{t(STEP_TITLE[s])}</StepLink>
          </li>
        ))}
      </ol>

      <ConfirmDialog open={asking !== null} title={t("Mark this task done?")} confirmLabel={t("Done")} busy={busy}
        onConfirm={async (by) => {
          if (!asking) return;
          await act(`/api/tasks/${asking.id}`, { by }, t("Task marked done."));
          setAsking(null);
        }}
        onClose={() => setAsking(null)}>
        <p style={{ margin: 0 }}>{asking ? oneLine(taskText(asking, t, issueTexts)) : ""}</p>
      </ConfirmDialog>
    </section>
  );
}
