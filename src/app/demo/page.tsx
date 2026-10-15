import Link from "next/link";
import { DEMO_SCENARIOS, demoFacts, demoOrders, type ScenarioId } from "@/lib/demo";
import PageHead from "../components/PageHead";
import Callout from "../components/Callout";
import Info from "../components/Info";
import Icon, { type IconName } from "../components/Icon";
import TryScenario from "./TryScenario";
import { getT } from "@/i18n/server";
import "./demo.css";

export const dynamic = "force-dynamic";

const ICON: Record<ScenarioId, IconName> = {
  smooth: "box",
  "above-limit": "shield",
  "below-minimum": "tag",
  "late-deadline": "calendar",
  "customer-rejects": "wallet",
  "printer-offline": "printer",
};
const SHOWN = 8;

function Clock() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2" />
    </svg>
  );
}

/** Demo center: try a scenario on a new simulated order made by the real engine, then walk it through. */
export default async function DemoPage() {
  const t = await getT();
  const facts = demoFacts(t);
  const rows = demoOrders(undefined, t);

  return (
    <main className="wrap">
      <PageHead eyebrow={t("Interactive demo")} title={t("Try a scenario. See the outcome.")}
        sub={t("Each one adds a simulated order, made by the real engine.")}
        actions={<Link className="btn-link ghost" href="/orders?tab=simulated">{t("Simulated orders")}<Icon name="arrow" size={16} /></Link>} />

      <Callout icon="shield" title={t("Practice in your simulation workspace · {n} scenarios", { n: DEMO_SCENARIOS.length })}>
        {t("Labelled simulated, never counted as business. No USDC moves.")}{" "}
        <Info>
          {t("Demo orders are real rows, so the heartbeat watches them like any order and the Chief may step in (a paid Claude call). Paying one on its customer page would move real test USDC on Arc Testnet. Clear them with Reset simulated demo on any order page.")}
        </Info>
      </Callout>

      <div className="demo-grid">
        {DEMO_SCENARIOS.map((s, i) => (
          <article key={s.id} className="tile demo-tile">
            <div className="tile-head">
              <span className="tile-icon"><Icon name={ICON[s.id]} size={20} /></span>
              <span className={`demo-tag${i === 0 ? " start" : ""}`}>{t(s.tag)}</span>
            </div>
            <h3>{t(s.title)} <Info>{t(s.detail)}</Info></h3>
            <p className="demo-line">{t(s.line)}</p>
            <p className="demo-fact">{facts[s.id]}</p>
            <div className="demo-foot">
              <small><Clock />{t(s.duration)}</small>
              <TryScenario id={s.id} title={t(s.title)} />
            </div>
          </article>
        ))}
      </div>

      <section className="card demo-orders">
        <h2>
          {t("Your demo orders")} <span className="badge">{rows.length}</span>
          <Info>{t("Simulated orders made here, newest first. Open one to walk it through.")}</Info>
        </h2>
        {rows.length === 0 ? (
          <p className="muted demo-empty">{t("No demo orders yet. Try a scenario above.")}</p>
        ) : (
          <div className="orders">
            {rows.slice(0, SHOWN).map((r) => (
              <Link key={r.orderId} href={`/orders/${r.orderId}`} className="order-row">
                <span className="attention-icon"><Icon name="box" /></span>
                <span className="order-info">
                  <strong>{t(r.scenario)}</strong>
                  <span className="muted">
                    {r.orderId} · {r.product} · {t(r.quantity === 1 ? "{n} unit" : "{n} units", { n: r.quantity })} · {t("due {date}", { date: r.deadline })}
                  </span>
                </span>
                <span className={`demo-state ${r.tone}`}>{r.now}</span>
                <span className="badge simulated">{t("simulated")}</span>
                <Icon name="chevron" size={16} className="attention-go" />
              </Link>
            ))}
          </div>
        )}
        {rows.length > SHOWN && (
          <Link className="demo-more" href="/orders?tab=simulated">{t("All simulated orders")}<Icon name="chevron" size={14} /></Link>
        )}
      </section>

      <div className="demo-strip">
        <div>
          <b>{t("Want to see the testnet connection?")}</b>
          <span>{t("Arc blocks and Circle wallets, live.")}</span>
        </div>
        <Link className="btn-link" href="/arc">{t("Open Circle & Arc")}<Icon name="arrow" size={16} /></Link>
      </div>
    </main>
  );
}
