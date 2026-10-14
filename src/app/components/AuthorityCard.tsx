import type { ChiefAuthority } from "@/lib/agent/authority";

/** "What the Chief does on its own": built from the live config (src/lib/agent/authority.ts), plus today's counts. */
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
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", fontSize: 14 }}>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Decides alone</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.decidesAlone.map((d) => (
              <li key={d.id}>{d.text}{d.by === "code" && <span className="muted"> (code)</span>}</li>
            ))}
          </ul>
        </div>
        <div>
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
