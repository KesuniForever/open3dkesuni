"use client";

import { useRef, useState } from "react";
import type { Attachment, Order } from "@/lib/types";

const KINDS: { value: Attachment["kind"]; label: string; accept: string }[] = [
  { value: "design", label: "Design file (STL / 3MF / STEP / OBJ)", accept: ".stl,.3mf,.step,.stp,.obj" },
  { value: "reference", label: "Reference image", accept: ".jpg,.jpeg,.png,.webp" },
  { value: "qc_photo", label: "QC photo", accept: ".jpg,.jpeg,.png,.webp" },
];
const KIND_LABEL: Record<Attachment["kind"], string> = { design: "design", reference: "reference", qc_photo: "QC photo" };

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Files attached to the order: designs for the operator's slicer, reference images, QC photos. */
export default function FilesPanel({ order, attachments, onChange }: {
  order: Order;
  attachments: Attachment[];
  onChange: () => void;
}) {
  const [kind, setKind] = useState<Attachment["kind"]>("design");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; reasons?: string[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      form.set("by", by);
      const res = await fetch(`/api/orders/${order.id}/files`, { method: "POST", body: form });
      const data = await res.json();
      setMsg(res.ok ? { ok: true, text: `Uploaded ${data.attachment.filename}.` } : { ok: false, text: data.error, reasons: data.reasons });
      if (res.ok && input.current) input.current.value = "";
      onChange();
    } catch {
      setMsg({ ok: false, text: "Upload failed. Is the server running?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2><span className="step">F</span> Files</h2>
      {attachments.length === 0 ? (
        <p className="muted">No files yet. Upload the design for the operator&apos;s slicer, reference images, or QC photos.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {attachments.map((a) => (
            <li key={a.id} className="row" style={{ alignItems: "center", marginBottom: 8 }}>
              {a.mime.startsWith("image/") && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${a.id}`} alt={a.filename} width={56} height={56}
                  style={{ objectFit: "cover", borderRadius: 6, border: "1px solid #ddd" }} />
              )}
              <span>
                <span className="badge">{KIND_LABEL[a.kind]}</span>{" "}
                <a href={`/api/files/${a.id}`} target={a.mime.startsWith("image/") ? "_blank" : undefined} rel="noreferrer">{a.filename}</a>{" "}
                <span className="muted" style={{ fontSize: 13 }}>{size(a.size)} · by {a.uploadedBy}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="form" onSubmit={upload} style={{ marginTop: 8 }}>
        <div className="row">
          <label style={{ flex: "1 1 220px" }}>Type
            <select value={kind} onChange={(e) => setKind(e.target.value as Attachment["kind"])} disabled={busy}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label style={{ flex: "1 1 160px" }}>Uploaded by
            <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" disabled={busy} />
          </label>
          <label style={{ flex: "2 1 240px" }}>File (max 50 MB)
            <input ref={input} type="file" accept={KINDS.find((k) => k.value === kind)!.accept} disabled={busy} />
          </label>
        </div>
        {msg && (
          <div className={`alert ${msg.ok ? "ok" : "bad"}`}>
            {msg.text}{msg.reasons && <ul>{msg.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>
        )}
        <div><button className="primary" disabled={busy || !by.trim()}>{busy ? "Uploading…" : "Upload"}</button></div>
        <p className="muted" style={{ fontSize: 13 }}>
          Files stay with Kesuni and are never sent to the AI agent. A QC photo is also recorded as photo evidence; it does not replace the QC result.
        </p>
      </form>
    </section>
  );
}
