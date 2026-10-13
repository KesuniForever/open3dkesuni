"use client";

import { useEffect, useState } from "react";
import type { OperatorTask, Order, Printer } from "@/lib/types";

const STATE_TEXT: Record<string, string> = {
  IDLE: "Idle", PREPARE: "Preparing", SLICING: "Slicing", RUNNING: "Printing", PAUSE: "Paused",
  FINISH: "Finished", FAILED: "Failed", UNKNOWN: "No report yet",
};
const PRINTABLE = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];
const STALE_MS = 2 * 60 * 1000;

function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

/** All printers (read from the Bambu A1s by the LAN bridge) and the operator tasks the agent created. */
export default function PrinterPanel({ order, printers, tasks, busy, act, onChange }: {
  order: Order;
  printers: Printer[];
  tasks: OperatorTask[];
  busy: boolean;
  act: (url: string, body: unknown, success: string) => Promise<void>;
  onChange: () => void;
}) {
  const [by, setBy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const mine = printers.find((p) => p.currentOrderId === order.id);
  const printable = PRINTABLE.includes(order.status);

  // Refresh every 5 s so printer status stays live.
  useEffect(() => {
    if (printers.length === 0) return;
    const t = setInterval(() => { setNow(Date.now()); onChange(); }, 5000);
    return () => clearInterval(t);
  }, [printers.length, onChange]);

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <section className="card">
      <h2><span className="step">P</span> Printers and operator tasks</h2>
      {printers.length === 0 && <p className="muted">No printer has reported yet. Start the LAN bridge: <code>node scripts/printer-bridge.mjs</code></p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Printer</th><th>Status</th><th>Bed</th><th>Job</th><th /></tr></thead>
          <tbody>
            {printers.map((p) => {
              const s = p.snapshot;
              const offline = !p.lastSeen || now - Date.parse(p.lastSeen) > STALE_MS;
              const here = p.currentOrderId === order.id;
              return (
                <tr key={p.id}>
                  <td><b>{p.name}</b> <span className="badge">device</span><div className="muted" style={{ fontSize: 12 }}>last report {ago(p.lastSeen)}</div></td>
                  <td>
                    {offline ? <span className="badge bad">offline</span> : <>
                      {STATE_TEXT[s?.state ?? "UNKNOWN"] ?? s?.state}
                      {s && (s.state === "RUNNING" || s.state === "PAUSE") && ` ${Math.round(s.percent)}%`}
                      {s && s.state === "RUNNING" && s.remainingMin != null && <span className="muted"> · ~{s.remainingMin} min</span>}
                      {s && (s.state === "RUNNING" || s.state === "PAUSE") && (
                        <div style={{ height: 6, background: "#eee", borderRadius: 3, overflow: "hidden", marginTop: 4, minWidth: 80 }}>
                          <div style={{ width: `${s.percent}%`, height: "100%", background: s.state === "PAUSE" ? "#c0392b" : "#2e7d32" }} />
                        </div>
                      )}
                    </>}
                  </td>
                  <td>
                    {p.bedOccupiedBy ? (
                      <>
                        <span className="badge bad">holds {p.bedOccupiedBy}</span>{" "}
                        <button disabled={busy || !by.trim()} title="Confirm the part was collected and the bed is empty"
                          onClick={() => act(`/api/printers/${p.id}`, { action: "clear_bed", by }, `${p.name}: bed marked empty.`)}>Bed is empty</button>
                      </>
                    ) : <span className="badge ok">empty</span>}
                  </td>
                  <td>{here ? <b>this order</b> : p.currentOrderId ?? <span className="muted">none</span>}</td>
                  <td>
                    {here ? (
                      <button disabled={busy} onClick={() => act(`/api/printers/${p.id}`, { action: "unlink" }, `${p.name} unlinked.`)}>Unlink</button>
                    ) : (
                      <button disabled={busy || !printable || Boolean(p.currentOrderId) || Boolean(p.bedOccupiedBy)}
                        onClick={() => act(`/api/printers/${p.id}`, { action: "link", orderId: order.id }, `${p.name} will print this order.`)}>
                        Print here
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={busy || !printable || Boolean(mine) || printers.length === 0}
          onClick={() => act(`/api/orders/${order.id}/choose-printer`, undefined, "The agent picked a printer. See the decision log.")}>
          Let the agent pick a printer
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          Picks a printer that is online, idle, not busy and has an empty bed. Printers cannot see their bed, so a person confirms it after collecting the part.
        </span>
      </div>

      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Operator tasks</h3>
      <label style={{ display: "block", maxWidth: 260, marginBottom: 8 }}>Your name (for Done / Bed is empty)
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="e.g. Khelda" disabled={busy} />
      </label>
      {tasks.length === 0 ? <p className="muted">None. The agent adds one when a person is needed (filament, collecting the print, QC, reprint).</p> : (
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
      )}
    </section>
  );
}
