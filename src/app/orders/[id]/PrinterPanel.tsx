"use client";

import { useEffect, useState } from "react";
import type { OperatorTask, Order, Printer } from "@/lib/types";
import Info from "@/app/components/Info";
import MoreText from "@/app/components/MoreText";
import { oneLine } from "@/lib/text";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/core";

const STATE_TEXT: Record<string, string> = {
  IDLE: "Idle", PREPARE: "Preparing", SLICING: "Slicing", RUNNING: "Printing", PAUSE: "Paused",
  FINISH: "Finished", FAILED: "Failed", UNKNOWN: "No report yet",
};
const PRINTABLE = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];
const STALE_MS = 2 * 60 * 1000;

function ago(t: T, iso?: string): string {
  if (!iso) return t("never");
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? t("{n}s ago", { n: s }) : s < 3600 ? t("{n} min ago", { n: Math.round(s / 60) }) : t("{n} h ago", { n: Math.round(s / 3600) });
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
  const t = useT();
  const [by, setBy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const mine = printers.find((p) => p.currentOrderId === order.id);
  const printable = PRINTABLE.includes(order.status);

  // Refresh every 5 s so printer status stays live.
  useEffect(() => {
    if (printers.length === 0) return;
    const timer = setInterval(() => { setNow(Date.now()); onChange(); }, 5000);
    return () => clearInterval(timer);
  }, [printers.length, onChange]);

  const open = tasks.filter((task) => task.status === "open");
  const done = tasks.filter((task) => task.status === "done");

  return (
    <section className="card">
      <h2><span className="step">P</span> {t("Printers and operator tasks")}</h2>
      {printers.length === 0 && <p className="muted">{t("No printer has reported yet. Start the LAN bridge:")} <code>node scripts/printer-bridge.mjs</code></p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t("Printer")}</th><th>{t("Status")}</th><th>{t("Bed")}</th><th>{t("Job")}</th><th /></tr></thead>
          <tbody>
            {printers.map((p) => {
              const s = p.snapshot;
              const offline = !p.lastSeen || now - Date.parse(p.lastSeen) > STALE_MS;
              const here = p.currentOrderId === order.id;
              return (
                <tr key={p.id}>
                  <td><b>{p.name}</b> <span className="badge">{t("device")}</span><div className="muted" style={{ fontSize: 12 }}>{t("last report {ago}", { ago: ago(t, p.lastSeen) })}</div></td>
                  <td>
                    {offline ? <span className="badge bad">{t("offline")}</span> : <>
                      {STATE_TEXT[s?.state ?? "UNKNOWN"] ? t(STATE_TEXT[s?.state ?? "UNKNOWN"]) : s?.state}
                      {s && (s.state === "RUNNING" || s.state === "PAUSE") && ` ${Math.round(s.percent)}%`}
                      {s && s.state === "RUNNING" && s.remainingMin != null && <span className="muted"> · ~{t("{n} min", { n: s.remainingMin })}</span>}
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
                        <span className="badge bad">{t("holds {order}", { order: p.bedOccupiedBy })}</span>{" "}
                        <button disabled={busy || !by.trim()} title={t("Confirm the part was collected and the bed is empty")}
                          onClick={() => act(`/api/printers/${p.id}`, { action: "clear_bed", by }, t("{name}: bed marked empty.", { name: p.name }))}>{t("Bed is empty")}</button>
                      </>
                    ) : <span className="badge ok">{t("empty")}</span>}
                  </td>
                  <td>{here ? <b>{t("this order")}</b> : p.currentOrderId ?? <span className="muted">{t("none")}</span>}</td>
                  <td>
                    {here ? (
                      <button disabled={busy} onClick={() => act(`/api/printers/${p.id}`, { action: "unlink" }, t("{name} unlinked.", { name: p.name }))}>{t("Unlink")}</button>
                    ) : (
                      <button disabled={busy || !printable || Boolean(p.currentOrderId) || Boolean(p.bedOccupiedBy)}
                        onClick={() => act(`/api/printers/${p.id}`, { action: "link", orderId: order.id }, t("{name} will print this order.", { name: p.name }))}>
                        {t("Print here")}
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
          onClick={() => act(`/api/orders/${order.id}/choose-printer`, undefined, t("The agent picked a printer. See the decision log."))}>
          {t("Let the agent pick a printer")}
        </button>
        <Info>{t("Picks a printer that is online, idle, not busy and has an empty bed. Printers cannot see their bed, so a person confirms it after collecting the part.")}</Info>
      </div>

      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>{t("Operator tasks")}</h3>
      <label style={{ display: "block", maxWidth: 260, marginBottom: 8 }}>{t("Your name (for Done / Bed is empty)")}
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t("e.g. Khelda")} disabled={busy} />
      </label>
      {tasks.length === 0 && <p className="muted">{t("None yet. The agent adds one when a person is needed.")}</p>}
      {open.length > 0 && (
        <ul>
          {open.map((task) => (
            <li key={task.id} style={{ marginBottom: 6 }}>
              <span className="badge bad">{t("open")}</span> {oneLine(task.text)}{" "}
              <button disabled={busy || !by.trim()} onClick={() => act(`/api/tasks/${task.id}`, { by }, t("Task marked done."))}>{t("Done")}</button>
              <MoreText text={task.text} />
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="fold">
          <summary>{t(done.length === 1 ? "{n} done task" : "{n} done tasks", { n: done.length })}</summary>
          <ul className="muted" style={{ margin: 0 }}>
            {done.map((task) => <li key={task.id}>{oneLine(task.text)} ({task.doneBy})</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
