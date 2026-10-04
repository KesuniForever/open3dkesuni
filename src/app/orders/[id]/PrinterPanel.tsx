"use client";

import { useEffect, useState } from "react";
import type { OperatorTask, Order, Printer } from "@/lib/types";

const STATE_TEXT: Record<string, string> = {
  IDLE: "Idle", PREPARE: "Preparing", SLICING: "Slicing", RUNNING: "Printing", PAUSE: "Paused",
  FINISH: "Finished", FAILED: "Failed", UNKNOWN: "No report yet",
};
const PRINTABLE = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];

function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

/** Printer status (read from the Bambu A1 by the LAN bridge) and the operator tasks the agent created. */
export default function PrinterPanel({ order, printers, tasks, busy, act, onChange }: {
  order: Order;
  printers: Printer[];
  tasks: OperatorTask[];
  busy: boolean;
  act: (url: string, body: unknown, success: string) => Promise<void>;
  onChange: () => void;
}) {
  const [by, setBy] = useState("");
  const printer = printers.find((p) => p.id === "a1");
  const linkedHere = printer?.currentOrderId === order.id;
  const s = printer?.snapshot;

  // Live view while this order is on the printer.
  useEffect(() => {
    if (!linkedHere) return;
    const t = setInterval(onChange, 5000);
    return () => clearInterval(t);
  }, [linkedHere, onChange]);

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <section className="card">
      <h2><span className="step">P</span> Printer and operator tasks</h2>
      <p>
        <b>{printer?.name ?? "Bambu Lab A1"}</b>{" "}
        <span className="badge">device</span>{" "}
        {s ? <>· {STATE_TEXT[s.state] ?? s.state}{s.state === "RUNNING" || s.state === "PAUSE" ? ` ${Math.round(s.percent)}%` : ""}</> : "· no report yet"}
        {s?.remainingMin != null && s.state === "RUNNING" && <span className="muted"> · about {s.remainingMin} min left</span>}
        <span className="muted"> · last report {ago(printer?.lastSeen)}</span>
      </p>
      {s && (s.state === "RUNNING" || s.state === "PAUSE") && (
        <div aria-label="Print progress" style={{ height: 8, background: "var(--line, #eee)", borderRadius: 4, overflow: "hidden", margin: "6px 0 10px" }}>
          <div style={{ width: `${s.percent}%`, height: "100%", background: s.state === "PAUSE" ? "#c0392b" : "#2e7d32" }} />
        </div>
      )}
      <div className="row">
        {linkedHere ? (
          <>
            <span className="muted" style={{ fontSize: 13 }}>This printer is printing this order. Its reports are added as evidence automatically.</span>
            <button disabled={busy} onClick={() => act(`/api/printers/a1`, { action: "unlink" }, "Printer unlinked.")}>Unlink</button>
          </>
        ) : (
          <>
            <button className="primary" disabled={busy || !PRINTABLE.includes(order.status)}
              onClick={() => act(`/api/printers/a1`, { action: "link", orderId: order.id }, "Printer linked to this order.")}>
              Print this order on the A1
            </button>
            {printer?.currentOrderId && <span className="muted" style={{ fontSize: 13 }}>Currently linked to {printer.currentOrderId}.</span>}
          </>
        )}
      </div>

      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Operator tasks</h3>
      {tasks.length === 0 ? <p className="muted">None. The agent adds one when a person is needed (filament, collecting the print, QC).</p> : (
        <>
          {open.length > 0 && (
            <label style={{ display: "block", maxWidth: 260, marginBottom: 8 }}>Done by
              <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" disabled={busy} />
            </label>
          )}
          <ul>
            {open.map((t) => (
              <li key={t.id} style={{ marginBottom: 6 }}>
                <span className="badge bad">open</span> {t.text}{" "}
                <button disabled={busy || !by.trim()} onClick={() => act(`/api/tasks/${t.id}`, { by }, "Task marked done.")}>Done</button>
              </li>
            ))}
            {done.map((t) => (
              <li key={t.id} className="muted"><span className="badge ok">done</span> {t.text} ({t.doneBy})</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
