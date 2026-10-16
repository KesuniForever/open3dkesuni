"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { tLib } from "@/lib/lib-text";
import { useT } from "@/i18n/client";
import Icon from "./Icon";
import Info from "./Info";
import { ConfirmDialog } from "./PrinterControls";

export interface AutoPrintFeedRow { id: number; title: string; line?: string; when: string; orderId: string; isOrder: boolean; ok: boolean }

/**
 * "Agent prints": the switch a person sets (name + confirm, logged; POST /api/auto-print) and the dispatcher's last
 * decisions. When on, code (never Claude) starts the next paid order only after a person confirmed the bed empty,
 * one print per confirmation.
 */
export default function AutoPrintCard({ on, by, when, locked, feed }: {
  on: boolean;
  by: string | null;
  /** When the switch was last set, already written for the visitor ("16 Oct, 10:42"). */
  when: string | null;
  locked: boolean;
  feed: AutoPrintFeedRow[];
}) {
  const t = useT();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function flip(name: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auto-print", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: !on, by: name, confirm: true }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(j.error ? tLib(t, j.error) : t("Request failed ({status})", { status: res.status }));
      setAsking(false);
      router.refresh();
    } catch {
      setError(t("Request failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card ap-card">
      <h2>
        {t("Agent prints")}{" "}
        <Info>{t("When on, code (not Claude) starts the next paid order by itself, only on a printer whose bed a person confirmed empty since its last print: one print per confirmation. People load filament and empty the beds.")}</Info>
      </h2>
      <div className="ap-row">
        <span className={`ap-state${on ? " on" : ""}`}><span className="ap-dot" />{on ? t("On") : t("Off")}</span>
        {by && when && <span className="muted ap-who">{t("by {name}, {when}", { name: by, when })}</span>}
        <button className={on ? "" : "primary"} disabled={busy || (locked && !on)} onClick={() => setAsking(true)}>
          {on ? t("Turn off") : t("Turn on")}
        </button>
      </div>
      {locked && <p className="alert warn ap-note">{t("Off on this server (KESUNI_AUTO_PRINT=off).")}</p>}
      {error && <p className="alert bad ap-note" role="status">{error}</p>}

      <h3 className="ap-sub">{t("Last agent decisions")}</h3>
      {feed.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("None yet.")}</p>
      ) : (
        <ul className="ap-feed">
          {feed.map((f) => (
            <li key={f.id}>
              <span className={`ap-mark${f.ok ? "" : " bad"}`}><Icon name={f.ok ? "check" : "close"} size={12} /></span>
              <span className="ap-text">
                <b>{f.title}</b>
                {f.line && <span className="ap-line" title={f.line}>{f.line}</span>}
                <small className="muted">
                  {f.isOrder ? <Link href={`/orders/${f.orderId}`}>{f.orderId}</Link> : <Link href="/machines">{t("Studio")}</Link>} · {f.when}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog open={asking} title={on ? t("Turn agent prints off?") : t("Turn agent prints on?")}
        confirmLabel={on ? t("Turn off") : t("Turn on")} danger={on} busy={busy} onConfirm={(name) => void flip(name)} onClose={() => setAsking(false)}>
        <p style={{ margin: 0 }}>{on
          ? t("Agent prints that have not reached a printer are cancelled. People start every print again.")
          : t("The agent may then start a paid order by itself, each time after a person confirms a bed is empty.")}</p>
      </ConfirmDialog>
    </section>
  );
}
