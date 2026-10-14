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

export const dynamic = "force-dynamic";

const ATTENTION_ICON: Record<Attention["kind"], { icon: IconName; tone: string }> = {
  task: { icon: "wrench", tone: "amber" },
  price: { icon: "tag", tone: "blue" },
  pay: { icon: "wallet", tone: "green" },
  decide: { icon: "check", tone: "amber" },
  report: { icon: "review", tone: "blue" },
};

const EVIDENCE = { none: "no finished real orders yet", limited: "limited evidence (under 5 orders)", solid: "5+ finished orders" };

export default function Home() {
  const orders = listOrders();
  const d = dashboard();
  const r = d.reputation;
  // Each amount carries the network of its own escrows, not the configured one (testnet escrows stay test USDC).
  const realMoney = (m: Money) => (
    <>
      <b>{microToUsdc(m.testnet)}<small className="stat-unit">USDC</small></b>
      <span className="muted">real orders, test USDC on Arc Testnet</span>
      {m.mainnet > 0 && <span className="muted"><b>{microToUsdc(m.mainnet)} USDC</b> real orders, real USDC on Arc</span>}
    </>
  );
  return (
    <main className="wrap">
      <header className="page-head">
        <div>
          <p className="eyebrow">Studio overview</p>
          <h1>Every order, from quote to payout.</h1>
          <p className="page-sub">
            Take an order, price it from real costs, let the agent choose a production route within budget, record evidence and QC,
            and pay out only after the customer accepts.
          </p>
        </div>
        <div className="page-actions"><NewOrderForm /></div>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">Active orders <Icon name="orders" /></span>
          <b>{d.activeReal}<small className="stat-unit">real</small></b>
          <span className="muted">{d.activeSimulated} simulated</span>
        </div>
        <div className="stat">
          <span className="stat-label">Held in escrow · waiting for acceptance <Icon name="shield" /></span>
          {realMoney(d.escrowHeldMicro)}
        </div>
        <div className="stat">
          <span className="stat-label">Paid out to Kesuni <Icon name="wallet" /></span>
          {realMoney(d.releasedMicro)}
          <span className="muted">{microToUsdc(d.releasedMicro.simulated)} USDC in test orders</span>
        </div>
        <div className="stat">
          <span className="stat-label">Printers online <Icon name="printer" /></span>
          <b>{d.printersOnline} / {d.printersTotal}<small className="stat-unit">printers</small></b>
          <span className="muted">read from the LAN bridge</span>
        </div>
        <div className="stat">
          <span className="stat-label">Reputation <Icon name="star" /></span>
          <b>{r.score === null ? "—" : r.score}{r.score !== null && <small className="stat-unit">/ 100</small>}</b>
          <span className="muted">{EVIDENCE[r.evidence]}</span>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <AgentCard settings={agentSettings()} />
          <HeartbeatCard initial={heartbeatStatus()} />
        </div>
        <div className="dash-col">
          <section className="card attention-panel">
            <h2>Needs attention {d.attention.length > 0 && <span className="badge warn">{d.attention.length}</span>}</h2>
            {d.attention.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nothing needs a person right now.</p>
            ) : (
              <ul className="attention">
                {d.attention.slice(0, 12).map((a, i) => (
                  <li key={`${a.orderId}-${a.kind}-${i}`}>
                    <Link href={`/orders/${a.orderId}`} className="attention-item">
                      <span className={`attention-icon ${ATTENTION_ICON[a.kind].tone}`}><Icon name={ATTENTION_ICON[a.kind].icon} /></span>
                      <span className="attention-text">
                        <b>{a.product}</b> <span className="muted">({a.orderId})</span>
                        <span className="attention-sub">{a.text}</span>
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
              <h2>Reputation from finished work</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                40% passed QC without rework · 25% on time · 20% quality · 10% communication · 5% worth the price. Each part starts at a neutral 70 so a few orders cannot max it out. Real orders only.
              </p>
              <dl className="calc-kv">
                <div><dt>Finished real orders</dt><dd>{r.finished}</dd></div>
                <div><dt>On time</dt><dd>{r.onTimePct ?? "—"}%</dd></div>
                <div><dt>Passed QC without rework</dt><dd>{r.firstPassPct ?? "—"}%</dd></div>
                <div><dt>Reviews</dt><dd>{r.reviews} · quality {r.avg.quality ?? "—"} · communication {r.avg.communication ?? "—"} · value {r.avg.value ?? "—"}</dd></div>
              </dl>
            </section>
          )}
        </div>
      </div>

      <AuthorityCard a={chiefAuthority()} />
      <TractionCard t={traction()} />

      <section className="card orders-panel" id="orders">
        <h2>Orders <span className="badge">{orders.length}</span></h2>
        {orders.length === 0 && <p className="muted" style={{ margin: 0 }}>No orders yet.</p>}
        <div className="orders">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="order-row">
              <span className="attention-icon"><Icon name="box" /></span>
              <span className="order-info">
                <strong>{o.customerName ? `${o.customerName}: ` : ""}{o.product}</strong>
                <span className="muted">
                  {o.id} · {o.quantity} unit · budget {microToUsdc(o.mandateMicro)} USDC · due {o.deadline} · <b>{o.status}</b>
                  {o.agreement && " · agreed"}{o.review && ` · ${o.review.quality}★`}
                </span>
              </span>
              <span className={`badge ${o.label}`}>{o.label}</span>
              <Icon name="chevron" size={16} className="attention-go" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
