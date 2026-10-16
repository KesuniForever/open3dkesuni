"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { Printer, PrinterCommand, PrinterCommandKind } from "@/lib/types";
import { SPEED_LABEL, SPEED_LEVELS, type SpeedLevel } from "@/lib/printer/bambu";
import { commandReasons } from "@/lib/printer/control";
import { tLib } from "@/lib/lib-text";
import { useT } from "@/i18n/client";
import { pauseNeedsFix, stageText } from "../machines/printer-details";

// Printer controls for PEOPLE: pause, resume, stop, print speed and the light. Each one asks first (a dialog with the
// person's name) and goes to POST /api/printers/<id>/command; the LAN bridge carries it out and reports back. Nothing
// here moves an axis, heats, or sends G-code, and the Chief has no way to reach it.

// ---------- the person's name, remembered in this browser ----------

const NAME_KEY = "kesuni.operatorName";
const NAME_EVENT = "kesuni-operator-name";
let memoryName = "";
function readName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? memoryName; } catch { return memoryName; }
}
function subscribeName(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(NAME_EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(NAME_EVENT, onChange); };
}

/** The operator's name for printer controls. Remembered in this browser only, for convenience: every request sends it. */
export function useOperatorName(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribeName, readName, () => "");
  const set = useCallback((v: string) => {
    memoryName = v.slice(0, 60);
    try { localStorage.setItem(NAME_KEY, memoryName); } catch { /* private window: kept in memory for this visit */ }
    window.dispatchEvent(new Event(NAME_EVENT));
  }, []);
  return [name, set];
}

// ---------- the confirm dialog ----------

const DIALOG: CSSProperties = {
  width: "min(440px, calc(100vw - 32px))", maxWidth: "none", maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
  border: "1px solid var(--border)", borderRadius: 14, padding: "20px 20px 18px", background: "var(--surface)", color: "var(--text)",
  boxShadow: "0 20px 50px rgba(32, 41, 54, 0.25)",
};

/** A modal that asks a person to confirm, with their name. `ready` false keeps the confirm button off (a box to tick). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, ready = true, busy = false, onConfirm, onClose }: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  ready?: boolean;
  busy?: boolean;
  onConfirm: (by: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useOperatorName();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const by = name.trim();
  return (
    // Escape cannot close the dialog while its action runs (like its Cancel button).
    <dialog ref={ref} className="pc-dialog" style={DIALOG} onClose={onClose} onCancel={(e) => { if (busy) e.preventDefault(); }} aria-label={title}>
      {open && (
        <form onSubmit={(e) => { e.preventDefault(); if (ready && by && !busy) onConfirm(by); }}>
          <h2 style={{ fontSize: 17, margin: "0 0 10px", letterSpacing: "-0.3px" }}>{title}</h2>
          <div style={{ fontSize: 14, lineHeight: 1.55, display: "grid", gap: 8 }}>{children}</div>
          <label style={{ marginTop: 14 }}>{t("Your name")}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Khelda")} maxLength={60} autoFocus={!by} disabled={busy} />
          </label>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <button type="button" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
            <button type="submit" className={danger ? "danger" : "primary"} disabled={busy || !ready || !by} autoFocus={Boolean(by)}>{confirmLabel}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

// ---------- controls for one printer ----------

type ControlKind = Extract<PrinterCommandKind, "pause" | "resume" | "stop" | "speed" | "light">;
type Ask = { kind: ControlKind; params: Record<string, number | boolean> };

const FINAL: PrinterCommand["state"][] = ["done", "failed", "expired"];
const POLL_MS = 2000;
/** Stop following a command after this; the bridge expires an unclaimed one after 60 s. */
const WATCH_MS = 90_000;
/** A resume the printer accepted but did not act on (spec §4.1): tell the person after this. */
const RESUME_CHECK_MS = 15_000;

const KIND_LABEL: Record<PrinterCommandKind, string> = {
  pause: "Pause", resume: "Resume", stop: "Stop", speed: "Speed", light: "Light", get_version: "Firmware check", camera_snapshot: "Camera",
};
const STATE_TEXT: Record<PrinterCommand["state"], string> = {
  queued: "waiting for the bridge…", sent: "sent to the printer…", done: "done", failed: "failed", expired: "not picked up",
};

/** Pause / resume / stop, print speed and the light for one printer. Shown only while the printer is online. */
export default function PrinterControls({ printer, now, onSent }: { printer: Printer; now: number; onSent?: () => void }) {
  const t = useT();
  const s = printer.snapshot;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [fixed, setFixed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState<PrinterCommand | null>(null);
  const [error, setError] = useState<{ text: string; reasons?: string[] } | null>(null);

  // Follow the last command until the bridge reports it done or failed, or it expires.
  useEffect(() => {
    if (!cmd || FINAL.includes(cmd.state)) return;
    const started = Date.parse(cmd.createdAt);
    const timer = setInterval(async () => {
      if (Date.now() - started > WATCH_MS) { clearInterval(timer); return; }
      try {
        const r = await fetch(`/api/printers/${printer.id}/command`, { cache: "no-store" });
        const j = (await r.json()) as { commands?: PrinterCommand[] };
        const next = j.commands?.find((c) => c.id === cmd.id);
        if (next && next.state !== cmd.state) setCmd(next);
      } catch { /* try again on the next tick */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [cmd, printer.id]);

  async function send(by: string) {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      // After a fault pause the person ticked "I fixed the cause": the server and the bridge check it again.
      const params = ask.kind === "resume" && needFix && fixed ? { ...ask.params, fixed: true } : ask.params;
      const r = await fetch(`/api/printers/${printer.id}/command`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: ask.kind, params, by, confirm: true }),
      });
      const j = (await r.json().catch(() => ({}))) as { command?: PrinterCommand; error?: string; reasons?: string[] };
      if (!r.ok || !j.command) setError({ text: j.error ?? t("Request failed ({status})", { status: r.status }), reasons: j.reasons });
      else { setCmd(j.command); onSent?.(); }
      setAsk(null);
      setFixed(false);
    } catch {
      setError({ text: t("Request failed") });
    } finally {
      setBusy(false);
    }
  }

  const state = s?.state;
  const needFix = pauseNeedsFix(s);
  if (commandReasons(printer, "light", { on: true }, now).length) {
    return <p className="muted mach-ctl-off">{t("Controls work while the printer is online.")}</p>;
  }
  // An older bridge reports no stage and takes no commands: a control would only wait and expire.
  if (s && s.stage === undefined) {
    return <p className="muted mach-ctl-off">{t("Controls need the new LAN bridge: restart it on the new code.")}</p>;
  }
  const active = state === "PREPARE" || state === "RUNNING" || state === "PAUSE";
  const job = s?.jobName ?? t("this print");
  const pct = `${Math.floor(s?.percent ?? 0)}%`;
  const lightOn = s?.light === "on";
  const level = (s?.speedLevel ?? 2) as SpeedLevel;
  const why = [stageText(s, t), s?.printError ? t("error {code}", { code: s.printError.code }) : null].filter(Boolean).join(" · ");
  const stuck = cmd?.kind === "resume" && cmd.state === "done" && state === "PAUSE" && cmd.doneAt && now - Date.parse(cmd.doneAt) > RESUME_CHECK_MS;

  let dialog: { title: string; body: ReactNode; confirm: string; danger?: boolean; ready?: boolean } | null = null;
  if (ask?.kind === "pause") {
    dialog = { title: t("Pause the print?"), body: <p style={{ margin: 0 }}>{t("{job} on {printer}, {pct} done.", { job, printer: printer.name, pct })}</p>, confirm: t("Pause") };
  } else if (ask?.kind === "resume") {
    dialog = {
      title: t("Resume the print?"), confirm: t("Resume"), ready: !needFix || fixed,
      body: (
        <>
          <p style={{ margin: 0 }}>{t("{job} on {printer}, {pct} done.", { job, printer: printer.name, pct })}</p>
          {why && <p style={{ margin: 0 }}>{t("Why: {why}", { why })}</p>}
          {needFix && (
            <label className="row" style={{ gap: 8, color: "var(--text)", fontSize: 14, flexWrap: "nowrap", alignItems: "flex-start" }}>
              <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} style={{ marginTop: 3 }} />
              {t("I fixed the cause at the printer")}
            </label>
          )}
        </>
      ),
    };
  } else if (ask?.kind === "stop") {
    dialog = {
      title: t("Stop the print?"), confirm: t("Stop print"), danger: true,
      body: <p style={{ margin: 0 }}>{t("Stop {job} on {printer}? This cannot be undone; the print is lost.", { job, printer: printer.name })}</p>,
    };
  } else if (ask?.kind === "speed") {
    const to = ask.params.level as SpeedLevel;
    dialog = {
      title: t("Change the print speed?"), confirm: t("Change speed"),
      body: (
        <>
          <p style={{ margin: 0 }}>{printer.name}: <b>{t(SPEED_LABEL[level])}</b> → <b>{t(SPEED_LABEL[to])}</b></p>
          {to === 4 && <p className="mach-warn" style={{ margin: 0 }}>{t("Ludicrous speed lowers the print quality.")}</p>}
        </>
      ),
    };
  } else if (ask?.kind === "light") {
    const on = ask.params.on === true;
    dialog = {
      title: on ? t("Turn the light on?") : t("Turn the light off?"), confirm: on ? t("Light on") : t("Light off"),
      body: <p style={{ margin: 0 }} className="muted">{on ? printer.name : t("The camera shows almost nothing with the light off.")}</p>,
    };
  }

  const tone = !cmd ? "" : cmd.state === "done" ? "ok" : cmd.state === "failed" || cmd.state === "expired" ? "bad" : "";
  return (
    <div className="mach-ctl">
      <div className="mach-actions">
        {(state === "RUNNING" || state === "PREPARE") && <button disabled={busy} onClick={() => setAsk({ kind: "pause", params: {} })}>{t("Pause")}</button>}
        {state === "PAUSE" && <button className="primary" disabled={busy} onClick={() => setAsk({ kind: "resume", params: {} })}>{t("Resume")}</button>}
        {active && <button className="danger" disabled={busy} onClick={() => setAsk({ kind: "stop", params: {} })}>{t("Stop")}</button>}
        {state === "RUNNING" && (
          <select className="mach-speed" aria-label={t("Print speed")} value={level} disabled={busy}
            onChange={(e) => { const l = Number(e.target.value); if (l !== level) setAsk({ kind: "speed", params: { level: l } }); }}>
            {SPEED_LEVELS.map((l) => <option key={l} value={l}>{t(SPEED_LABEL[l])}</option>)}
          </select>
        )}
        <button disabled={busy} aria-pressed={lightOn} onClick={() => setAsk({ kind: "light", params: { on: !lightOn } })}>
          {lightOn ? t("Light off") : t("Light on")}
        </button>
      </div>
      {cmd && (
        <p className={`mach-note ${tone}`} role="status">
          {t("{what} by {name}: {state}", { what: t(KIND_LABEL[cmd.kind]), name: cmd.by, state: t(STATE_TEXT[cmd.state]) })}
          {cmd.result && cmd.state !== "done" && <> · {tLib(t, cmd.result)}</>}
        </p>
      )}
      {stuck && <p className="mach-note bad" role="status">{t("The printer did not resume. Check the printer screen.")}</p>}
      {error && (
        <p className="mach-note bad" role="status">
          {tLib(t, error.text)}{error.reasons?.length ? `: ${error.reasons.map((r) => tLib(t, r)).join("; ")}` : ""}
        </p>
      )}
      <ConfirmDialog open={Boolean(dialog)} title={dialog?.title ?? ""} confirmLabel={dialog?.confirm ?? ""} danger={dialog?.danger}
        ready={dialog?.ready ?? true} busy={busy} onConfirm={(by) => void send(by)} onClose={() => { setAsk(null); setFixed(false); }}>
        {dialog?.body}
      </ConfirmDialog>
    </div>
  );
}
