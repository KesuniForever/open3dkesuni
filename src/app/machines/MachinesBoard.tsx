"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { OperatorTask, Printer } from "@/lib/types";
import type { DispatchPlan, PrinterLine } from "@/lib/printer/dispatch";
import { bedButtonUseful } from "@/lib/printer/autoprint-rules";
import { whyLine } from "@/lib/printer/why-text";
import { machineStats, machineView, type MachineView } from "@/lib/machines";
import { colorsCheckedNow, nameOf, studioPalette } from "@/lib/colors";
import { tLib } from "@/lib/lib-text";
import { useLocale, useT } from "@/i18n/client";
import type { T } from "@/i18n/core";
import Icon, { type IconName } from "../components/Icon";
import Info from "../components/Info";
import ColorSwatch from "../components/ColorSwatch";
import PrinterControls, { ConfirmDialog } from "../components/PrinterControls";
import CameraPanel from "./CameraPanel";
import {
  amsSlots, infoMessages, issueViews, nozzleText, speedText, stageText, taskText, wifiQuality, type IssueTexts, type IssueView,
} from "./printer-details";
import { useIssueTexts } from "./use-issue-texts";

export type OrderInfo = { label: string; status: string };
type Note = { id: string; ok: boolean; text: string };

const POLL_MS = 10_000;
/** After a control, read the printers again sooner than the 10 s poll. */
const AFTER_CONTROL_MS = 3_000;

/** Stat strip, the studio's colours and one card per printer. Re-reads GET /api/printers every 10 s while the tab is visible. */
export default function MachinesBoard({ initial, initialPlan = null, serverNow, orders, tasks, issueTexts }: {
  initial: Printer[];
  /** The agent dispatcher's read-only plan when the page was made: agent prints on or off, each printer's next print. */
  initialPlan?: DispatchPlan | null;
  serverNow: number;
  orders: Record<string, OrderInfo>;
  /** Open printer tasks (check printer, change filament). */
  tasks: OperatorTask[];
  /** Bambu's words for the faults reported when the page was made (server-side table). */
  issueTexts: IssueTexts;
}) {
  const router = useRouter();
  const t = useT();
  const [printers, setPrinters] = useState(initial);
  const [plan, setPlan] = useState<DispatchPlan | null>(initialPlan);
  const [now, setNow] = useState(serverNow);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  useIssueTexts(printers, issueTexts);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/printers", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { printers: Printer[]; autoPrint?: DispatchPlan | null };
      setPrinters(j.printers);
      if (j.autoPrint !== undefined) setPlan(j.autoPrint);
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

  /** path "" (link, unlink, colours) or "/bed" (the "Bed is empty" that allows one agent print). */
  async function act(id: string, body: Record<string, string | boolean>, done: string, path = "") {
    setBusy(id);
    setNote(null);
    try {
      const r = await fetch(`/api/printers/${id}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const raw = await r.text().catch(() => "");
      let j: { printer?: Printer; error?: string } = {};
      try { j = JSON.parse(raw) as typeof j; } catch { /* the proxy answers in plain text (password needed) */ }
      const error = j.error ?? (!r.ok && raw.trim() && raw.length < 200 ? raw.trim() : null);
      // A fixed server message is translated by the dictionary; anything else stays as the server wrote it.
      if (!r.ok || !j.printer) throw new Error(error ? tLib(t, error) : t("Request failed ({status})", { status: r.status }));
      setPrinters((ps) => ps.map((p) => (p.id === id ? j.printer! : p)));
      setNote({ id, ok: true, text: done });
      router.refresh();
      void load(); // the agent's next print may have changed (or started)
    } catch (e) {
      setNote({ id, ok: false, text: e instanceof Error ? e.message : t("Request failed") });
    } finally {
      setBusy(null);
    }
  }

  const s = machineStats(printers, now);

  return (
    <>
      <div className="stat-grid">
        <Stat label={t("Online")} icon="pulse" value={s.online} unit={t("of {n}", { n: s.total })} sub={t("{n} ready for a job", { n: s.ready })}
          info={t("Online: the LAN bridge sent a report in the last 2 minutes. Ready: online, not printing, no linked order, bed empty. The Chief only picks a ready printer.")} />
        <Stat label={t("Printing now")} icon="printer" value={s.printing} sub={s.paused ? t("{n} paused", { n: s.paused }) : undefined} />
        <Stat label={t("Beds to collect")} icon="box" value={s.bedsToCollect}
          info={t("A printer cannot see its bed. After a print ends the bed counts as full until a person marks it empty.")} />
        <Stat label={t("Printer tasks")} icon="wrench" value={tasks.length} unit={t("open")}
          info={t("Open “check printer” and “change filament” tasks, created by the Chief or a person.")} />
      </div>

      <StudioColours printers={printers} now={now} />

      <div className="mach-head">
        <span>
          {s.total === 1 ? t("1 printer in the studio") : t("{n} printers in the studio", { n: s.total })}
          {plan && <> · <Link href="/chief" className={`badge${plan.on ? " ok" : ""}`} title={t("Set on the Chief page")}>{plan.on ? t("Agent prints on") : t("Agent prints off")}</Link></>}
        </span>
        <span className={`mach-live${failed ? " off" : ""}`}>
          <span className={`live-dot${failed ? " off" : ""}`} />
          {failed ? t("Could not refresh, retrying") : t("Live · refreshes every 10 s")}
        </span>
      </div>

      {printers.length === 0 ? (
        <section className="card">
          <p style={{ margin: 0 }}><b>{t("No printer has reported yet.")}</b></p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{t("Start the LAN bridge on a studio computer:")} <code>node scripts/printer-bridge.mjs</code></p>
        </section>
      ) : (
        <div className="mach-grid">
          {printers.map((p) => (
            <MachineCard key={p.id} p={p} v={machineView(p, now, t)} now={now} orders={orders} tasks={tasks} texts={issueTexts}
              agent={plan?.printers[p.id] ?? null} agentOn={plan?.on ?? false}
              busy={busy !== null} note={note?.id === p.id ? note : null}
              onUnlink={() => act(p.id, { action: "unlink" }, t("Order unlinked."))}
              onClearBed={(by) => (plan?.on
                ? act(p.id, { by, confirm: true }, t("Bed marked empty."), "/bed") // allows the agent one print here
                : act(p.id, { action: "clear_bed", by }, t("Bed marked empty.")))}
              onConfirmColors={(by) => act(p.id, { action: "confirm_colors", by }, t("Colours confirmed."))}
              onSent={() => setTimeout(() => void load(), AFTER_CONTROL_MS)} />
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

/** "A1 Combo #2" -> "#2": the short name the colour strip uses. */
const shortName = (name: string) => /#\d+$/.exec(name)?.[0] ?? name;

/** Every material and colour loaded in the studio's AMS units now: what customers can pick from. */
function StudioColours({ printers, now }: { printers: Printer[]; now: number }) {
  const t = useT();
  const palette = studioPalette(printers, now);
  const name = (id: string) => shortName(printers.find((p) => p.id === id)?.name ?? id);
  return (
    <section className="card mach-colours">
      <h2>{t("Studio colours")}{" "}
        <Info>{t("Spools loaded in the AMS now; customers pick from these. Spools without a Bambu tag show black until someone sets their colour on the printer, so confirm each printer's colours.")}</Info>
      </h2>
      {palette.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t("No AMS spools reported yet.")} <Info>{t("The LAN bridge reports the AMS spools. An older bridge does not: restart it on the new code.")}</Info>
        </p>
      ) : (
        <ul className="mach-palette">
          {palette.map((c) => (
            <li key={c.type + c.color}>
              <ColorSwatch color={c.color} size={24} title={`${c.type} ${t(c.name)} ${c.color}`} />
              <span>
                <b>{c.type} {t(c.name)}</b>
                {!c.checked && <> <span className="badge warn" title={t("Nobody confirmed this colour on the printer yet")}>{t("not checked")}</span></>}
                <small>{c.printers.map((x) => t("{printer} slot {slots}", { printer: name(x.printerId), slots: x.slots.map((sl) => (sl & 3) + 1).join(", ") })).join(" · ")}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
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

/** A loud banner per fault: Bambu's code and words, the guide link, and the task a person has for it. */
function Fault({ issue, task, orders, t }: { issue: IssueView; task?: OperatorTask; orders: Record<string, OrderInfo>; t: T }) {
  return (
    <div className={`mach-fault ${issue.tone}`} role="alert">
      <div className="mach-fault-head">
        <Icon name="wrench" size={16} />
        <b>{issue.tone === "bad" ? t("Printer error") : t("Printer warning")}</b>
        {issue.level && <span className="mach-fault-level">{t(issue.level)}</span>}
      </div>
      {/* The code is in the chip below: an unknown one is not repeated here. */}
      <p>{issue.text ?? t("Unknown printer message")}</p>
      <div className="mach-fault-foot">
        <code>{issue.code}</code>
        <a href={issue.url} target="_blank" rel="noreferrer">{t("Open guide")} <Icon name="arrow" size={13} /></a>
        {task && <Link href={orders[task.orderId] ? `/orders/${task.orderId}` : "#printer-tasks"}>{t("Task open")}</Link>}
      </div>
    </div>
  );
}

const SD_TEXT = { in: "Inserted", missing: "Missing", problem: "Problem" } as const;
/** The temperature the printer is heating to (0 = heater off: nothing shown). */
function Target({ value }: { value: number }) {
  const t = useT();
  return <small className="mach-target">{t("target {n} °C", { n: Math.round(value) })}</small>;
}
const heating = (v: number | null | undefined) => (v && v > 0 ? <Target value={v} /> : null);

export function MachineCard({ p, v, now, orders, tasks, texts, agent = null, agentOn = false, busy, note, onUnlink, onClearBed, onConfirmColors, onSent }: {
  p: Printer;
  v: MachineView;
  now: number;
  orders: Record<string, OrderInfo>;
  tasks: OperatorTask[];
  texts: IssueTexts;
  /** This printer's line in the agent dispatcher's plan: the next agent print, or why it waits. */
  agent?: PrinterLine | null;
  agentOn?: boolean;
  busy: boolean;
  note: Note | null;
  onUnlink: () => void;
  onClearBed: (by: string) => void;
  onConfirmColors: (by: string) => void;
  onSent?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const [checking, setChecking] = useState(false);
  const s = p.snapshot;
  const prog = v.progress;
  const issues = issueViews(s, texts);
  const stage = stageText(s, t);
  const slots = amsSlots(s);
  const ext = s?.externalSpool;
  const generic = slots.some((x) => !x.empty && !x.bambu);
  const wifi = wifiQuality(s?.wifiDbm);
  const fans = s?.partFanPct != null || s?.hotendFanPct != null
    ? t("part {a}% · hotend {b}%", { a: s?.partFanPct ?? "—", b: s?.hotendFanPct ?? "—" }) : null;
  const sd = s?.sdcard == null ? null : s.sdAbnormal ? "problem" : s.sdcard ? "in" : "missing";
  const fw = s?.firmware ? [s.firmware.ota, s.firmware.ams && `AMS ${s.firmware.ams}`].filter(Boolean).join(" · ") : null;
  const info = infoMessages(s);
  const taskFor = (code: string) => tasks.find((x) => x.printerId === p.id && x.errorCode === code);
  // "Bed is empty": after a print (the bed holds it); with agent prints on, also while the agent has no confirmation to use.
  const offerBed = Boolean(v.bedHolds || (agentOn && v.online && agent && !agent.bed && !agent.jobOnItsWay && bedButtonUseful(p)));

  return (
    <article id={`printer-${v.id}`} className={`mach-card${v.online ? "" : " offline"}${issues.some((i) => i.tone === "bad") ? " fault" : ""}`}>
      <div className="mach-top">
        <span className="mach-symbol"><Icon name="printer" size={28} /></span>
        <span className={`mach-pill ${v.pill.tone}`}>{v.pill.text}</span>
      </div>
      <div className="mach-id">
        <span className="mach-eyebrow">Bambu Lab A1 Combo · LAN</span>
        <h2>{v.name}</h2>
        <p>{t("Last report {ago}", { ago: v.lastReport })}</p>
      </div>

      {issues.length > 0 && (
        <div className="mach-faults">
          {issues.map((i) => <Fault key={i.code} issue={i} task={taskFor(i.code)} orders={orders} t={t} />)}
        </div>
      )}

      {stage && (
        <p className={`mach-stage${s?.stage?.needsPerson ? " alert" : ""}`}>
          <Icon name={s?.stage?.needsPerson ? "wrench" : "pulse"} size={15} />
          <span><small>{s?.stage?.needsPerson ? t("Needs a person") : t("Doing now")}</small>{stage}</span>
        </p>
      )}

      {prog && (
        <div className={`mach-progress${prog.paused ? " paused" : ""}`}>
          <div className="mach-progress-head">
            <b>{prog.percent}%</b>
            {!v.online ? <span>{t("Last known reading")}</span> : prog.paused ? <span className="mach-warn">{t("Paused")}</span> : null}
          </div>
          <div className="mach-bar" role="progressbar" aria-valuenow={prog.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("{name} progress", { name: v.name })}>
            <span style={{ width: `${prog.percent}%` }} />
          </div>
        </div>
      )}

      <div className="mach-sensors">
        <div><strong>{v.nozzle}</strong><small>{t("Nozzle")}</small>{heating(s?.nozzleTarget)}</div>
        <div><strong>{v.bed}</strong><small>{t("Bed")}</small>{heating(s?.bedTarget)}</div>
        <div><strong>{v.layer}</strong><small>{t("Layer")}</small></div>
        <div><strong>{v.remaining}</strong><small>{t("Remaining")}</small></div>
      </div>

      {slots.length > 0 ? (
        <div className="mach-ams">
          <div className="mach-ams-head">
            <span>{s?.ams?.lite ? "AMS lite" : "AMS"}{s?.ams?.humidity != null && <span className="muted"> · {t("humidity {n}", { n: s.ams.humidity })}</span>}</span>
            {generic && (colorsCheckedNow(p)
              ? <span className="mach-checked" title={p.colorsChecked?.at}><Icon name="check" size={14} />{t("Checked by {name}", { name: p.colorsChecked!.by })}</span>
              : <button className="mach-link" disabled={busy} onClick={() => setChecking(true)}>{t("Confirm colours")}</button>)}
          </div>
          <ul className="mach-slots">
            {slots.map((x) => {
              const colour = x.name ? t(x.name) : "";
              const title = x.empty ? t("Slot {n}: empty", { n: x.slot })
                : [t("Slot {n}", { n: x.slot }), x.brand ?? x.type, colour, x.color, x.active ? t("in use") : ""].filter(Boolean).join(" · ");
              return (
                <li key={x.tray} className={x.active ? "on" : x.empty ? "empty" : ""} title={title}>
                  <ColorSwatch color={x.color} colors={x.colors} active={x.active} size={26} />
                  <b>{x.slot}</b>
                  <span>{x.empty ? t("Empty") : x.type}</span>
                  <small>{colour}{x.remainPct != null ? ` ${x.remainPct}%` : ""}</small>
                </li>
              );
            })}
            {ext && (
              <li className={s?.ams?.externalActive ? "on" : ""} title={[t("External spool"), ext.type, ext.color && t(nameOf(ext.color))].filter(Boolean).join(" · ")}>
                <ColorSwatch color={ext.color} active={s?.ams?.externalActive} size={26} />
                <b>{t("Ext")}</b>
                <span>{ext.type}</span>
                <small>{ext.color ? t(nameOf(ext.color)) : ""}</small>
              </li>
            )}
          </ul>
        </div>
      ) : v.online && s && (
        <p className="muted mach-ams-none">
          {t("AMS not reported yet.")} <Info>{t("The LAN bridge reports the AMS spools. An older bridge does not: restart it on the new code.")}</Info>
        </p>
      )}

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
            {!v.bedHolds ? (agentOn && agent?.bed
              ? <span title={t("Confirmed by {name}", { name: agent.bed.by })}>{t("Empty · agent may print once")}</span>
              : <span className="muted">{t("Empty")}</span>)
              : v.bedHolds.orderId ? <span className="mach-warn">{t("Holds part of")} <OrderRef id={v.bedHolds.orderId} orders={orders} /></span>
              : <span className="mach-warn">{t("Holds a print, no order")}</span>}
          </dd>
        </div>
        {agentOn && agent && (
          <div>
            <dt>{t("Next agent print")}</dt>
            <dd className="mach-agent">
              {agent.next
                ? <span className="one-line" title={agent.next.what}><Link href={`/orders/${agent.next.orderId}`}>{agent.next.orderId}</Link> · {agent.next.colours.map((c) => `${c.material} ${t(c.name)}`).join(" + ")}</span>
                : <span className="muted">{t("None")}</span>}
              {agent.why && <small className="muted">{whyLine(t, agent.why)}</small>}
            </dd>
          </div>
        )}
      </dl>

      {(v.orderId || offerBed) && (
        <div className="mach-actions">
          {offerBed && <button className="primary" disabled={busy} onClick={() => setAsking(true)}>{t("Bed is empty")}</button>}
          {v.orderId && <button disabled={busy} onClick={onUnlink} title={t("This printer no longer prints this order")}>{t("Unlink order")}</button>}
        </div>
      )}
      {note && <p className={`mach-note ${note.ok ? "ok" : "bad"}`} role="status">{note.text}</p>}

      <div className="mach-controls">
        <PrinterControls printer={p} now={now} onSent={onSent} />
        {v.online && s?.stage !== undefined && <CameraPanel printer={p} />}
      </div>

      <details className="fold">
        <summary>{t("Details")}</summary>
        <dl className="kv-rows">
          {speedText(s, t) && <div><dt>{t("Speed")}</dt><dd>{speedText(s, t)}</dd></div>}
          {s?.light && <div><dt>{t("Light")}</dt><dd>{s.light === "on" ? t("On") : s.light === "off" ? t("Off") : t("Flashing")}</dd></div>}
          {fans && <div><dt>{t("Fans")}</dt><dd>{fans}</dd></div>}
          {nozzleText(s, t, locale) && <div><dt>{t("Nozzle")}</dt><dd>{nozzleText(s, t, locale)}</dd></div>}
          {sd && <div><dt>{t("SD card")}</dt><dd className={sd === "in" ? undefined : "mach-warn"}>{t(SD_TEXT[sd])}</dd></div>}
          {wifi && <div><dt>Wi-Fi</dt><dd className={wifi === "weak" ? "mach-warn" : undefined}>{s?.wifiDbm} dBm · {t(wifi)}</dd></div>}
          {fw && <div><dt>{t("Firmware")}</dt><dd className="mono">{fw}</dd></div>}
          {s?.camera?.available && <div><dt>{t("Camera")}</dt><dd>{s.camera.recording ? t("Records every print to the SD card") : t("Yes")}</dd></div>}
          <div><dt>{t("Printer id")}</dt><dd className="mono">{v.id}</dd></div>
          <div><dt>{t("Reported state")}</dt><dd className="mono">{v.state ?? t("none")}</dd></div>
          <div><dt>{t("Takes a new job")}</dt><dd>{v.notReady ? <span className="muted">{t("No, {reason}", { reason: v.notReady })}</span> : t("Yes")}</dd></div>
          {v.errorCode && <div><dt>{t("Error code")}</dt><dd className="mono">{v.errorCode}</dd></div>}
          {info.map((h) => (
            <div key={h.code}><dt>{t("Printer note")}</dt><dd>{texts[h.code] ?? <code>{h.code}</code>} <a href={h.url} target="_blank" rel="noreferrer">{t("Open guide")}</a></dd></div>
          ))}
        </dl>
      </details>

      <ConfirmDialog open={asking} title={t("Is the bed empty?")} confirmLabel={t("Bed is empty")} busy={busy}
        onConfirm={(name) => { setAsking(false); onClearBed(name); }} onClose={() => setAsking(false)}>
        <p style={{ margin: 0 }}>{t("Take the print off {printer}. The plate is on the bed, clean and empty.", { printer: v.name })}</p>
        {agentOn && <p className="muted" style={{ margin: 0 }}>{t("Agent prints are on: the agent may then start one print here by itself, within 2 h.")}</p>}
      </ConfirmDialog>

      <ConfirmDialog open={checking} title={t("Are the colours right?")} confirmLabel={t("Colours are right")} busy={busy}
        onConfirm={(name) => { setChecking(false); onConfirmColors(name); }} onClose={() => setChecking(false)}>
        <p style={{ margin: 0 }}>{t("Look at each spool in the AMS of {printer}. Spools without a Bambu tag show black until someone sets their colour on the printer screen.", { printer: v.name })}</p>
        <div className="mach-slots-mini">
          {slots.filter((x) => !x.empty).map((x) => (
            <span key={x.tray}><ColorSwatch color={x.color} colors={x.colors} size={18} /> {t("Slot {n}", { n: x.slot })}: {x.type} {x.name ? t(x.name) : ""}</span>
          ))}
        </div>
      </ConfirmDialog>
    </article>
  );
}

const TASK_TITLE: Partial<Record<OperatorTask["kind"], string>> = { check_printer: "Check printer", change_filament: "Change filament" };

/** Open printer tasks with a link to the order (or the printer) and a Done button, since printer faults have no order page. */
export function PrinterTasks({ tasks, printers, orders, texts }: {
  tasks: OperatorTask[]; printers: Printer[]; orders: Record<string, OrderInfo>; texts: IssueTexts;
}) {
  const t = useT();
  const router = useRouter();
  const [closing, setClosing] = useState<OperatorTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = (id?: string) => printers.find((p) => p.id === id)?.name;

  async function done(task: OperatorTask, by: string) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await fetch(`/api/tasks/${task.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setProblem(tLib(t, j.error ?? t("Request failed ({status})", { status: r.status })));
      setClosing(null);
      router.refresh();
    } catch {
      setProblem(t("Request failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="printer-tasks" className="card attention-panel mach-tasks">
      <h2>{t("Open printer tasks")}</h2>
      <ul className="attention">
        {tasks.map((task) => {
          const title = TASK_TITLE[task.kind];
          // A printer fault with no order linked is filed under "printer:<id>": it has no order page, so link the printer card.
          const href = orders[task.orderId] ? `/orders/${task.orderId}` : `/machines#printer-${task.printerId ?? ""}`;
          return (
            <li key={task.id} className="mach-task">
              <Link href={href} className="attention-item">
                <span className={`attention-icon ${task.errorCode ? "red" : "amber"}`}><Icon name="wrench" /></span>
                <span className="attention-text">
                  <b>{title && t(title)}</b>{name(task.printerId) && ` · ${name(task.printerId)}`}
                  <span className="attention-sub">
                    {taskText(task, t, texts)}
                    {orders[task.orderId]?.label === "simulated" && <span className="badge simulated">{t("simulated")}</span>}
                  </span>
                </span>
                <Icon name="chevron" size={16} className="attention-go" />
              </Link>
              <button className="mach-task-done" disabled={busy} onClick={() => setClosing(task)}>{t("Done")}</button>
            </li>
          );
        })}
      </ul>
      {problem && <p className="mach-note bad" role="status">{problem}</p>}
      <ConfirmDialog open={Boolean(closing)} title={t("Mark this task done?")} confirmLabel={t("Done")} busy={busy}
        onConfirm={(by) => closing && void done(closing, by)} onClose={() => setClosing(null)}>
        <p style={{ margin: 0 }}>{closing && taskText(closing, t, texts)}</p>
        {closing?.errorCode && <p className="muted" style={{ margin: 0 }}>{t("It opens again only if the fault clears and then comes back.")}</p>}
      </ConfirmDialog>
    </section>
  );
}
