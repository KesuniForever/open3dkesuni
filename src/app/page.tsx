import Link from "next/link";
import { listOrders } from "@/lib/store";
import { microToUsdc } from "@/lib/policy";
import { dashboard, type Attention, type Money } from "@/lib/dashboard";
import { agentSettings } from "@/lib/agent/chief";
import NewOrderForm from "./components/NewOrderForm";
import AgentCard from "./components/AgentCard";
import HeartbeatCard from "./components/HeartbeatCard";
import ChainHealthCard from "./components/ChainHealthCard";
import { heartbeatStatus } from "@/lib/agent/heartbeat";
import TractionCard from "./components/TractionCard";
import AuthorityCard from "./components/AuthorityCard";
import { traction } from "@/lib/traction";
import { chiefAuthority } from "@/lib/agent/authority";
import Icon, { type IconName } from "./components/Icon";
import Info from "./components/Info";
import { network } from "@/lib/network";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

const ATTENTION_ICON: Record<Attention["kind"], { icon: IconName; tone: string }> = {
  task: { icon: "wrench", tone: "amber" },
  price: { icon: "tag", tone: "blue" },
  pay: { icon: "wallet", tone: "green" },
  decide: { icon: "check", tone: "amber" },
  report: { icon: "review", tone: "blue" },
};

const EVIDENCE = { none: "no finished real orders yet", limited: "limited evidence (under 5 orders)", solid: "5+ finished orders" };

export default async function Home() {
  const t = await getT();
  const orders = listOrders();
  const d = dashboard();
  const r = d.reputation;
  // Each amount carries the network of its own escrows, not the configured one (testnet escrows stay test USDC).
  const realMoney = (m: Money) => (
    <>
      <b>{microToUsdc(m.testnet)}<small className="stat-unit">{t("test USDC")}</small></b>
      {m.mainnet > 0 && <span className="muted"><b>{microToUsdc(m.mainnet)} USDC</b> {t("real money on Arc")}</span>}
    </>
  );
  const budgetUnit = network().isTestnet ? t("test USDC") : "USDC";
  return (
    <main className="wrap">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t("Studio overview")}</p>
          <h1>{t("Every order, from quote to payout.")}</h1>
        </div>
        <div className="page-actions"><NewOrderForm /></div>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">
            <span>{t("Active orders")} <Info>{t("Real orders only. {n} simulated (test) orders are not counted.", { n: d.activeSimulated })}</Info></span>
            <Icon name="orders" />
          </span>
          <b>{d.activeReal}<small className="stat-unit">{t("real")}</small></b>
        </div>
        <div className="stat">
          <span className="stat-label">
            <span>{t("In escrow")} <Info>{t("Customer money locked until the customer accepts the print. Real orders only.")}</Info></span>
            <Icon name="shield" />
          </span>
          {realMoney(d.escrowHeldMicro)}
        </div>
        <div className="stat">
          <span className="stat-label">
            <span>
              {t("Paid to Kesuni")}{" "}
              <Info>{t("Released after the customer accepted. Real orders only. Not counted: {usdc} USDC in simulated (test) orders.", { usdc: microToUsdc(d.releasedMicro.simulated) })}</Info>
            </span>
            <Icon name="wallet" />
          </span>
          {realMoney(d.releasedMicro)}
        </div>
        <div className="stat">
          <span className="stat-label">
            <span>
              {t("Printers online")}{" "}
              <Info>{t("Live from the printers through the LAN bridge. A printer with no report in the last 2 minutes counts as offline.")}</Info>
            </span>
            <Icon name="printer" />
          </span>
          <b>{d.printersOnline} / {d.printersTotal}<small className="stat-unit">{t("printers")}</small></b>
        </div>
        <div className="stat">
          <span className="stat-label">
            <span>{t("Reputation")} <Info>{t("From finished real orders: QC, on time and customer reviews. Now: {evidence}.", { evidence: t(EVIDENCE[r.evidence]) })}</Info></span>
            <Icon name="star" />
          </span>
          <b>{r.score === null ? "—" : r.score}{r.score !== null && <small className="stat-unit">/ 100</small>}</b>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <AgentCard settings={agentSettings()} />
          <HeartbeatCard initial={heartbeatStatus()} />
        </div>
        <div className="dash-col">
          <section className="card attention-panel">
            <h2>{t("Needs attention")} {d.attention.length > 0 && <span className="badge warn">{d.attention.length}</span>}</h2>
            {d.attention.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{t("Nothing needs a person right now.")}</p>
            ) : (
              <ul className="attention">
                {d.attention.slice(0, 12).map((a, i) => (
                  <li key={`${a.orderId}-${a.kind}-${i}`}>
                    <Link href={`/orders/${a.orderId}`} className="attention-item">
                      <span className={`attention-icon ${ATTENTION_ICON[a.kind].tone}`}><Icon name={ATTENTION_ICON[a.kind].icon} /></span>
                      <span className="attention-text">
                        <b>{a.product}</b> <span className="muted">({a.orderId})</span>
                        <span className="attention-sub one-line">{t(a.text)}</span>
                      </span>
                      <Icon name="chevron" size={16} className="attention-go" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ChainHealthCard />
          {r.finished > 0 && (
            <section className="card">
              <h2>
                {t("Reputation from finished work")}{" "}
                <Info>{t("40% passed QC without rework · 25% on time · 20% quality · 10% communication · 5% worth the price. Each part starts at a neutral 70 so a few orders cannot max it out. Real orders only.")}</Info>
              </h2>
              <dl className="calc-kv">
                <div><dt>{t("Finished real orders")}</dt><dd>{r.finished}</dd></div>
                <div><dt>{t("On time")}</dt><dd>{r.onTimePct ?? "—"}%</dd></div>
                <div><dt>{t("Passed QC without rework")}</dt><dd>{r.firstPassPct ?? "—"}%</dd></div>
                <div>
                  <dt>{t("Reviews")}</dt>
                  <dd>
                    {t("{n} · quality {quality} · communication {communication} · value {value}", {
                      n: r.reviews, quality: r.avg.quality ?? "—", communication: r.avg.communication ?? "—", value: r.avg.value ?? "—",
                    })}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      </div>

      <AuthorityCard a={chiefAuthority()} />
      <TractionCard t={traction()} />

      <section className="card orders-panel" id="orders">
        <h2>{t("Orders")} <span className="badge">{orders.length}</span></h2>
        {orders.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("No orders yet.")}</p>}
        <div className="orders">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="order-row">
              <span className="attention-icon"><Icon name="box" /></span>
              <span className="order-info">
                <strong>{o.customerName ? `${o.customerName}: ` : ""}{o.product}</strong>
                <span className="muted">
                  {t("{id} · {units} · budget {budget} {unit} · due {due} ·", {
                    id: o.id, units: t(o.quantity === 1 ? "{n} unit" : "{n} units", { n: o.quantity }),
                    budget: microToUsdc(o.mandateMicro), unit: budgetUnit, due: o.deadline,
                  })}{" "}
                  <b>{o.status}</b>
                  {o.agreement && ` · ${t("agreed")}`}{o.review && ` · ${o.review.quality}★`}
                </span>
              </span>
              <span className={`badge ${o.label}`}>{t(o.label)}</span>
              <Icon name="chevron" size={16} className="attention-go" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
