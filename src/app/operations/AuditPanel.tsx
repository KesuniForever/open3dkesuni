import Link from "next/link";
import Icon, { type IconName } from "../components/Icon";
import Info from "../components/Info";
import LineMore from "../chief/LineMore";
import { wib, wibDay, type AuditEvent, type AuditKind } from "@/lib/ops";
import type { Locale, T } from "@/i18n/core";

const KIND: Record<AuditKind, { icon: IconName; label: string }> = {
  chief: { icon: "bot", label: "Chief" },
  heartbeat: { icon: "pulse", label: "Heartbeat" },
  code: { icon: "wrench", label: "Code" },
  person: { icon: "review", label: "Person" },
  decision: { icon: "check", label: "Decision" },
  task: { icon: "orders", label: "Task" },
  money: { icon: "wallet", label: "Escrow" },
};

function dayLabel(day: string, now: Date, t: T, locale: Locale): string {
  const today = wibDay(now.toISOString());
  const yesterday = wibDay(new Date(now.getTime() - 86_400_000).toISOString());
  const d = wib(`${day}T05:00:00.000Z`, locale).split(",")[0];
  return day === today ? t("Today · {d}", { d }) : day === yesterday ? t("Yesterday · {d}", { d }) : d;
}

/** One timeline of everything that happened, newest first, grouped by Jakarta day. */
export default function AuditPanel({ events, total, now, more, empty, t, locale }: {
  events: AuditEvent[]; total: number; now: Date; more?: string; empty?: string; t: T; locale: Locale;
}) {
  const days: { day: string; list: AuditEvent[] }[] = [];
  for (const e of events) {
    const day = wibDay(e.at);
    const last = days[days.length - 1];
    if (last?.day === day) last.list.push(e);
    else days.push({ day, list: [e] });
  }
  return (
    <section className="card">
      <h2>
        {t("Traceable history")} <span className="badge">{t(total === 1 ? "{n} event" : "{n} events", { n: total })}</span>
        <Info>{t("Chief runs, heartbeat findings, code actions, people's actions, plan decisions, finished tasks and escrow transfers. Times in WIB.")}</Info>
      </h2>
      {events.length === 0 && <p className="muted" style={{ margin: 0 }}>{empty ?? t("No activity here yet.")}</p>}
      {days.map(({ day, list }) => (
        <div key={day} className="ops-day">
          <h3 className="ops-day-head">{dayLabel(day, now, t, locale)}</h3>
          <ol className="ops-timeline">
            {list.map((e) => (
              <li key={e.id} className={`ops-event k-${e.kind}${e.ok ? "" : " bad"}`}>
                <span className="ops-dot"><Icon name={e.ok ? KIND[e.kind].icon : "close"} size={13} /></span>
                <div className="ops-event-body">
                  <div className="ops-event-top">
                    <strong>{e.title}</strong>
                    {e.repeats > 1 && <span className="badge">×{e.repeats}</span>}
                    <time dateTime={e.at}>{wib(e.at, locale).split(", ")[1]}</time>
                  </div>
                  {e.line && <LineMore className="ops-line" line={e.line}>{e.text && <p>{e.text}</p>}</LineMore>}
                  <div className="ops-event-meta">
                    <span>{t(KIND[e.kind].label)}</span>
                    {e.order.tag === "removed"
                      ? <span>{e.order.id || t("No order")}</span>
                      : <Link href={`/orders/${e.order.id}`}>{e.order.id}</Link>}
                    {e.order.tag !== "real" && <span className={`badge ${e.order.tag === "simulated" ? "simulated" : ""}`}>{t(e.order.tag === "removed" ? "order removed" : "simulated")}</span>}
                    {e.href && <a href={e.href} target="_blank" rel="noreferrer">{t("View on explorer")}</a>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {more && <p style={{ margin: "8px 0 0", fontSize: 13 }}><Link href={more}>{t("Show all {n} events", { n: total })}</Link></p>}
    </section>
  );
}
