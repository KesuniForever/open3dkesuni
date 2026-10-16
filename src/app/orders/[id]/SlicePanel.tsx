"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, ColorChoice, Order, Printer, SliceJob, SliceQuality } from "@/lib/types";
import { DEFAULT_INFILL_PCT, QUALITY, SLICE_QUALITIES, sliceSourceCheck } from "@/lib/slice-rules";
import { deltaE, MATCH_MAX_DELTA_E, nameOf } from "@/lib/colors";
import { toMaterial } from "@/lib/pricing";
import { duration } from "@/lib/machines";
import { tLib } from "@/lib/lib-text";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import ColorSwatch from "@/app/components/ColorSwatch";
import { ConfirmDialog } from "@/app/components/PrinterControls";
import { amsSlots, slotText } from "@/app/machines/printer-details";
import { units } from "./rich";
import "./slice.css";

export type SlicerStatus = { seenAt: string | null; ready: boolean };
/** loaded: the first read came back (or failed): until then nobody knows which sliced file is a weighing. */
export interface SliceData { jobs: SliceJob[]; slicer: SlicerStatus | null; reload: () => void; loaded?: boolean }

const ACTIVE: SliceJob["state"][] = ["queued", "slicing"];
const POLL_MS = 3_000;
const STATE_LABEL: Record<SliceJob["state"], string> = {
  queued: "Waiting for the studio PC", slicing: "Slicing…", done: "Sliced", failed: "Failed", cancelled: "Cancelled",
};
const STATE_TONE: Record<SliceJob["state"], string> = { queued: "", slicing: "warn", done: "ok", failed: "bad", cancelled: "" };
/** Shown at once (the newest); older slices fold away. */
const SHOWN = 1;

/** The order's slices (newest first) and the studio PC's slicer, followed while a slice runs. onDone: a slice finished (the order has a new file). */
export function useSliceJobs(orderId: string, onDone: () => void): SliceData {
  const [jobs, setJobs] = useState<SliceJob[]>([]);
  const [slicer, setSlicer] = useState<SlicerStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const states = useRef(new Map<string, SliceJob["state"]>());
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/slice-jobs?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) return setLoaded(true);
        const body = (await r.json()) as { jobs: SliceJob[]; slicer: SlicerStatus };
        if (cancelled) return;
        // A slice that was running is done now: the order has a new sliced file.
        const finished = body.jobs.some((j) => j.state === "done" && states.current.has(j.id) && states.current.get(j.id) !== "done");
        states.current = new Map(body.jobs.map((j) => [j.id, j.state]));
        setJobs(body.jobs);
        setSlicer(body.slicer);
        setLoaded(true);
        if (finished) done.current();
      })
      .catch(() => { if (!cancelled) setLoaded(true); /* the next poll tries again */ });
    return () => { cancelled = true; };
  }, [orderId, version]);
  const running = jobs.some((j) => ACTIVE.includes(j.state));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);
  return { jobs, slicer, reload, loaded };
}

/** The spools a slice can use on this printer: PLA or PETG with a colour. */
const usable = (p: Printer | undefined) => amsSlots(p?.snapshot).filter((s) => !s.empty && s.color && toMaterial(s.type));

/** A spool is one of the customer's colours: same material, colour within the colour limit. */
const customersColour = (colors: ColorChoice[], s: { type: string | null; color: string | null }) =>
  colors.some((c) => toMaterial(s.type) === c.type && Boolean(s.color) && deltaE(c.color, s.color!) <= MATCH_MAX_DELTA_E);

/** The customer's colour if this printer has it loaded, else the order's material, else the first usable spool. */
function bestTray(p: Printer | undefined, order: Order): number | null {
  const slots = usable(p);
  for (const c of order.preferredColors ?? []) {
    const hit = slots.find((s) => toMaterial(s.type) === c.type && deltaE(c.color, s.color!) <= MATCH_MAX_DELTA_E);
    if (hit) return hit.tray;
  }
  const material = order.material ?? toMaterial(order.spec?.material);
  return (slots.find((s) => material && toMaterial(s.type) === material) ?? slots[0])?.tray ?? null;
}

const grams = (n: number, locale: Locale) => `${n.toLocaleString(dateLocale(locale), { maximumFractionDigits: 2 })} g`;
const shortName = (name: string) => /#\d+$/.exec(name)?.[0] ?? name;

/** The colours the customer picked, and where each one is loaded now (same material, close colour). */
export function CustomerColours({ colors, printers, t }: { colors: ColorChoice[]; printers: Printer[]; t: T }) {
  if (!colors.length) return null;
  const where = (c: ColorChoice) => printers.flatMap((p) => (p.snapshot?.ams?.trays ?? [])
    .filter((x) => !x.empty && x.type === c.type && x.color && deltaE(c.color, x.color) <= MATCH_MAX_DELTA_E)
    .map((x) => t("{printer} slot {slots}", { printer: shortName(p.name), slots: x.slot + 1 })));
  const reported = printers.some((p) => p.snapshot?.ams);
  return (
    <div className="pp-wish">
      <span className="pp-label">{t("Customer's colours")}</span>
      <ul>
        {colors.map((c) => {
          const at = where(c);
          return (
            <li key={c.type + c.color}>
              <ColorSwatch color={c.color} size={20} title={c.color} />
              <span><b>{c.type} {t(c.name ?? nameOf(c.color))}</b>
                <small className={at.length ? undefined : "pp-missing"}>{at.length ? at.join(" · ") : reported ? t("not loaded now") : t("AMS not reported yet")}</small>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Step 2 · Slice: an order's STL/OBJ (or an unsliced A1 3MF) becomes a printable .gcode.3mf on the studio PC, in the
 * material and colour of one AMS spool. The sliced file then prints in step 4, from that spool. Single colour only.
 * Nothing prints from here.
 */
export default function SlicePanel({ order, attachments, printers, data, t, locale }: {
  order: Order; attachments: Attachment[]; printers: Printer[]; data: SliceData; t: T; locale: Locale;
}) {
  const sources = attachments.filter((a) => a.kind === "design" && sliceSourceCheck(a).ok).reverse();
  const steps = attachments.filter((a) => /\.(step|stp)$/i.test(a.filename));
  const [sourceId, setSourceId] = useState<string | null>(null);
  const source = sources.find((a) => a.id === sourceId) ?? sources[0];
  const mode = source ? (sliceSourceCheck(source) as { ok: true; mode: SliceJob["mode"] }).mode : "mesh";
  const withSpools = printers.filter((p) => usable(p).length > 0);
  const [printerId, setPrinterId] = useState<string | null>(null);
  const printer = withSpools.find((p) => p.id === printerId)
    ?? withSpools.find((p) => (order.preferredColors ?? []).some((c) => usable(p).some((s) => toMaterial(s.type) === c.type && deltaE(c.color, s.color!) <= MATCH_MAX_DELTA_E)))
    ?? withSpools[0];
  const [trays, setTrays] = useState<Record<string, number>>({});
  const slots = usable(printer);
  const tray = printer ? (trays[printer.id] ?? bestTray(printer, order)) : null;
  const spool = slots.find((s) => s.tray === tray);
  const [quality, setQuality] = useState<SliceQuality>("standard");
  const [infill, setInfill] = useState(String(order.spec?.infillPct ?? DEFAULT_INFILL_PCT));
  const [supports, setSupports] = useState<SliceJob["supports"]>("auto");
  const [asking, setAsking] = useState<"slice" | SliceJob | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);

  const wanted = order.preferredColors ?? [];
  const material = order.material ?? order.spec?.material;
  // What the customer wants and where each of their colours is loaded: shown also when nothing can be sliced here (a
  // sliced 3MF or a STEP file only), since no other step shows the customer's colours.
  const wants = (
    <div className="sp-wants">
      <p className="sp-note"><span className="pp-label">{t("Customer wants")}</span>{" "}
        {units(t, order.quantity)}{material ? ` · ${material}` : ""}</p>
      <CustomerColours colors={wanted} printers={printers} t={t} />
      {order.spec?.color && <p className="sp-note">{t("Spec colour: {color}", { color: order.spec.color })}</p>}
    </div>
  );

  if (!sources.length && !data.jobs.length) {
    return (
      <div className="sp" id="slice">
        {wants}
        {steps.length > 0 && <p className="muted sp-note">{t("STEP files cannot be sliced here: export an STL from the CAD program")}</p>}
      </div>
    );
  }
  const infillPct = Number(infill);
  const infillOk = Number.isInteger(infillPct) && infillPct >= 0 && infillPct <= 100;
  const ready = Boolean(source && printer && spool && infillOk);
  const settings = mode === "project"
    ? t("Project settings")
    : `${t(QUALITY[quality].label)} · ${t("infill {n}%", { n: infillOk ? infillPct : "?" })} · ${supports === "auto" ? t("supports auto") : t("no supports")}`;
  const notTheirs = Boolean(spool && wanted.length && !customersColour(wanted, spool));
  // The studio PC was seen and is not ready: one line says what to do (the dot's own label would repeat it).
  const pcOff = Boolean(data.slicer && !data.slicer.ready);

  async function slice(by: string) {
    if (!source || !printer || tray === null) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch("/api/slice-jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.id, attachmentId: source.id, printerId: printer.id, tray, quality, infillPct, supports, by }),
      });
      const j = (await r.json().catch(() => ({}))) as { job?: SliceJob; warnings?: string[]; reused?: string | null; error?: string; reasons?: string[] };
      if (r.ok && j.job) {
        const text = j.reused === "done" ? t("Already sliced with these settings.") : j.reused === "active" ? t("This slice is already on its way.") : t("Sent to the studio PC.");
        setMsg({ ok: true, text, list: (j.warnings ?? []).map((w) => tLib(t, w)) });
        data.reload();
      } else {
        setMsg({ ok: false, text: tLib(t, j.error ?? t("Request failed ({status})", { status: r.status })), list: (j.reasons ?? []).map((x) => tLib(t, x)) });
      }
    } catch {
      setMsg({ ok: false, text: t("Request failed") });
    } finally {
      setSending(false);
      setAsking(null);
    }
  }

  async function cancel(job: SliceJob, by: string) {
    setSending(true);
    try {
      const r = await fetch(`/api/slice-jobs/${encodeURIComponent(job.id)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", by }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setMsg(r.ok ? { ok: true, text: t("Slice cancelled.") } : { ok: false, text: tLib(t, j.error ?? t("Request failed")) });
      data.reload();
    } catch {
      setMsg({ ok: false, text: t("Request failed") });
    } finally {
      setSending(false);
      setAsking(null);
    }
  }

  const shown = data.jobs.slice(0, SHOWN);
  const older = data.jobs.slice(SHOWN);
  const row = (j: SliceJob) => <SliceRow key={j.id} job={j} printers={printers} busy={sending} t={t} locale={locale} onCancel={() => setAsking(j)} />;

  return (
    <div className="sp" id="slice">
      {wants}

      {sources.length > 0 && (
        <>
          <div className="row fields sp-pick">
            {sources.length > 1 && (
              <label className="sp-file">{t("File")}
                <select value={source?.id} onChange={(e) => setSourceId(e.target.value)} disabled={sending}>
                  {sources.map((a) => <option key={a.id} value={a.id}>{a.filename}</option>)}
                </select>
              </label>
            )}
            <label className="sp-printer">{t("Printer")}
              <select value={printer?.id ?? ""} onChange={(e) => setPrinterId(e.target.value)} disabled={sending || !withSpools.length}>
                {!withSpools.length && <option value="">{t("No spools reported")}</option>}
                {withSpools.map((p) => <option key={p.id} value={p.id}>{shortName(p.name)}</option>)}
              </select>
            </label>
            <label className="sp-spool">{t("Spool")}
              <span className="sp-spool-pick">
                <ColorSwatch color={spool?.color} size={20} />
                <select value={tray ?? ""} onChange={(e) => printer && setTrays({ ...trays, [printer.id]: Number(e.target.value) })} disabled={sending || !slots.length}>
                  {slots.map((s) => (
                    <option key={s.tray} value={s.tray}>
                      {slotText(s.tray, t)} · {s.type} {s.name ? t(s.name) : ""}{customersColour(wanted, s) ? ` · ${t("customer's colour ✓")}` : ""}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          {notTheirs && <p className="sp-warn">{t("This spool is not one of the customer's colours.")}</p>}
          {mode === "mesh" ? (
            <details className="fold sp-settings">
              <summary>{t("Settings: {settings}", { settings })}</summary>
              <div className="row fields sp-pick">
                <label className="sp-quality">{t("Quality")}
                  <select value={quality} onChange={(e) => setQuality(e.target.value as SliceQuality)} disabled={sending}>
                    {SLICE_QUALITIES.map((q) => <option key={q} value={q}>{t(QUALITY[q].label)}</option>)}
                  </select>
                </label>
                <label className="sp-infill">{t("Infill %")}
                  <input type="number" min={0} max={100} step={1} inputMode="numeric" value={infill} onChange={(e) => setInfill(e.target.value)} disabled={sending} />
                </label>
                <label className="sp-supports">{t("Supports")}
                  <select value={supports} onChange={(e) => setSupports(e.target.value as SliceJob["supports"])} disabled={sending}>
                    <option value="auto">{t("Auto")}</option>
                    <option value="off">{t("Off")}</option>
                  </select>
                </label>
              </div>
              <p className="muted sp-note">{t("One colour: an STL carries no colours.")}</p>
            </details>
          ) : (
            <p className="muted sp-note">{t("Keeps the project's own settings; one colour.")}</p>
          )}
          <div className="row sp-go">
            <button className="primary" disabled={!ready || sending} onClick={() => setAsking("slice")}>{t("Slice")}</button>
            {!pcOff && (
              <span className={`sp-pc ${data.slicer?.ready ? "ok" : ""}`}>
                <span className="sp-dot" aria-hidden />{data.slicer?.ready ? t("Studio PC ready") : t("Studio PC not seen")}
              </span>
            )}
          </div>
          {/* The button stays on: a slice waits up to 15 min for the studio PC. */}
          {pcOff && (
            <p className="sp-warn">{t("The slicing PC is off. Turn on the studio PC (Bambu Studio and the Kesuni bridge) or tell the owner. A slice waits up to 15 min.")}</p>
          )}
        </>
      )}

      {msg && (
        <div className={`alert ${msg.ok ? "ok" : "bad"}`} role="status">
          {msg.text}{msg.list && msg.list.length > 0 && <ul>{msg.list.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}

      {shown.length > 0 && <ol className="sp-jobs">{shown.map(row)}</ol>}
      {older.length > 0 && (
        <details className="fold sp-older">
          <summary>{t("Older slices ({n})", { n: older.length })}</summary>
          <ol className="sp-jobs">{older.map(row)}</ol>
        </details>
      )}

      <ConfirmDialog open={asking === "slice"} title={t("Slice this file?")} confirmLabel={t("Slice")} busy={sending}
        onConfirm={(by) => void slice(by)} onClose={() => setAsking(null)}>
        {source && printer && spool && (
          <>
            <p style={{ margin: 0, overflowWrap: "anywhere" }}><b>{source.filename}</b></p>
            <p style={{ margin: 0 }} className="sp-confirm-spool">
              <ColorSwatch color={spool.color} size={16} /> {spool.type} {spool.name ? t(spool.name) : ""} · {shortName(printer.name)} {slotText(spool.tray, t)}
            </p>
            <p className="muted" style={{ margin: 0 }}>{settings}</p>
          </>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={typeof asking === "object" && asking !== null} title={t("Cancel this slice?")} confirmLabel={t("Cancel slice")} danger busy={sending}
        onConfirm={(by) => { if (asking && typeof asking === "object") void cancel(asking, by); }} onClose={() => setAsking(null)}>
        <p style={{ margin: 0 }}>{typeof asking === "object" && asking ? asking.sourceName : ""}</p>
      </ConfirmDialog>
    </div>
  );
}

/** One slice: file, spool and settings, its state, and the result (time and grams) or the reason it failed. */
function SliceRow({ job: j, printers, busy, onCancel, t, locale }: {
  job: SliceJob; printers: Printer[]; busy: boolean; onCancel: () => void; t: T; locale: Locale;
}) {
  const p = printers.find((x) => x.id === j.printerId);
  const r = j.result;
  return (
    <li className={`sp-job ${j.state}`}>
      <div className="sp-job-head">
        <ColorSwatch color={j.color} size={16} />
        <span className="sp-job-what">
          <b>{j.sourceName}</b>
          <small className="muted">
            {j.material} {t(nameOf(j.color))} · {j.mode === "project" ? t("Project settings") : `${t(QUALITY[j.quality].label)} · ${j.infillPct}%`}
            {p ? ` · ${shortName(p.name)} ${slotText(j.tray, t)}` : ""}{j.actor === "agent" ? ` · ${t("by the agent")}` : ""}
          </small>
        </span>
        <span className="sp-job-badges">
          {j.actor === "system" && <span className="badge warn">{t("For the price only")}</span>}
          <span className={`badge ${STATE_TONE[j.state]}`}>{t(STATE_LABEL[j.state])}</span>
        </span>
      </div>
      {j.state === "done" && r && (
        <p className="sp-result">{r.predictionSec ? duration(r.predictionSec / 60, false, t) : "—"} · {r.weightG != null ? grams(r.weightG, locale) : "—"}</p>
      )}
      {j.error && j.state !== "cancelled" && <p className="sp-error">{tLib(t, j.error)}</p>}
      {ACTIVE.includes(j.state) && (
        <div className="row"><button onClick={onCancel} disabled={busy}>{t("Cancel")}</button></div>
      )}
    </li>
  );
}
