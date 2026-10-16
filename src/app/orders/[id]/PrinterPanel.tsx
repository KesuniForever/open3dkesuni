"use client";

import { useState } from "react";
import type { Order, Printer } from "@/lib/types";
import Info from "@/app/components/Info";
import { ConfirmDialog } from "@/app/components/PrinterControls";
import { issueViews, stageText } from "@/app/machines/printer-details";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/core";
import "./print.css";

const STATE_TEXT: Record<string, string> = {
  IDLE: "Idle", PREPARE: "Preparing", SLICING: "Slicing", RUNNING: "Printing", PAUSE: "Paused",
  FINISH: "Finished", FAILED: "Failed", UNKNOWN: "No report yet",
};
const PRINTABLE = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];
const STALE_MS = 2 * 60 * 1000;

function ago(t: T, now: number, iso?: string): string {
  if (!iso) return t("never");
  const s = Math.round((now - Date.parse(iso)) / 1000);
  return s < 60 ? t("{n}s ago", { n: s }) : s < 3600 ? t("{n} min ago", { n: Math.round(s / 60) }) : t("{n} h ago", { n: Math.round(s / 3600) });
}

/**
 * All printers (read from the Bambu A1s by the LAN bridge), in step 4's More options: reserve one for this order, let
 * the agent pick one, and "Part collected" for a bed that still holds a print. The order page refreshes every 5 s.
 */
export default function PrinterPanel({ order, printers, busy, act, now }: {
  order: Order;
  printers: Printer[];
  busy: boolean;
  act: (url: string, body: unknown, success: string) => Promise<void>;
  /** The page's clock (a printer that has not reported for 2 min is offline). */
  now: number;
}) {
  const t = useT();
  const [collecting, setCollecting] = useState<Printer | null>(null);
  const mine = printers.find((p) => p.currentOrderId === order.id);
  const printable = PRINTABLE.includes(order.status);

  return (
    <div className="pr">
      {printers.length === 0 && <p className="muted">{t("No printer has reported yet. Start the LAN bridge:")} <code>node scripts/printer-bridge.mjs</code></p>}
      <div className="table-wrap">
        <table className="pr-table">
          <thead><tr><th>{t("Printer")}</th><th>{t("Status")}</th><th>{t("Bed")}</th><th>{t("Job")}</th><th className="pr-act-col" /></tr></thead>
          <tbody>
            {printers.map((p) => {
              const s = p.snapshot;
              const offline = !p.lastSeen || now - Date.parse(p.lastSeen) > STALE_MS;
              const here = p.currentOrderId === order.id;
              const action = here ? (
                <button disabled={busy} onClick={() => act(`/api/printers/${p.id}`, { action: "unlink" }, t("{name} unlinked.", { name: p.name }))}>{t("Unlink")}</button>
              ) : (
                <button disabled={busy || !printable || Boolean(p.currentOrderId) || Boolean(p.bedOccupiedBy)}
                  title={t("Keeps this printer for this order. It does not start a print.")}
                  onClick={() => act(`/api/printers/${p.id}`, { action: "link", orderId: order.id }, t("{name} will print this order.", { name: p.name }))}>
                  {t("Reserve for this order")}
                </button>
              );
              return (
                <tr key={p.id}>
                  <td><b>{p.name}</b> <span className="badge">{t("device")}</span><div className="muted" style={{ fontSize: 12 }}>{t("last report {ago}", { ago: ago(t, now, p.lastSeen) })}</div>
                    {/* On a phone the action sits under the name, so it shows without scrolling the table sideways. */}
                    <div className="pr-act-inline">{action}</div>
                  </td>
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
                      {stageText(s, t) && <div className="muted" style={{ fontSize: 12 }}>{stageText(s, t)}</div>}
                    </>}
                    {issueViews(s, {}).map((i) => (
                      <div key={i.code}><a href={i.url} target="_blank" rel="noreferrer" className={`badge ${i.tone}`} title={t("Open guide")}>{i.code}</a></div>
                    ))}
                  </td>
                  <td>
                    {p.bedOccupiedBy ? (
                      <>
                        <span className="badge bad">{t("holds {order}", { order: p.bedOccupiedBy })}</span>{" "}
                        <button disabled={busy} title={t("Confirm the part was collected and the bed is empty")} onClick={() => setCollecting(p)}>{t("Part collected")}</button>
                      </>
                    ) : <span className="badge ok">{t("empty")}</span>}
                  </td>
                  <td>{here ? <b>{t("this order")}</b> : p.currentOrderId ?? <span className="muted">{t("none")}</span>}</td>
                  <td className="pr-act-col">{action}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button disabled={busy || !printable || Boolean(mine) || printers.length === 0}
          onClick={() => act(`/api/orders/${order.id}/choose-printer`, undefined, t("The agent picked a printer. See the decision log."))}>
          {t("Let the agent pick a printer")}
        </button>
        <Info>{t("Picks a printer that is online, idle, not busy and has an empty bed. Printers cannot see their bed, so a person confirms it after collecting the part.")}</Info>
      </div>

      {/* Only frees the bed (clear_bed, no grant): "Bed is empty" on My machines is what lets the agent print. */}
      <ConfirmDialog open={collecting !== null} title={t("Part collected from {printer}?", { printer: collecting?.name ?? "" })} confirmLabel={t("Part collected")} busy={busy}
        onConfirm={async (by) => {
          if (!collecting) return;
          await act(`/api/printers/${collecting.id}`, { action: "clear_bed", by }, t("{name}: bed marked empty.", { name: collecting.name }));
          setCollecting(null);
        }}
        onClose={() => setCollecting(null)}>
        <p style={{ margin: 0 }}>{t("This frees the printer for the next order. It does not start any print.")}</p>
      </ConfirmDialog>
    </div>
  );
}
