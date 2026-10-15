import type { ChiefAuthority } from "@/lib/agent/authority";
import { SKILLS } from "@/lib/agent/skills";
import { getT } from "@/i18n/server";
import SkillChip from "./SkillChip";
import Info from "./Info";

/**
 * "What the Chief does on its own": built from the live config (src/lib/agent/authority.ts), plus today's counts.
 * Grouped by the Chief's five skills, with what it always hands to a person and what keeps it there.
 */
export default async function AuthorityCard({ a }: { a: ChiefAuthority }) {
  const t = await getT();
  const today = a.today;
  return (
    <section className="card">
      <h2>
        {t("What the Chief does on its own")}
        <Info>{t("Built from the live config. Counts are for today ({day}, WIB). Settlements happen only after the customer decided.", { day: today.day })}</Info>
      </h2>
      <p className="status-line">
        <span><b>{today.decisions}</b> {t(today.decisions === 1 ? "decision" : "decisions")}</span>
        <span><b>{today.escalations}</b> {t("handed to a person")}</span>
        <span><b>{today.messages}</b> {t(today.messages === 1 ? "customer message" : "customer messages")}</span>
        <span><b>{today.settlements}</b> {t(today.settlements === 1 ? "escrow settlement" : "escrow settlements")}</span>
        {today.refusals > 0 && <span><b>{today.refusals}</b> {t("refused by policy")}</span>}
        <span className="muted">{t("today")}</span>
      </p>
      <div className="skill-row" style={{ marginBottom: 12 }} aria-label={t("Actions today per skill")}>
        {SKILLS.map((s) => (
          <span key={s} className="row" style={{ gap: 4, fontSize: 13 }}><SkillChip skill={s} /> {today.bySkill[s]}</span>
        ))}
      </div>
      <details className="fold">
      <summary>{t("The Chief's rules: what it decides, what it hands to a person, what code blocks")}</summary>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", fontSize: 14 }}>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t("Decides alone")}</div>
          {SKILLS.map((s) => {
            const items = a.decidesAlone.filter((d) => d.skill === s);
            return items.length === 0 ? null : (
              <div key={s} className="skill-group">
                <SkillChip skill={s} />
                <ul>
                  {items.map((d) => <li key={d.id}>{t(d.text)}{d.by === "code" && <span className="muted"> {t("(code)")}</span>}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t("Always handed to a person")}</div>
          <ul style={{ margin: "0 0 14px", paddingLeft: 18 }}>
            {a.handedToPerson.map((h) => (
              <li key={h.id}>
                {t(h.text)} <span className={`badge ${h.enforcedBy === "code" ? "ok" : "warn"}`}>{h.enforcedBy === "code" ? t("code") : t("instructions only")}</span>
                <div className="muted" style={{ fontSize: 12 }}>{t(h.how)}</div>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t("Limited by code")}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.limitedByCode.map((l) => (
              <li key={l.id} style={l.id === "no_payment_tool" && a.hasPaymentTool ? { color: "var(--bad)" } : undefined}>{t(l.text)}</li>
            ))}
          </ul>
        </div>
      </div>
      </details>
    </section>
  );
}
