"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HeartbeatStatus, WakeOutcome } from "@/lib/agent/heartbeat";
import { dateLocale, type Locale } from "@/i18n/core";
import { useLocale, useT } from "@/i18n/client";
import Info from "./Info";

const OUTCOME: Record<WakeOutcome, string> = {
  done: "done", fallback: "rule planner (Claude unavailable)", busy: "already working, next beat",
  error: "error", needs_claude: "needs Claude (rules mode)", deferred: "next beat (max 3 per beat)",
};
const time = (iso: string | null | undefined, locale: Locale) =>
  iso ? `${new Date(iso).toLocaleTimeString(dateLocale(locale), { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB` : "—";

/** The Chief's proactive rounds: what the last check found, who was woken, and a "run now" button. */
export default function HeartbeatCard({ initial }: { initial: HeartbeatStatus }) {
  const t = useT();
  const locale = useLocale();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Keep the card fresh while the page is open (a cheap read, no Claude).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      fetch("/api/heartbeat").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setS(j); }).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  async function runNow() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/heartbeat", { method: "POST" });
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "Could not run the heartbeat");
      else setS(j);
    } catch {
      setError("Network error. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  const last = s.last;
  const n = last?.findings.length ?? 0;
  return (
    <section className="card">
      <h2>
        Heartbeat
        <Info>{t("Code checks every order first (free). The Chief is woken only for a new problem that needs a decision.")}</Info>
      </h2>
      <p className="status-line">
        <span>{s.enabled ? t("Every {n} s", { n: s.intervalSeconds }) : t("Timer off (KESUNI_HEARTBEAT_SECONDS=0)")}</span>
        <span>{t("Last {time}", { time: time(last?.at, locale) })}</span>
        <span>{t("Next {time}", { time: s.enabled ? time(s.nextRunAt, locale) : t("only by button") })}</span>
      </p>
      {last && n > 0 && (
        <details className="fold">
        <summary>{t(n === 1 ? "{n} finding" : "{n} findings", { n })}</summary>
        <ul className="attention" style={{ fontSize: 13 }}>
          {last.findings.slice(0, 8).map((f) => (
            <li key={f.key}>
              {f.orderId ? <Link href={`/orders/${f.orderId}`}>{f.orderId}</Link> : null}{f.orderId ? ": " : ""}{t(f.text)}
              {f.wake ? <span className="badge" style={{ marginLeft: 6 }}>{t("decision")}</span> : null}
              {f.isNew ? <span className="badge ok" style={{ marginLeft: 6 }}>{t("new")}</span> : null}
            </li>
          ))}
          {n > 8 && <li className="muted">{t("… and {n} more", { n: n - 8 })}</li>}
        </ul>
        </details>
      )}
      {last && last.woke.length > 0 && (
        <p style={{ fontSize: 13, margin: "8px 0" }}>
          {t("Woke:")} {last.woke.map((w, i) => (
            <span key={`${w.orderId}-${i}`}>
              {i > 0 && " · "}<Link href={`/orders/${w.orderId}`}>{w.orderId}</Link> {OUTCOME[w.outcome] ? t(OUTCOME[w.outcome]) : w.outcome}
            </span>
          ))}
        </p>
      )}
      {last && last.errors.length > 0 && <div className="alert bad" style={{ fontSize: 13 }}>{last.errors.map((e) => t(e)).join(" · ")}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => void runNow()} disabled={busy || s.running}>{busy ? t("Running…") : t("Run heartbeat now")}</button>
        <span className="muted" style={{ fontSize: 13 }}>{t("Mode: {mode}", { mode: s.mode === "claude" ? "Claude" : t("rule-based (no Claude)") })}</span>
      </div>
      {error && <div className="alert bad">{t(error)}</div>}
    </section>
  );
}
