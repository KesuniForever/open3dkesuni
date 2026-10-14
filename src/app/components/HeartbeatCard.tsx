"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HeartbeatStatus, WakeOutcome } from "@/lib/agent/heartbeat";

const OUTCOME: Record<WakeOutcome, string> = {
  done: "done", fallback: "rule planner (Claude unavailable)", busy: "already working, next beat",
  error: "error", needs_claude: "needs Claude (rules mode)", deferred: "next beat (max 3 per beat)",
};
const time = (iso: string | null | undefined) =>
  iso ? `${new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB` : "—";

/** The Chief's proactive rounds: what the last check found, who was woken, and a "run now" button. */
export default function HeartbeatCard({ initial }: { initial: HeartbeatStatus }) {
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
  return (
    <section className="card">
      <h2>
        Heartbeat {last && <span className="badge">{last.findings.length} finding{last.findings.length === 1 ? "" : "s"}</span>}
      </h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {s.enabled ? `Every ${s.intervalSeconds} s` : "Timer off (KESUNI_HEARTBEAT_SECONDS=0)"}: code checks first (free); the Chief is
        woken only for a new problem that needs a decision. Last run {time(last?.at)}
        {last && ` (${last.trigger}, ${last.durationMs} ms)`} · next {s.enabled ? time(s.nextRunAt) : "only by button"}.
      </p>
      {last && last.findings.length > 0 && (
        <ul className="attention" style={{ fontSize: 13 }}>
          {last.findings.slice(0, 8).map((f) => (
            <li key={f.key}>
              {f.orderId ? <Link href={`/orders/${f.orderId}`}>{f.orderId}</Link> : null}{f.orderId ? ": " : ""}{f.text}
              {f.wake ? <span className="badge" style={{ marginLeft: 6 }}>decision</span> : null}
              {f.isNew ? <span className="badge ok" style={{ marginLeft: 6 }}>new</span> : null}
            </li>
          ))}
          {last.findings.length > 8 && <li className="muted">… and {last.findings.length - 8} more</li>}
        </ul>
      )}
      {last && last.woke.length > 0 && (
        <p style={{ fontSize: 13, margin: "8px 0" }}>
          Woke: {last.woke.map((w, i) => (
            <span key={`${w.orderId}-${i}`}>
              {i > 0 && " · "}<Link href={`/orders/${w.orderId}`}>{w.orderId}</Link> {OUTCOME[w.outcome] ?? w.outcome}
            </span>
          ))}
        </p>
      )}
      {last && last.errors.length > 0 && <div className="alert bad" style={{ fontSize: 13 }}>{last.errors.join(" · ")}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => void runNow()} disabled={busy || s.running}>{busy ? "Running…" : "Run heartbeat now"}</button>
        <span className="muted" style={{ fontSize: 13 }}>Mode: {s.mode === "claude" ? "Claude" : "rule-based (no Claude)"}</span>
      </div>
      {error && <div className="alert bad">{error}</div>}
    </section>
  );
}
