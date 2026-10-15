import Link from "next/link";
import PageHead from "../components/PageHead";
import AgentCard from "../components/AgentCard";
import SkillChip from "../components/SkillChip";
import Callout from "../components/Callout";
import Icon, { type IconName } from "../components/Icon";
import Info from "../components/Info";
import { Lock, Tick } from "./marks";
import LineMore from "./LineMore";
import { agentSettings } from "@/lib/agent/chief";
import { chiefAuthority } from "@/lib/agent/authority";
import { SKILLS } from "@/lib/agent/skills";
import { listOrders } from "@/lib/store";
import { ago, allLog, chiefFeed, wib, type FeedItem } from "@/lib/ops";
import { getLocale, getT } from "@/i18n/server";
import type { Locale, T } from "@/i18n/core";
import "./chief.css";

export const dynamic = "force-dynamic";

// Short labels for the checklist. The live text (with the owner's numbers) stays one click away in "Details".
// An id this map does not know shows its full live text, so a new rule is never hidden.
const ALONE: Record<string, string> = {
  price_by_weight: "Price by weight", choose_plan: "Choose the production plan", choose_printer: "Choose a ready printer",
  create_operator_task: "Ask the operator for tasks", message_customer: "Message the customer",
  request_human_decision: "Ask a person when unsure", qc_task: "Ask for collect and QC", heartbeat: "Run heartbeat checks",
  arc_verify: "Check transfers on Arc", release: "Release escrow after acceptance", refund: "Refund after rejection",
};
const PERSON: Record<string, string> = {
  qc: "Does not approve QC or reprints", printability: "Does not judge printability", material: "No materials beyond PLA and PETG",
  machines: "No machines Kesuni does not run", price_change: "Does not change prices or rules", money: "Does not send funds",
  unknown: "Does not act on missing data", disputes: "Does not settle disputes", printers: "Does not run the printers",
};

const FEED_ICON: Record<string, { icon: IconName; tone: string }> = {
  claude: { icon: "bot", tone: "green" },
  rules: { icon: "gauge", tone: "blue" },
  heartbeat: { icon: "pulse", tone: "blue" },
  action: { icon: "wrench", tone: "" },
};

function FeedRow({ f, now, t, locale }: { f: FeedItem; now: Date; t: T; locale: Locale }) {
  const look = FEED_ICON[f.kind === "run" ? (f.mode ?? "rules") : f.kind];
  const more = Boolean(f.text && f.text !== f.line) || Boolean(f.trigger) || f.questions.length > 0;
  return (
    <li className="chief-item">
      <span className={`attention-icon ${f.refused || f.unfinished ? "amber" : look.tone}`}><Icon name={look.icon} /></span>
      <div className="chief-body">
        <div className="chief-top">
          <b>{f.title}</b>
          {f.repeats > 1 && <span className="badge">×{f.repeats}</span>}
          {f.refused > 0 && <span className="badge warn">{t("{n} refused", { n: f.refused })}</span>}
          {f.unfinished && <span className="badge warn">{t("no summary")}</span>}
          <time className="chief-when" dateTime={f.at} title={`${wib(f.at, locale)} WIB`}>{ago(f.at, now, t)}</time>
        </div>
        <div className="chief-meta">
          {f.order.tag === "removed"
            ? <span>{f.order.id || t("No order")}</span>
            : <Link href={`/orders/${f.order.id}`}>{f.order.id}</Link>}
          {f.order.product && <span className="chief-product">{f.order.product}</span>}
          {f.order.tag !== "real" && <span className={`badge ${f.order.tag === "simulated" ? "simulated" : ""}`}>{t(f.order.tag === "removed" ? "order removed" : "simulated")}</span>}
          {f.model && <span className="mono">{f.model}{f.turns ? ` · ${t(f.turns === 1 ? "{n} turn" : "{n} turns", { n: f.turns })}` : ""}</span>}
        </div>
        {f.questions[0] && (
          <p className="chief-ask"><Lock size={13} /><span className="one-line" title={f.questions[0]}>{t("Asked a person: {q}", { q: f.questions[0] })}</span></p>
        )}
        {(more || f.line) && (
          <LineMore className="chief-line" line={f.line}>
            {more && <>
              {f.trigger && <><h4>{t("Why it woke up")}</h4><p>{f.trigger}</p></>}
              {f.questions.map((q, i) => <div key={i}><h4>{t("Asked a person")}</h4><p>{q}</p></div>)}
              {f.text && <><h4>{t(f.kind === "heartbeat" ? "Findings" : f.kind === "run" ? "Summary" : "Details")}</h4><p>{f.text}</p></>}
              {!f.text && f.line && <><h4>{t("Result")}</h4><p>{f.line}</p></>}
            </>}
          </LineMore>
        )}
        {(f.kind === "run" || f.steps.length > 1 || f.refused > 0) && f.steps.length > 0 && (
          <div className="chief-steps" aria-label={t("Steps")}>
            {f.steps.map((s) => (
              <span key={`${s.tool}-${s.ok}`} className={`chief-step${s.ok ? "" : " bad"}`} title={`${t(s.skill)}${s.ok ? "" : `: ${t("refused")}`}`}>
                {s.ok ? <Tick size={11} /> : <Icon name="close" size={11} />}{s.tool}{s.n > 1 && <small>×{s.n}</small>}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** The Chief Kesuni Officer: who it is, what it decided across all orders, and what it may never do. */
export default async function ChiefPage() {
  const t = await getT();
  const locale = await getLocale();
  const now = new Date();
  const a = chiefAuthority(now);
  const today = a.today;
  const feed = chiefFeed(allLog(), listOrders(), 10, t);
  const payment = a.limitedByCode.find((l) => l.id === "no_payment_tool");
  const limits = a.limitedByCode.filter((l) => l.id !== "no_payment_tool");

  return (
    <main className="wrap">
      <PageHead eyebrow="Chief Kesuni Officer" title={t("Decisions you can trace.")}
        sub={t("One Claude agent with five skills. Every step it takes is in the log.")}
        actions={<>
          <Link className="btn-link ghost" href="/review">{t("Daily review")}</Link>
          <Link className="btn-link" href="/operations?tab=audit">{t("Activity audit")}</Link>
        </>} />

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label"><span>{t("Decisions today")} <Info>{t("Plan, price, printer and task decisions the Chief made itself today ({day}, WIB).", { day: today.day })}</Info></span><Icon name="bot" /></span>
          <b>{today.decisions}</b>
          <span className="muted">{today.refusals > 0 ? <><b>{today.refusals}</b> {t("refused by policy")}</> : t("none refused by policy")}</span>
        </div>
        <div className="stat">
          <span className="stat-label"><span>{t("Handed to a person")} <Info>{t("Questions the Chief asked a person today instead of guessing.")}</Info></span><Icon name="review" /></span>
          <b>{today.escalations}</b>
          <span className="muted">{t("today")}</span>
        </div>
        <div className="stat">
          <span className="stat-label"><span>{t("Customer messages")} <Info>{t("Updates the Chief posted on customers' order pages today.")}</Info></span><Icon name="orders" /></span>
          <b>{today.messages}</b>
          <span className="muted">{t("today")}</span>
        </div>
        <div className="stat">
          <span className="stat-label"><span>{t("Escrow settlements")} <Info>{t("Releases and refunds started by code today, only after the customer decided.")}</Info></span><Icon name="wallet" /></span>
          <b>{today.settlements}</b>
          <span className="muted">{t("today")}</span>
        </div>
      </div>

      <div className="chief-layout">
        <div className="chief-col">
          <AgentCard settings={agentSettings()} />

          <section className="card">
            <h2>
              {t("Recent decisions")} <span className="badge">{feed.length}</span>
              <Info>{t("Newest first, across all orders. Steps are grouped per run. Simulated orders are labelled and are not real business.")}</Info>
            </h2>
            {feed.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{t("No decisions yet. Run the Chief on an order to start.")}</p>
            ) : (
              <ul className="chief-feed">{feed.map((f) => <FeedRow key={f.id} f={f} now={now} t={t} locale={locale} />)}</ul>
            )}
            {feed.length > 0 && <p className="chief-all"><Link href="/operations?tab=audit">{t("Full history in the activity audit")}</Link></p>}
          </section>
        </div>

        <aside className="chief-col">
          <section className="card chief-limits">
            <h2>{t("Authority limits")} <Info>{t("Built from the live config: the Chief's tools, the owner's rules and the network switch.")}</Info></h2>
            {a.hasPaymentTool ? (
              <div className="alert bad" style={{ marginTop: 0 }}>{payment ? t(payment.text) : null}</div>
            ) : (
              <p className="chief-safe"><Icon name="shield" size={16} /><span>{t("No payment tool: {n} tools, none moves money.", { n: a.tools.length })}</span></p>
            )}
            <ul className="chief-checks">
              {a.decidesAlone.map((d) => (
                <li key={d.id}>
                  <span className="chief-mark ok"><Tick /></span>
                  <span>{t(ALONE[d.id] ?? d.text)}{d.by === "code" && <span className="chief-by">{t("code")}</span>}</span>
                </li>
              ))}
            </ul>
            <ul className="chief-checks locked">
              {a.handedToPerson.map((h) => (
                <li key={h.id}>
                  <span className="chief-mark"><Lock /></span>
                  <span>{t(PERSON[h.id] ?? h.text)}{h.enforcedBy === "instructions" && <span className="chief-by warn">{t("prompt only")}</span>}</span>
                </li>
              ))}
            </ul>
            <details className="fold chief-fold">
              <summary>{t("Limited by code ({n})", { n: limits.length })}</summary>
              <ul className="chief-plain">{limits.map((l) => <li key={l.id}>{t(l.text)}</li>)}</ul>
            </details>
            <details className="fold chief-fold">
              <summary>{t("Details from the live config")}</summary>
              <ul className="chief-plain">
                {a.decidesAlone.map((d) => <li key={d.id}>{t(d.text)}</li>)}
                {a.handedToPerson.map((h) => <li key={h.id}><b>{t(h.text)}:</b> {t(h.how)}</li>)}
              </ul>
            </details>
          </section>

          <section className="card">
            <h2>{t("Today by skill")} <Info>{t("Actions the Chief and its code took today, per skill. The skill is set in code from the tool, not by the model.")}</Info></h2>
            <dl className="kv-rows">
              {SKILLS.map((s) => <div key={s}><dt><SkillChip skill={s} /></dt><dd>{today.bySkill[s]}</dd></div>)}
            </dl>
          </section>

          <Callout tone="blue" icon="play" title={t("How the Chief runs")}>
            {t("On each order (Run agent) and on the heartbeat. No chat box: every Claude call belongs to an order.")}
          </Callout>
        </aside>
      </div>
    </main>
  );
}
