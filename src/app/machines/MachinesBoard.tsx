"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Printer } from "@/lib/types";
import { machineStats, machineView, type MachineView } from "@/lib/machines";
import { useT } from "@/i18n/client";
import Icon, { type IconName } from "../components/Icon";
import Info from "../components/Info";

export type OrderInfo = { label: string; status: string };
type Note = { id: string; ok: boolean; text: string };

const POLL_MS = 10_000;

/** Stat strip and one card per printer. Re-reads GET /api/printers every 10 s while the tab is visible. */
export default function MachinesBoard({ initial, serverNow, orders, printerTasks }: {
  initial: Printer[];
  serverNow: number;
  orders: Record<string, OrderInfo>;
  printerTasks: number;
}) {
  const router = useRouter();
  const t = useT();
  const [printers, setPrinters] = useState(initial);
  const [now, setNow] = useState(serverNow);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/printers", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { printers: Printer[] };
      setPrinters(j.printers);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  async function act(id: string, body: Record<string, string>, done: string) {
    setBusy(id);
    setNote(null);
    try {
      const r = await fetch(`/api/printers/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { printer?: Printer; error?: string };
      // A fixed server message is translated by the dictionary; anything else stays as the server wrote it.
      if (!r.ok || !j.printer) throw new Error(j.error ? t(j.error) : t("Request failed ({status})", { status: r.status }));
      setPrinters((ps) => ps.map((p) => (p.id === id ? j.printer! : p)));
      setNote({ id, ok: true, text: done });
      router.refresh();
    } catch (e) {
      setNote({ id, ok: false, text: e instanceof Error ? e.message : t("Request failed") });
    } finally {
      setBusy(null);
    }
  }

  const s = machineStats(printers, now);
  const views = printers.map((p) => machineView(p, now, t));

  return (
    <>
      <div className="stat-grid">
        <Stat label={t("Online")} icon="pulse" value={s.online} unit={t("of {n}", { n: s.total })} sub={t("{n} ready for a job", { n: s.ready })}
          info={t("Online: the LAN bridge sent a report in the last 2 minutes. Ready: online, not printing, no linked order, bed empty. The Chief only picks a ready printer.")} />
        <Stat label={t("Printing now")} icon="printer" value={s.printing} sub={s.paused ? t("{n} paused", { n: s.paused }) : undefined} />
        <Stat label={t("Beds to collect")} icon="box" value={s.bedsToCollect}
          info={t("A printer cannot see its bed. After a print ends the bed counts as full until a person marks it empty.")} />
        <Stat label={t("Printer tasks")} icon="wrench" value={printerTasks} unit={t("open")}
          info={t("Open “check printer” and “change filament” tasks, created by the Chief or a person.")} />
      </div>

      <div className="mach-head">
        <span>{s.total === 1 ? t("1 printer in the studio") : t("{n} printers in the studio", { n: s.total })}</span>
        <span className={`mach-live${failed ? " off" : ""}`}>
          <span className={`live-dot${failed ? " off" : ""}`} />
          {failed ? t("Could not refresh, retrying") : t("Live · refreshes every 10 s")}
        </span>
      </div>

      {views.length === 0 ? (
        <section className="card">
          <p style={{ margin: 0 }}><b>{t("No printer has reported yet.")}</b></p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{t("Start the LAN bridge on a studio computer:")} <code>node scripts/printer-bridge.mjs</code></p>
        </section>
      ) : (
        <div className="mach-grid">
          {views.map((v) => (
            <MachineCard key={v.id} v={v} orders={orders} busy={busy !== null} note={note?.id === v.id ? note : null}
              onUnlink={() => act(v.id, { action: "unlink" }, t("Order unlinked."))}
              onClearBed={(by) => act(v.id, { action: "clear_bed", by }, t("Bed marked empty."))} />
          ))}
        </div>
      )}
    </>
  );
}

function Stat({ label, icon, value, unit, sub, info }: { label: string; icon: IconName; value: number; unit?: string; sub?: string; info?: string }) {
  return (
    <div className="stat">
      <span className="stat-label"><span>{label}{info && <> <Info>{info}</Info></>}</span><Icon name={icon} /></span>
      <b>{value}{unit && <small className="stat-unit">{unit}</small>}</b>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

function OrderRef({ id, orders }: { id: string; orders: Record<string, OrderInfo> }) {
  const t = useT();
  const o = orders[id];
  return (
    <>
      <Link href={`/orders/${id}`}>{id}</Link>
      {o?.label === "simulated" && <> <span className="badge simulated">{t("simulated")}</span></>}
    </>
  );
}

function MachineCard({ v, orders, busy, note, onUnlink, onClearBed }: {
  v: MachineView;
  orders: Record<string, OrderInfo>;
  busy: boolean;
  note: Note | null;
  onUnlink: () => void;
  onClearBed: (by: string) => void;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [by, setBy] = useState("");
  const p = v.progress;

  return (
    <article className={`mach-card${v.online ? "" : " offline"}`}>
      <div className="mach-top">
        <span className="mach-symbol"><Icon name="printer" size={28} /></span>
        <span className={`mach-pill ${v.pill.tone}`}>{v.pill.text}</span>
      </div>
      <div className="mach-id">
        <span className="mach-eyebrow">Bambu Lab A1 Combo · LAN</span>
        <h2>{v.name}</h2>
        <p>{t("Last report {ago}", { ago: v.lastReport })}</p>
      </div>

      {p && (
        <div className={`mach-progress${p.paused ? " paused" : ""}`}>
          <div className="mach-progress-head">
            <b>{p.percent}%</b>
            {!v.online ? <span>{t("Last known reading")}</span> : p.paused ? <span className="mach-warn">{t("Paused")}</span> : null}
          </div>
          <div className="mach-bar" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("{name} progress", { name: v.name })}>
            <span style={{ width: `${p.percent}%` }} />
          </div>
        </div>
      )}

      <div className="mach-sensors">
        <div><strong>{v.nozzle}</strong><small>{t("Nozzle")}</small></div>
        <div><strong>{v.bed}</strong><small>{t("Bed")}</small></div>
        <div><strong>{v.layer}</strong><small>{t("Layer")}</small></div>
        <div><strong>{v.remaining}</strong><small>{t("Remaining")}</small></div>
      </div>

      <dl className="kv-rows">
        <div>
          <dt>{v.job && !v.job.current ? t("Last job") : t("Job")}</dt>
          <dd>{v.job ? <span className="one-line mono" title={v.job.name}>{v.job.name}</span> : <span className="muted">{t("None")}</span>}</dd>
        </div>
        <div>
          <dt>{t("Order")}</dt>
          <dd>{v.orderId ? <OrderRef id={v.orderId} orders={orders} /> : <span className="muted">{t("None")}</span>}</dd>
        </div>
        <div>
          <dt>{t("Bed")}</dt>
          <dd>
            {!v.bedHolds ? <span className="muted">{t("Empty")}</span>
              : v.bedHolds.orderId ? <span className="mach-warn">{t("Holds part of")} <OrderRef id={v.bedHolds.orderId} orders={orders} /></span>
              : <span className="mach-warn">{t("Holds a print, no order")}</span>}
          </dd>
        </div>
      </dl>

      {(v.orderId || v.bedHolds) && !asking && (
        <div className="mach-actions">
          {v.bedHolds && <button className="primary" disabled={busy} onClick={() => setAsking(true)}>{t("Bed is empty")}</button>}
          {v.orderId && <button disabled={busy} onClick={onUnlink} title={t("This printer no longer prints this order")}>{t("Unlink order")}</button>}
        </div>
      )}
      {asking && (
        <form className="mach-ask" onSubmit={(e) => { e.preventDefault(); if (by.trim()) { onClearBed(by.trim()); setAsking(false); } }}>
          <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t("Your name")} aria-label={t("Your name")} autoFocus disabled={busy} />
          <button type="submit" className="primary" disabled={busy || !by.trim()}>{t("Confirm")}</button>
          <button type="button" onClick={() => setAsking(false)} disabled={busy}>{t("Cancel")}</button>
        </form>
      )}
      {note && <p className={`mach-note ${note.ok ? "ok" : "bad"}`} role="status">{note.text}</p>}

      <details className="fold">
        <summary>{t("Details")}</summary>
        <dl className="kv-rows">
          <div><dt>{t("Printer id")}</dt><dd className="mono">{v.id}</dd></div>
          <div><dt>{t("Reported state")}</dt><dd className="mono">{v.state ?? t("none")}</dd></div>
          <div><dt>{t("Takes a new job")}</dt><dd>{v.notReady ? <span className="muted">{t("No, {reason}", { reason: v.notReady })}</span> : t("Yes")}</dd></div>
          {v.errorCode && <div><dt>{t("Error code")}</dt><dd className="mono">{v.errorCode}</dd></div>}
        </dl>
      </details>
    </article>
  );
}
