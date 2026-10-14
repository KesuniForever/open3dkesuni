import type { ChiefAuthority } from "@/lib/agent/authority";
import { SKILLS } from "@/lib/agent/skills";
import SkillChip from "./SkillChip";

/**
 * "What the Chief does on its own": built from the live config (src/lib/agent/authority.ts), plus today's counts.
 * Grouped by the Chief's five skills, with what it always hands to a person and what keeps it there.
 */
export default function AuthorityCard({ a }: { a: ChiefAuthority }) {
  const t = a.today;
  return (
    <section className="card">
      <h2>What the Chief does on its own</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Today ({t.day}, WIB): <b>{t.decisions}</b> decision{t.decisions === 1 ? "" : "s"} on its own · <b>{t.escalations}</b> escalation{t.escalations === 1 ? "" : "s"} to a person
        {" "}· {t.messages} customer message{t.messages === 1 ? "" : "s"} · {t.settlements} escrow settlement{t.settlements === 1 ? "" : "s"} after the customer decided
        {t.refusals > 0 && <> · {t.refusals} refused by policy or rules</>}.
      </p>
      <div className="skill-row" style={{ marginBottom: 12 }} aria-label="Actions today per skill">
        {SKILLS.map((s) => (
          <span key={s} className="row" style={{ gap: 4, fontSize: 13 }}><SkillChip skill={s} /> {t.bySkill[s]}</span>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", fontSize: 14 }}>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Decides alone</div>
          {SKILLS.map((s) => {
            const items = a.decidesAlone.filter((d) => d.skill === s);
            return items.length === 0 ? null : (
              <div key={s} className="skill-group">
                <SkillChip skill={s} />
                <ul>
                  {items.map((d) => <li key={d.id}>{d.text}{d.by === "code" && <span className="muted"> (code)</span>}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Always handed to a person</div>
          <ul style={{ margin: "0 0 14px", paddingLeft: 18 }}>
            {a.handedToPerson.map((h) => (
              <li key={h.id}>
                {h.text} <span className={`badge ${h.enforcedBy === "code" ? "ok" : "warn"}`}>{h.enforcedBy === "code" ? "code" : "instructions only"}</span>
                <div className="muted" style={{ fontSize: 12 }}>{h.how}</div>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Limited by code</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.limitedByCode.map((l) => (
              <li key={l.id} style={l.id === "no_payment_tool" && a.hasPaymentTool ? { color: "var(--bad)" } : undefined}>{l.text}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
