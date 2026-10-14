"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentSettings } from "@/lib/agent/chief";

const PROFILES = [
  { id: "test", label: "Test (Sonnet 5.5)", hint: "cheaper, for testing and debugging" },
  { id: "demo", label: "Demo (Opus 5.5)", hint: "for the demo and recording" },
] as const;

/** The Chief Kesuni Officer: which brain it runs on, and a Test / Demo switch saved on the server. */
export default function AgentCard({ settings }: { settings: AgentSettings }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(profile: "test" | "demo") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/settings/agent", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile }),
      });
      if (!res.ok) setError((await res.json()).error ?? "Could not save");
      router.refresh();
    } catch {
      setError("Network error. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Chief Kesuni Officer</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {settings.mode === "claude"
          ? <>Runs on Claude, model <b>{settings.model}</b>{settings.source === "env" && " (from KESUNI_AGENT_MODEL)"}.</>
          : <>Rule-based fallback: {settings.hasApiKey ? "KESUNI_AGENT_MODE=rules is set" : "no ANTHROPIC_API_KEY yet"}. When Claude is on it will use <b>{settings.model}</b>.</>}
        {" "}It proposes and decides within the rules; it never gets a payment tool.
      </p>
      <div className="row" role="radiogroup" aria-label="Agent model">
        {PROFILES.map((p) => (
          <button key={p.id} role="radio" aria-checked={settings.profile === p.id} title={p.hint}
            className={settings.profile === p.id ? "primary" : ""} disabled={busy || settings.profile === p.id}
            onClick={() => void choose(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {error && <div className="alert bad" style={{ marginTop: 8 }}>{error}</div>}
    </section>
  );
}
