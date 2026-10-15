"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentSettings } from "@/lib/agent/chief";
import { SKILLS } from "@/lib/agent/skills";
import { useT } from "@/i18n/client";
import SkillChip from "./SkillChip";
import Info from "./Info";

const PROFILES = [
  { id: "test", label: "Test (Sonnet 5.5)", hint: "cheaper, for testing and debugging" },
  { id: "demo", label: "Demo (Opus 5.5)", hint: "for the demo and recording" },
] as const;

/** The Chief Kesuni Officer: which brain it runs on, and a Test / Demo switch saved on the server. */
export default function AgentCard({ settings }: { settings: AgentSettings }) {
  const router = useRouter();
  const t = useT();
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
      <h2>
        Chief Kesuni Officer
        <Info>{t("One AI agent with five skills. It decides within the owner's rules, hands to a person what it cannot check, and never gets a payment tool.")}</Info>
      </h2>
      <div className="skill-row" style={{ alignItems: "center", marginBottom: 8 }} aria-label={t("One Chief, five skills")}>
        {SKILLS.map((s) => <SkillChip key={s} skill={s} />)}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {settings.mode === "claude"
          ? <>Claude · <b>{settings.model}</b>{settings.source === "env" && ` ${t("(from KESUNI_AGENT_MODEL)")}`}</>
          : <>{t("Rule-based fallback ({why}). With Claude:", {
              why: settings.hasApiKey ? "KESUNI_AGENT_MODE=rules" : t("no ANTHROPIC_API_KEY yet"),
            })} <b>{settings.model}</b></>}
      </p>
      <div className="row" role="radiogroup" aria-label={t("Agent model")}>
        {PROFILES.map((p) => (
          <button key={p.id} role="radio" aria-checked={settings.profile === p.id} title={t(p.hint)}
            className={settings.profile === p.id ? "primary" : ""} disabled={busy || settings.profile === p.id}
            onClick={() => void choose(p.id)}>
            {t(p.label)}
          </button>
        ))}
      </div>
      {error && <div className="alert bad" style={{ marginTop: 8 }}>{t(error)}</div>}
    </section>
  );
}
