"use client";

import { useState, useSyncExternalStore, type CSSProperties } from "react";
import Info from "@/app/components/Info";
import { useOperatorName } from "@/app/components/PrinterControls";
import { tLib } from "@/lib/lib-text";
import { useT } from "@/i18n/client";

// The order page's Customer card: the customer's private link (/c/<token>) to copy or open, and "New link" for a link
// seen where it should not be (a video, a screenshot). A new link (POST /api/orders/<id>/customer-link, with the
// person's name for the decision log) stops the old one at once. Asked inline first, never with a browser dialog.

/** The link just made, and the one it replaced. */
export type MadeLink = { old: string; link: string };

/** The link to show: the one just made until the page's next load brings it, then whatever the page reads. */
export const shownLink = (path: string, made: MadeLink | null): string => (made && path === made.old ? made.link : path);

/** "New link made" while the card shows that link and nothing else is going on: not with the confirm open again, not
 *  with an error, and gone once another new link is made (here or in another tab). */
export const showMade = (link: string, made: MadeLink | null, asking: boolean, failed: boolean): boolean =>
  made !== null && link === made.link && !asking && !failed;

const ASK: CSSProperties = {
  display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px 12px", marginTop: 12, padding: "10px 12px",
  borderRadius: 10, background: "var(--warn-bg)", color: "var(--warn)", fontSize: 14,
};

export default function CustomerLinkPanel({ orderId, path, name, note, onChange }: {
  orderId: string;
  /** "/c/<token>", as the page last read it. */
  path: string;
  name?: string;
  note?: string;
  /** Reload the order page (it then reads the new link). */
  onChange: () => void;
}) {
  const t = useT();
  const [by, setBy] = useOperatorName();
  // The link last copied: "Copied" stays on that one, never on a new link.
  const [copied, setCopied] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  // English texts; translated when shown.
  const [error, setError] = useState<{ text: string; reasons?: string[] } | null>(null);
  const [made, setMade] = useState<MadeLink | null>(null);
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const link = shownLink(path, made);
  const url = origin + link;
  const fresh = showMade(link, made, asking, error !== null);

  async function renew() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/customer-link`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: by.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return setError({ text: data.error, reasons: data.reasons });
      setMade({ old: path, link: data.customerLink });
      setAsking(false);
      onChange();
    } catch {
      setError({ text: "Network error. Is the server running?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t("Customer")}{name && `: ${name}`} <Info>{t("Send this link to the customer (WhatsApp). They can pay into escrow, follow the print live, and accept or reject. Anyone with the link can see this order.")}</Info></h2>
      {note && <p style={{ marginTop: 0 }}>“{note}”</p>}
      <div className="row">
        <code style={{ flex: "1 1 260px", overflowWrap: "anywhere" }}>{url}</code>
        <button onClick={async () => { await navigator.clipboard.writeText(url); setCopied(url); }}>{copied === url ? t("Copied") : t("Copy customer link")}</button>
        <a href={link} target="_blank" rel="noreferrer">{t("Open as customer")}</a>
        {!asking && (
          <button type="button" className="quiet" disabled={busy} onClick={() => { setAsking(true); setError(null); }}>{t("New link")}</button>
        )}
      </div>
      {asking && <NewLinkAsk by={by} busy={busy} onName={setBy} onConfirm={renew} onCancel={() => { setAsking(false); setError(null); }} />}
      {fresh && <div className="alert ok" role="status">{t("New link made. Send it only to the customer's own WhatsApp.")}</div>}
      {error && (
        <div className="alert bad" role="status">
          {t(error.text)}{error.reasons && <ul>{error.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}

/** The inline confirm of "New link": what happens, the person's name for the log, then Make new link or Cancel. */
export function NewLinkAsk({ by, busy, onName, onConfirm, onCancel }: {
  by: string;
  busy: boolean;
  onName: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const ready = by.trim().length > 0;
  return (
    <form style={ASK} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onConfirm(); }}>
      <span style={{ flex: "1 1 100%" }}>
        {t("The old link stops working.")}{" "}
        <Info>{t("Use this if the link was shown to others, like in a video or a screenshot. The order, payment and files stay the same. Only the new link opens the order. Send the new link only to the customer's own WhatsApp number, never to someone who asks with the old link.")}</Info>
      </span>
      <label style={{ flex: "1 1 160px" }}>{t("Your name")}
        <input value={by} onChange={(e) => onName(e.target.value)} placeholder={t("e.g. Khelda")} maxLength={60} autoFocus={!ready} disabled={busy} />
      </label>
      {/* Focus on Cancel, never on Make new link: an Enter held on "New link" must not make one unread. */}
      <button type="submit" className="danger" disabled={busy || !ready}>{busy ? t("Making…") : t("Make new link")}</button>
      <button type="button" onClick={onCancel} disabled={busy} autoFocus={ready}>{t("Cancel")}</button>
    </form>
  );
}
