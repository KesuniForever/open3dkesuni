"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Attachment, ColorChoice, Order, PrintJob, PrintJobState, PrintOptions, Printer, ThreeMfPlate } from "@/lib/types";
import { canStartPrint } from "@/lib/printer/control";
import { deltaE, matchJob, MATCH_MAX_DELTA_E, nameOf, normalizeHex } from "@/lib/colors";
import { COLOR_MODE_LABEL, type ColorMode } from "@/lib/pricing";
import { duration } from "@/lib/machines";
import { tLib } from "@/lib/lib-text";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import Info from "@/app/components/Info";
import ColorSwatch from "@/app/components/ColorSwatch";
import { ConfirmDialog } from "@/app/components/PrinterControls";
import { amsSlots, bedTypeLabel, issueViews, mm, slotText, type IssueTexts } from "@/app/machines/printer-details";
import { sliceSourceCheck } from "@/lib/slice-rules";
import SlicePanel, { useSliceJobs } from "./SlicePanel";
import AgentPrintRow, { type OrderAutoPrintView } from "./AgentPrintRow";
import "./print.css";

type Act = (url: string, body: unknown, success: string) => Promise<void>;
type Msg = { ok: boolean; text: string; list?: string[] };

const is3mf = (a: Attachment) => a.filename.toLowerCase().endsWith(".3mf");
const OPEN: PrintJobState[] = ["queued", "uploading", "sent", "printing"];
const STEPS: PrintJobState[] = ["queued", "uploading", "sent", "printing", "done"];
const STEP_LABEL: Record<PrintJobState, string> = {
  queued: "In queue", uploading: "Uploading", sent: "Sent", printing: "Printing", done: "Done", failed: "Failed", cancelled: "Cancelled",
};
const JOBS_POLL_MS = 4_000;
/** The bridge's text when an A1 did not start with file:///sdcard/: a person may try the ftp:/// path next (spec §4.5). */
const NO_START = "The printer did not start within 45 s";
/** "Printer error 0500-4033: fix it before printing" -> "0500-4033", to add Bambu's words. */
const FAULT_REASON = /^Printer error (\S+): fix it before printing$/;
const CLOCK_MS = 5_000;
/** The checks a person cannot change here (name, bed, presence) count as done when the page judges a printer. */
const AS_IF_CONFIRMED = { bedEmptyConfirmed: true, personPresent: true, by: "Operator", warningsChecked: true };
const DEFAULT_OPTIONS: PrintOptions = { bedLevelling: true, flowCali: true, timelapse: false, useAms: true };
/** Grams the way the visitor writes numbers: "9.82 g", "9,82 g". */
const grams = (n: number, locale: Locale) => `${n.toLocaleString(dateLocale(locale), { maximumFractionDigits: 2 })} g`;
/** "A1 Combo #2" -> "#2". */
const shortName = (name: string) => /#\d+$/.exec(name)?.[0] ?? name;

/**
 * Colours & print: the customer's colours and where they are loaded, the order's sliced Bambu Studio file (plates,
 * filaments, the slicer's time and grams, which can price the order), which printer can print it with which AMS slot
 * for each filament, and the person's start: bed empty, at the printer, name. The LAN bridge uploads the file and starts
 * the print. The Chief (Claude) has no way to start a print; with agent prints on, code may (AgentPrintRow).
 */
export default function PrintPanel({ order, attachments, printers, paid, issueTexts, autoPrint, busy, act, onChange }: {
  order: Order;
  attachments: Attachment[];
  printers: Printer[];
  /** The customer paid into escrow (a real order that is not paid is a warning, not a block). */
  paid: boolean;
  issueTexts: IssueTexts;
  /** Agent prints for this order (GET /api/orders/:id autoPrint). */
  autoPrint?: OrderAutoPrintView | null;
  busy: boolean;
  act: Act;
  onChange: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const files = attachments.filter(is3mf).reverse(); // newest first
  const [fileId, setFileId] = useState<string | null>(null);
  const file = files.find((f) => f.id === fileId) ?? files.find((f) => f.parsed3mf?.sliced) ?? files[0];
  const info = file?.parsed3mf;
  const plates = info?.sliced ? info.plates : [];
  const [plateNo, setPlateNo] = useState<number | null>(null);
  const plate = plates.find((p) => p.index === plateNo) ?? plates[0];

  const [now, setNow] = useState(() => Date.now());
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [printerId, setPrinterId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, number[]>>({});
  const [opts, setOpts] = useState<PrintOptions>(DEFAULT_OPTIONS);
  const [bedEmpty, setBedEmpty] = useState(false);
  const [atPrinter, setAtPrinter] = useState(false);
  const [checked, setChecked] = useState(false);
  const [asking, setAsking] = useState<"start" | "grams" | PrintJob | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [units, setUnits] = useState("");
  const [ftp, setFtp] = useState(false);
  // Slicing on the studio PC (SlicePanel): a finished slice adds a sliced file to the order, so the order reloads.
  const slices = useSliceJobs(order.id, onChange);
  const canSlice = attachments.some((a) => a.kind === "design" && sliceSourceCheck(a).ok);

  const [jobsVersion, setJobsVersion] = useState(0);
  const loadJobs = useCallback(() => setJobsVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/print-jobs?orderId=${encodeURIComponent(order.id)}`, { cache: "no-store" })
      .then(async (r) => { if (r.ok && !cancelled) setJobs(((await r.json()) as { jobs: PrintJob[] }).jobs); })
      .catch(() => { /* the next poll tries again */ });
    return () => { cancelled = true; };
  }, [order.id, jobsVersion]);
  const open = jobs.some((j) => OPEN.includes(j.state));
  // Follow open jobs (queued -> uploading -> sent -> printing -> done) while the page is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(loadJobs, JOBS_POLL_MS);
    return () => clearInterval(timer);
  }, [open, loadJobs]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  // ---------- each printer: can it print this plate, with which slots ----------
  const count = info?.projectFilaments?.length;
  const key = (pid: string) => `${file?.id}:${plate?.index}:${pid}`;
  const inFlight = (pid: string) => jobs.find((j) => j.printerId === pid && ["queued", "uploading", "sent"].includes(j.state))?.id ?? null;
  // A file the studio PC sliced prints from the spool that was picked for it, unless the person picks another slot.
  const slicedFor = file ? slices.jobs.find((j) => j.state === "done" && j.resultAttachmentId === file.id) : undefined;
  const rows = plate ? printers.map((p) => {
    const match = matchJob(plate.filaments, p, count);
    const mapping = edits[key(p.id)] ?? (slicedFor?.printerId === p.id && count === 1 ? [slicedFor.tray] : match.mapping);
    const verdict = canStartPrint(p, { info, plate: plate.index, amsMapping: mapping, options: opts, orderId: order.id, jobInFlight: inFlight(p.id), ...AS_IF_CONFIRMED }, now);
    return { p, match, mapping, verdict, warnings: [...verdict.warnings, ...colourWarnings(plate, p, mapping, opts)] };
  }) : [];
  const picked = rows.find((r) => r.p.id === printerId) ?? rows.find((r) => r.p.id === slicedFor?.printerId && r.verdict.ok) ?? rows.find((r) => r.verdict.ok) ?? rows.find((r) => r.p.currentOrderId === order.id) ?? rows[0];

  function setSlot(filamentId: number, tray: number) {
    if (!picked) return;
    const next = [...picked.mapping];
    next[filamentId - 1] = tray;
    setEdits((e) => ({ ...e, [key(picked.p.id)]: next }));
  }

  async function start(by: string) {
    if (!picked || !plate || !file) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch("/api/print-jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.id, printerId: picked.p.id, attachmentId: file.id, plate: plate.index, amsMapping: picked.mapping, options: opts, by,
          bedEmptyConfirmed: bedEmpty, personPresent: atPrinter, warningsChecked: checked, ...(ftp ? { urlForm: "ftp" } : {}),
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { job?: PrintJob; error?: string; reasons?: string[]; warnings?: string[] };
      if (r.ok && j.job) {
        setMsg({ ok: true, text: t("Print job {id} is waiting for the bridge. It uploads the file to the SD card and starts the print.", { id: j.job.id }), list: (j.warnings ?? []).map((w) => tLib(t, w)) });
        setBedEmpty(false);
        setAtPrinter(false);
        setChecked(false);
        loadJobs();
        onChange();
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

  async function cancel(job: PrintJob, by: string) {
    setSending(true);
    try {
      const r = await fetch(`/api/print-jobs/${encodeURIComponent(job.id)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", by }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setMsg(r.ok ? { ok: true, text: t("Print job {id} cancelled.", { id: job.id }) } : { ok: false, text: tLib(t, j.error ?? t("Request failed")) });
      loadJobs();
    } catch {
      setMsg({ ok: false, text: t("Request failed") });
    } finally {
      setSending(false);
      setAsking(null);
    }
  }

  // ---------- the slicer's grams for the price ----------
  const defaultUnits = plate?.objects && plate.objects > 1 ? Math.min(plate.objects, order.quantity) : 1;
  const perPlate = Math.max(1, Math.round(Number(units) || defaultUnits));
  const gramsPerUnit = plate?.weightG ? Math.round((plate.weightG / perPlate) * 100) / 100 : null;
  const colorMode: ColorMode = plate && plate.filaments.length > 1 ? "multi" : "single";
  const source = file && plate ? `Bambu Studio sliced file ${file.filename}, plate ${plate.index}${perPlate > 1 ? `, ${perPlate} units on the plate` : ""}` : "";

  const blocked = picked ? picked.verdict.reasons : [];
  // Same rule as the server: a real order the customer has not paid for yet is a warning the person accepts.
  const warnings = [...(picked?.warnings ?? []), ...(order.label === "real" && !paid ? ["The customer has not paid into escrow yet"] : [])];
  const ready = Boolean(picked && plate && blocked.length === 0 && bedEmpty && atPrinter && (warnings.length === 0 || checked));
  const bed = bedTypeLabel(plate?.bedType);
  const slots = picked ? amsSlots(picked.p.snapshot) : [];
  const ext = picked?.p.snapshot?.externalSpool;
  const canExternal = Boolean(plate && plate.filaments.length === 1 && ext);
  const faults = picked ? issueViews(picked.p.snapshot, issueTexts) : [];
  const noStart = jobs.some((j) => j.state === "failed" && j.error?.startsWith(NO_START));
  const optionsText = [
    opts.bedLevelling ? t("bed levelling") : null, opts.flowCali ? t("flow calibration") : null, opts.timelapse ? t("timelapse") : null,
    !opts.useAms ? t("external spool") : null, ftp ? "ftp:///" : null,
  ].filter(Boolean).join(" · ") || t("none");
  /** The first reason a printer is blocked, with Bambu's own words for a fault when known. */
  const firstReason = (reason: string) => {
    const code = FAULT_REASON.exec(reason)?.[1];
    return code && issueTexts[code] ? `${tLib(t, reason)} · ${issueTexts[code]}` : tLib(t, reason);
  };

  return (
    <section className="card pp" id="print">
      <h2><span className="step">C</span> {t("Colours & print")}{" "}
        <Info>{t("Print the order's sliced Bambu Studio file on a studio printer. A person confirms the bed is empty and stands at the printer; the LAN bridge uploads the file and starts the print. The Chief (Claude) never starts a print; with agent prints on, code does, only after a person confirmed the bed empty.")}</Info>
      </h2>

      <AgentPrintRow order={order} data={autoPrint} busy={busy} act={act} t={t} />

      <CustomerColours colors={order.preferredColors ?? []} printers={printers} t={t} />

      <SlicePanel order={order} attachments={attachments} printers={printers} data={slices} t={t} locale={locale}
        onPrint={(id, pid) => {
          setFileId(id); setPlateNo(null); setPrinterId(pid);
          document.getElementById("pp-printer")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }} />

      {files.length === 0 ? (
        <div className="pp-empty">
          <b>{t("No sliced file yet.")}</b>{" "}
          <span className="muted">{canSlice
            ? t("Slice it above, or upload a .gcode.3mf from Bambu Studio under Files.")
            : t("In Bambu Studio: slice for the Bambu Lab A1 (0.4 mm), then File > Export > Export plate sliced file. Upload the .gcode.3mf under Files.")}</span>{" "}
          <a href="#files">{t("Go to Files")}</a>
        </div>
      ) : (
        <>
          <div className="row fields pp-pick">
            {files.length > 1 && (
              <label style={{ flex: "2 1 220px" }}>{t("Sliced file")}
                <select value={file?.id} onChange={(e) => { setFileId(e.target.value); setPlateNo(null); }}>
                  {files.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
                </select>
              </label>
            )}
            {plates.length > 1 && (
              <label style={{ flex: "1 1 120px" }}>{t("Plate")}
                <select value={plate?.index} onChange={(e) => setPlateNo(Number(e.target.value))}>
                  {plates.map((p) => <option key={p.index} value={p.index}>{t("Plate {n}", { n: p.index })}</option>)}
                </select>
              </label>
            )}
          </div>
          {files.length === 1 && <p className="pp-file"><span className="muted">{t("Sliced file")}:</span> <a href={`/api/files/${file!.id}`}>{file!.filename}</a></p>}

          {!info ? (
            <div className="alert bad">{t("This file was uploaded before 3MF files were read. Upload it again.")}</div>
          ) : !plate ? (
            <div className="alert bad">{tLib(t, info.error ? `The 3MF could not be read: ${info.error}` : "Not a sliced file: in Bambu Studio use File > Export > Export plate sliced file (.gcode.3mf)")}</div>
          ) : (
            <>
              <PlateSummary plate={plate} plates={plates.length} bed={bed} t={t} locale={locale} />

              {order.status === "CREATED" && gramsPerUnit !== null && (
                <div className="pp-price">
                  <label className="pp-units">{t("Units on this plate")}
                    <input type="number" min={1} max={order.quantity} value={units || String(defaultUnits)} onChange={(e) => setUnits(e.target.value)} disabled={busy} />
                  </label>
                  <span className="pp-price-text">
                    <b>{t("{grams} g per unit", { grams: gramsPerUnit.toLocaleString(dateLocale(locale), { maximumFractionDigits: 2 }) })}</b> · {t(COLOR_MODE_LABEL[colorMode])}
                  </span>
                  <div className="row pp-price-buttons">
                    <button disabled={busy} onClick={() => void act(`/api/orders/${order.id}/price-by-weight`, { gramsPerUnit, source, colorMode },
                      t("Kesuni quote added by weight. Run the agent to choose a plan."))}>{t("Use as Kesuni quote")}</button>
                    <button disabled={busy} onClick={() => setAsking("grams")}>{t("Only give the grams to the Chief")}</button>
                  </div>
                </div>
              )}

              <h3 className="pp-h" id="pp-printer">{t("Printer")}</h3>
              <ul className="pp-printers" role="radiogroup" aria-label={t("Printer")}>
                {rows.map((r) => {
                  const status = !r.verdict.ok ? "bad" : r.warnings.length ? "warn" : "ok";
                  return (
                    <li key={r.p.id} className={r === picked ? "on" : ""}>
                      <label>
                        <input type="radio" name="pp-printer" checked={r === picked} onChange={() => setPrinterId(r.p.id)} />
                        <span className="pp-printer-name">
                          <span className="pp-printer-top"><b>{r.p.name}</b>
                            <span className={`badge ${status}`}>{status === "bad" ? t("blocked") : status === "warn" ? t("check") : t("ready")}</span>
                          </span>
                          <small>{status === "bad" ? firstReason(r.verdict.reasons[0]) : r.match.ok ? t("Colours match") : t("Check the colours")}</small>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              {picked && (
                <div className="pp-detail">
                  {faults.map((f) => (
                    <div key={f.code} className={`pp-fault ${f.tone}`} role="alert">
                      <b>{f.tone === "bad" ? t("Printer error") : t("Printer warning")} <code>{f.code}</code></b>{" "}
                      {f.text ?? t("Unknown printer message")}{" "}
                      <a href={f.url} target="_blank" rel="noreferrer">{t("Open guide")}</a>
                    </div>
                  ))}
                  {blocked.length > 0 && (
                    <div className="alert bad">
                      <b>{t("{printer} cannot start this print:", { printer: picked.p.name })}</b>
                      <ul>{blocked.map((x) => <li key={x}>{tLib(t, x)}</li>)}</ul>
                    </div>
                  )}

                  {opts.useAms || !canExternal ? (
                    <MappingEditor plate={plate} slots={slots} mapping={picked.mapping} disabled={sending} onPick={setSlot} t={t} locale={locale} />
                  ) : (
                    <p className="pp-ext"><ColorSwatch color={ext?.color} size={18} /> {t("External spool")}: {ext?.type} {ext?.color ? t(nameOf(ext.color)) : ""}</p>
                  )}

                  <details className="fold pp-options">
                    <summary>{t("Options")}: {optionsText}</summary>
                    <div className="pp-checks">
                      <Check on={opts.bedLevelling} set={(v) => setOpts({ ...opts, bedLevelling: v })} label={t("Auto bed levelling")} />
                      <Check on={opts.flowCali} set={(v) => setOpts({ ...opts, flowCali: v })} label={t("Flow calibration (about 1–2 min)")} />
                      <Check on={opts.timelapse} set={(v) => setOpts({ ...opts, timelapse: v })} label={t("Timelapse (slows the print)")} />
                      {canExternal && <Check on={!opts.useAms} set={(v) => setOpts({ ...opts, useAms: !v })} label={t("Print from the external spool, not the AMS")} />}
                      {(noStart || ftp) && <Check on={ftp} set={setFtp} label={t("Start with the ftp:/// path (when the printer did not start)")} />}
                    </div>
                  </details>

                  {warnings.length > 0 && (
                    <div className="pp-warn">
                      <ul>{warnings.map((w) => <li key={w}>{tLib(t, w)}</li>)}</ul>
                      <Check on={checked} set={setChecked} label={t("I checked this")} />
                    </div>
                  )}

                  <div className="pp-checks pp-must">
                    <Check on={bedEmpty} set={setBedEmpty} label={bed ? t("The bed is empty and clean, with the {plate}", { plate: t(bed) }) : t("The bed is empty and clean")} />
                    <Check on={atPrinter} set={setAtPrinter} label={t("I am at the printer")} />
                  </div>
                  <div className="row">
                    <button className="primary" disabled={!ready || sending || busy} onClick={() => setAsking("start")}>{t("Start print")}</button>
                    {!ready && blocked.length === 0 && <span className="muted pp-hint">{t("Tick the boxes above first.")}</span>}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {msg && (
        <div className={`alert ${msg.ok ? "ok" : "bad"}`} role="status">
          {msg.text}{msg.list && msg.list.length > 0 && <ul>{msg.list.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}

      {jobs.length > 0 && <JobList jobs={jobs} printers={printers} busy={sending} onCancel={(j) => setAsking(j)} onFtp={() => setFtp(true)} ftp={ftp} t={t} locale={locale} />}

      <ConfirmDialog open={asking === "start"} title={t("Start the print?")} confirmLabel={t("Start print")} busy={sending}
        onConfirm={(by) => void start(by)} onClose={() => setAsking(null)}>
        {picked && plate && file && (
          <>
            <p style={{ margin: 0 }}>{t("Plate {n} of {file} on {printer}.", { n: plate.index, file: file.filename, printer: picked.p.name })}</p>
            <p className="muted" style={{ margin: 0 }}>{[
              plate.predictionSec ? duration(plate.predictionSec / 60, false, t) : null, plate.weightG ? grams(plate.weightG, locale) : null, bed ? t(bed) : null,
            ].filter(Boolean).join(" · ")}</p>
            {opts.useAms && (
              <ul className="pp-confirm-map">
                {plate.filaments.map((f) => {
                  const tray = picked.mapping[f.id - 1];
                  const s = slots.find((x) => x.tray === tray);
                  return (
                    <li key={f.id}>
                      <ColorSwatch color={f.color} size={16} /> {f.type} {t(nameOf(f.color))} → <ColorSwatch color={s?.color} size={16} /> {tray >= 0 ? slotText(tray, t) : "—"}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="muted" style={{ margin: 0 }}>{t("Options")}: {optionsText}</p>
            {/* The printer runs the G-code inside the file exactly as it is: the person sees whose file it is. */}
            <p className="muted" style={{ margin: 0 }}>{t("Uploaded by {name}. The printer runs this file's G-code as it is.", { name: file.uploadedBy })}</p>
          </>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={asking === "grams"} title={t("Give the grams to the Chief?")} confirmLabel={t("Give the grams")} busy={busy}
        onConfirm={(by) => { setAsking(null); void act(`/api/orders/${order.id}/slicer-grams`, { gramsPerUnit, source, by, colorMode },
          t("Grams saved. The Chief prices by weight and continues (rules mode: price it here).")); }} onClose={() => setAsking(null)}>
        <p style={{ margin: 0 }}>{t("{grams} g per unit, {mode}, from {file}. The Chief prices by weight with these grams.", {
          grams: gramsPerUnit ?? "?", mode: t(COLOR_MODE_LABEL[colorMode]).toLowerCase(), file: file?.filename ?? "",
        })}</p>
      </ConfirmDialog>
      <ConfirmDialog open={typeof asking === "object" && asking !== null} title={t("Cancel this print job?")} confirmLabel={t("Cancel job")} danger busy={sending}
        onConfirm={(by) => { if (asking && typeof asking === "object") void cancel(asking, by); }} onClose={() => setAsking(null)}>
        <p style={{ margin: 0 }}>{typeof asking === "object" && asking ? t("{id} has not reached the printer yet.", { id: asking.id }) : ""}</p>
      </ConfirmDialog>
    </section>
  );
}

/** The plate as the slicer saw it: time, grams, plate type, nozzle, and each filament with its colour and grams. */
function PlateSummary({ plate, plates, bed, t, locale }: { plate: ThreeMfPlate; plates: number; bed: string | null; t: T; locale: Locale }) {
  return (
    <div className="pp-plate">
      <dl className="pp-facts">
        {plates > 1 && <div><dt>{t("Plate")}</dt><dd>{plate.index}</dd></div>}
        <div><dt>{t("Print time (slicer)")}</dt><dd>{plate.predictionSec ? duration(plate.predictionSec / 60, false, t) : "—"}</dd></div>
        <div><dt>{t("Weight")}</dt><dd>{plate.weightG != null ? grams(plate.weightG, locale) : "—"}</dd></div>
        {bed && <div><dt>{t("Plate type")}</dt><dd>{t(bed)}</dd></div>}
        {plate.nozzle && <div><dt>{t("Nozzle")}</dt><dd>{mm(plate.nozzle, locale)}</dd></div>}
      </dl>
      <ul className="pp-filaments">
        {plate.filaments.map((f) => (
          <li key={f.id}>
            <ColorSwatch color={f.color} size={20} title={normalizeHex(f.color) ?? undefined} />
            <span><b>{f.type} {t(nameOf(f.color))}</b><small>{f.usedG != null ? grams(f.usedG, locale) : ""}</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One row per filament of the plate: the file's colour and the AMS slot it prints from (same material first). */
function MappingEditor({ plate, slots, mapping, disabled, onPick, t, locale }: {
  plate: ThreeMfPlate; slots: ReturnType<typeof amsSlots>; mapping: number[]; disabled: boolean; onPick: (filamentId: number, tray: number) => void; t: T; locale: Locale;
}) {
  if (!slots.length) return <p className="muted pp-hint">{t("This printer has not reported its AMS yet.")}</p>;
  return (
    <ul className="pp-map">
      {plate.filaments.map((f) => {
        const tray = mapping[f.id - 1] ?? -1;
        const s = slots.find((x) => x.tray === tray);
        const want = f.type.trim().toUpperCase();
        const choices = slots.filter((x) => !x.empty)
          .map((x) => ({ x, same: x.type === want, d: x.color && normalizeHex(f.color) ? Math.round(deltaE(normalizeHex(f.color)!, x.color) * 10) / 10 : null }))
          .sort((a, b) => Number(b.same) - Number(a.same) || (a.d ?? 999) - (b.d ?? 999));
        return (
          <li key={f.id}>
            <span className="pp-map-file">
              <ColorSwatch color={f.color} size={20} />
              <span><b>{f.type} {t(nameOf(f.color))}</b><small>{t("Filament {n}", { n: f.id })}{f.usedG != null ? ` · ${grams(f.usedG, locale)}` : ""}</small></span>
            </span>
            <span className="pp-map-arrow" aria-hidden>→</span>
            <span className="pp-map-slot">
              <ColorSwatch color={s?.color} colors={s?.colors} size={20} />
              <select value={tray} disabled={disabled} aria-label={t("AMS slot for filament {n}", { n: f.id })} onChange={(e) => onPick(f.id, Number(e.target.value))}>
                <option value={-1}>{t("No slot")}</option>
                {choices.map(({ x, same, d }) => (
                  <option key={x.tray} value={x.tray}>
                    {slotText(x.tray, t)} · {x.type} {x.name ? t(x.name) : ""}{same ? (d !== null && d > MATCH_MAX_DELTA_E ? ` · ${t("other colour")}` : "") : ` · ${t("other material")}`}
                  </option>
                ))}
              </select>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Colour warnings like the server's: a mapped spool far from the colour the file asks for. English (shown with tLib). */
function colourWarnings(plate: ThreeMfPlate, p: Printer, mapping: number[], opts: PrintOptions): string[] {
  if (!opts.useAms) return [];
  const out: string[] = [];
  for (const f of plate.filaments) {
    const tray = p.snapshot?.ams?.trays.find((x) => x.ams * 4 + x.slot === mapping[f.id - 1]);
    const want = normalizeHex(f.color);
    if (tray && !tray.empty && tray.color && want && deltaE(want, tray.color) > MATCH_MAX_DELTA_E) {
      out.push(`Filament ${f.id}: the file asks for ${want}, the spool is ${tray.color}`);
    }
  }
  return out;
}

/** The colours the customer picked, and where each one is loaded now (same material, close colour). */
function CustomerColours({ colors, printers, t }: { colors: ColorChoice[]; printers: Printer[]; t: T }) {
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

function Check({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <label className="pp-check"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> <span>{label}</span></label>
  );
}

/** This order's print jobs, newest first, as steps: queued, uploading, sent, printing, done (or failed / cancelled). */
function JobList({ jobs, printers, busy, onCancel, onFtp, ftp, t, locale }: {
  jobs: PrintJob[]; printers: Printer[]; busy: boolean; onCancel: (j: PrintJob) => void; onFtp: () => void; ftp: boolean; t: T; locale: Locale;
}) {
  const time = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(locale), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  return (
    <>
      <h3 className="pp-h">{t("Print jobs")}</h3>
      <ol className="pp-jobs">
        {jobs.map((j) => {
          const p = printers.find((x) => x.id === j.printerId);
          const ended = j.state === "failed" || j.state === "cancelled";
          const at = STEPS.indexOf(j.state);
          const s = p?.snapshot;
          const live = j.state === "printing" && s && (s.state === "RUNNING" || s.state === "PAUSE" || s.state === "PREPARE");
          return (
            <li key={j.id}>
              <div className="pp-job-head">
                <b className="mono">{j.id}</b>
                <span className="muted">{p?.name ?? j.printerId} · {t("Plate {n}", { n: j.plate })} · {j.actor === "agent" ? t("by the agent (bed: {name})", { name: j.bedConfirmedBy ?? "?" }) : t("by {name}", { name: j.by })} · {time(j.createdAt)}</span>
              </div>
              <ol className="pp-steps">
                {ended ? <li className="bad">{t(STEP_LABEL[j.state])}</li>
                  : STEPS.map((st, i) => <li key={st} className={i < at || j.state === "done" ? "done" : i === at ? "now" : ""}>{t(STEP_LABEL[st])}</li>)}
              </ol>
              {live && <p className="pp-job-live">{Math.floor(s.percent)}%{s.totalLayers ? ` · ${t("layer {n} of {total}", { n: s.layer ?? 0, total: s.totalLayers })}` : ""}</p>}
              {j.error && <p className="pp-job-error">{tLib(t, j.error)}</p>}
              <div className="row pp-job-actions">
                {(j.state === "queued" || j.state === "uploading") && <button disabled={busy} onClick={() => onCancel(j)}>{t("Cancel")}</button>}
                {j === jobs.find((x) => x.state === "failed" && x.error?.startsWith(NO_START)) && !ftp && (
                  <button disabled={busy} onClick={onFtp}>{t("Next start: try the ftp:/// path")}</button>
                )}
                {(j.state === "sent" || j.state === "printing") && <Link href={`/machines#printer-${j.printerId}`}>{t("Pause or stop on My machines")}</Link>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
