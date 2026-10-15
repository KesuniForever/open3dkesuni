"use client";

import { useState } from "react";
import type { CustomerMessage, Order } from "@/lib/types";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale, type Locale } from "@/i18n/core";
import { tLib } from "@/lib/lib-text";

const when = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Updates shown on the customer's page ("Kabar dari Kesuni"), by the Chief (AI) or a person. */
export default function MessagesPanel({ order, messages, busy, onChange }: {
  order: Order;
  messages: CustomerMessage[];
  busy: boolean;
  onChange: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ text: string; reasons?: string[] } | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, by: "human" }),
      });
      const data = await res.json();
      if (res.ok) setText(""); // keep the text when refused, so it can be fixed
      else setError({ text: data.error, reasons: data.reasons });
      onChange();
    } catch {
      setError({ text: "Network error. Is the server running?" });
    } finally {
      setSending(false);
    }
  }

  const disabled = busy || sending;
  return (
    <section className="card">
      <h2>{t("Messages to the customer")}</h2>
      {messages.length === 0 ? <p className="muted">{t("No messages yet. The Chief writes at key moments (price ready, production started, delay, QC done).")}</p> : (
        <ul>
          {[...messages].reverse().map((m) => (
            <li key={m.id}>
              <span className={`badge ${m.by === "agent" ? "" : "ok"}`}>{m.by === "agent" ? t("Chief (AI)") : t("Person")}</span>{" "}
              {m.text} <span className="muted" style={{ fontSize: 13 }}>· {when(m.at, locale)}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label>{t('Write to the customer (simple English; shown on their page as "from the Kesuni team")')}
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={2}
            placeholder={t("Example: Printing is under way; we will send photos of the result tomorrow afternoon.")} disabled={disabled} />
        </label>
        {error && (
          <div className="alert bad" role="status">
            <strong>{t("Blocked:") + " "}</strong>{t(error.text)}
            {error.reasons && error.reasons.length > 0 && <ul>{error.reasons.map((r) => <li key={r}>{tLib(t, r)}</li>)}</ul>}
          </div>
        )}
        <div className="row">
          <button disabled={disabled || !text.trim()}>{sending ? t("Posting…") : t("Post message")}</button>
          <span className="muted" style={{ fontSize: 13 }}>{text.length}/500 · {t("no links, wallet addresses, phone numbers or emails (checked in code).")}</span>
        </div>
      </form>
    </section>
  );
}
