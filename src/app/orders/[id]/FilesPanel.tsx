"use client";

import { useEffect, useRef, useState } from "react";
import type { Attachment, Order } from "@/lib/types";
import Info from "@/app/components/Info";
import { ConfirmDialog } from "@/app/components/PrinterControls";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import { tLib } from "@/lib/lib-text";
import { CUSTOMER_UPLOAD_BY, qcPhotoLocked } from "@/lib/file-rules";

const KINDS: { value: Attachment["kind"]; label: string; accept: string }[] = [
  { value: "design", label: "Design file (STL / 3MF / STEP / OBJ)", accept: ".stl,.3mf,.step,.stp,.obj" },
  { value: "reference", label: "Reference image", accept: ".jpg,.jpeg,.png,.webp" },
  { value: "qc_photo", label: "QC photo", accept: ".jpg,.jpeg,.png,.webp" },
];
const KIND_LABEL: Record<Attachment["kind"], string> = { design: "design", reference: "reference", qc_photo: "QC photo" };

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
/** Upload time in Jakarta time: the same name uploaded twice is told apart by it. */
const when = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Msg = { ok: boolean; text: string; reasons?: string[]; at?: "list" | "form" };

/** The request that removes one file: DELETE with a JSON body (the route reads only JSON: a cross-site form cannot send it). */
export function removeFileRequest(orderId: string, fileId: string, by: string): [string, RequestInit] {
  return [
    `/api/orders/${encodeURIComponent(orderId)}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ by }) },
  ];
}

/** The note under the list after a removal: done (and whether the stored copy went too), or the server's refusal. */
export function removalNote(file: string, ok: boolean, data: { error?: string; reasons?: string[]; bytesRemoved?: boolean }, t: T): Msg {
  if (ok) {
    return { ok: true, text: data.bytesRemoved === false ? t("{file} removed; the stored copy stayed.", { file }) : t("{file} removed.", { file }), at: "list" };
  }
  return { ok: false, text: tLib(t, data.error ?? t("Request failed")), reasons: data.reasons, at: "list" };
}

/**
 * Files attached to the order: designs for the operator's slicer, reference images, QC photos. A person can remove one
 * (with their name); the server refuses while a print uses it, and a QC photo once the evidence is submitted.
 */
export default function FilesPanel({ order, attachments, onChange }: {
  order: Order;
  attachments: Attachment[];
  onChange: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [kind, setKind] = useState<Attachment["kind"]>("design");
  const [by, setBy] = useState("");
  // Which action is running: the Upload button says "Uploading…" only for an upload.
  const [busyWith, setBusyWith] = useState<"upload" | "remove" | null>(null);
  const busy = busyWith !== null;
  // "list": the note of a removal, under the list; "form": the upload's, under the form.
  const [msg, setMsg] = useState<Msg | null>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listNote = useRef<HTMLDivElement>(null);
  // After a removal the row (and the button that had the focus) is gone: the focus goes to the note instead of the page top.
  const focusNote = useRef(false);
  useEffect(() => {
    if (focusNote.current && msg?.at === "list") {
      focusNote.current = false;
      listNote.current?.focus();
    }
  }, [msg]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    setBusyWith("upload");
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      form.set("by", by);
      const res = await fetch(`/api/orders/${order.id}/files`, { method: "POST", body: form });
      const data = await res.json();
      setMsg(res.ok ? { ok: true, text: t("Uploaded {file}.", { file: data.attachment.filename }) } : { ok: false, text: data.error, reasons: data.reasons });
      if (res.ok && input.current) input.current.value = "";
      onChange();
    } catch {
      setMsg({ ok: false, text: t("Upload failed. Is the server running?") });
    } finally {
      setBusyWith(null);
    }
  }

  async function remove(a: Attachment, name: string) {
    setBusyWith("remove");
    setMsg(null);
    focusNote.current = true;
    try {
      const res = await fetch(...removeFileRequest(order.id, a.id, name));
      const data = (await res.json().catch(() => ({}))) as { error?: string; reasons?: string[]; bytesRemoved?: boolean };
      setMsg(removalNote(a.filename, res.ok, data, t));
      // Refreshed whatever the answer: a 404 means another tab or person removed it already.
      onChange();
    } catch {
      setMsg({ ok: false, text: t("Request failed"), at: "list" });
    } finally {
      setBusyWith(null);
      setRemoving(null);
    }
  }

  const note = (where: "list" | "form") => msg && (msg.at ?? "form") === where && (
    <div className={`alert ${msg.ok ? "ok" : "bad"}`} role="status" ref={where === "list" ? listNote : undefined} tabIndex={where === "list" ? -1 : undefined}>
      {t(msg.text)}{msg.reasons && <ul>{msg.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
    </div>
  );
  const locked = removing?.kind === "qc_photo" ? qcPhotoLocked(order.status) : null;

  return (
    <section className="card" id="files" style={{ scrollMarginTop: 80 }}>
      <h2><span className="step">F</span> {t("Files")} <Info>{t("Files stay with Kesuni and are never sent to the AI agent. A QC photo is also recorded as photo evidence; it does not replace the QC result.")}</Info></h2>
      {attachments.length === 0 ? (
        <p className="muted">{t("No files yet. Upload the design for the operator's slicer, reference images, or QC photos.")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {attachments.map((a) => {
            const label = `${t("Remove {file}", { file: a.filename })} · ${when(a.at, locale)}`;
            return (
              <li key={a.id} className="row" style={{ alignItems: "center", marginBottom: 8, flexWrap: "nowrap" }}>
                {a.mime.startsWith("image/") && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${a.id}`} alt={a.filename} width={56} height={56}
                    style={{ objectFit: "cover", borderRadius: 6, border: "1px solid #ddd", flex: "none" }} />
                )}
                <span style={{ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>
                  <span className="badge">{t(KIND_LABEL[a.kind])}</span>{" "}
                  {a.uploadedBy === CUSTOMER_UPLOAD_BY && <><span className="badge ok">{t("From the customer")}</span>{" "}</>}
                  <a href={`/api/files/${a.id}`} target={a.mime.startsWith("image/") ? "_blank" : undefined} rel="noreferrer">{a.filename}</a>{" "}
                  <span className="muted" style={{ fontSize: 13 }}>{size(a.size)} · {t("by {name}", { name: a.uploadedBy })} · {when(a.at, locale)}</span>
                </span>
                <button type="button" onClick={() => setRemoving(a)} disabled={busy} aria-label={label} title={label} className="quiet">{t("Remove")}</button>
              </li>
            );
          })}
        </ul>
      )}
      {note("list")}
      <form className="form" onSubmit={upload} style={{ marginTop: 8 }}>
        <div className="row">
          <label style={{ flex: "1 1 220px" }}>{t("Type")}
            <select value={kind} onChange={(e) => setKind(e.target.value as Attachment["kind"])} disabled={busy}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{t(k.label)}</option>)}
            </select>
          </label>
          <label style={{ flex: "1 1 160px" }}>{t("Uploaded by")}
            <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t("Your name")} disabled={busy} />
          </label>
          <label style={{ flex: "2 1 240px" }}>{t("File (max 50 MB)")}
            <input ref={input} type="file" accept={KINDS.find((k) => k.value === kind)!.accept} disabled={busy} />
          </label>
        </div>
        {note("form")}
        <div><button className="primary" disabled={busy || !by.trim()}>{busyWith === "upload" ? t("Uploading…") : t("Upload")}</button></div>
      </form>
      {/* A QC photo of an order whose evidence is submitted cannot go: the dialog says why and cannot be confirmed. */}
      <ConfirmDialog open={Boolean(removing)} title={t("Remove this file?")} confirmLabel={t("Remove")} danger ready={!locked}
        busy={busyWith === "remove"} onConfirm={(name) => { if (removing) void remove(removing, name); }} onClose={() => setRemoving(null)}>
        <p style={{ margin: 0, overflowWrap: "anywhere" }}><b>{removing?.filename}</b></p>
        {removing && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {size(removing.size)} · {t("by {name}", { name: removing.uploadedBy })} · {when(removing.at, locale)}
          </p>
        )}
        {removing?.kind === "qc_photo" && (locked
          ? <p style={{ margin: 0, color: "var(--bad)" }}>{tLib(t, locked)}</p>
          : <p className="muted" style={{ margin: 0 }}>{t("The photo evidence goes too.")}</p>)}
      </ConfirmDialog>
    </section>
  );
}
