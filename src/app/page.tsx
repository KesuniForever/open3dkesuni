import Link from "next/link";
import { listOrders } from "@/lib/store";
import { microToUsdc } from "@/lib/policy";
import { dashboard } from "@/lib/dashboard";
import NewOrderForm from "./components/NewOrderForm";

export const dynamic = "force-dynamic";

const EVIDENCE = { none: "no finished real orders yet", limited: "limited evidence (under 5 orders)", solid: "5+ finished orders" };

export default function Home() {
  const orders = listOrders();
  const d = dashboard();
  const r = d.reputation;
  return (
    <main className="wrap">
      <header className="topbar">
        <span className="brand">Kesuni 3D</span>
        <span className="row" style={{ gap: 12 }}>
          <Link href="/kalkulator">Price calculator</Link>
          <span className="muted">Orders</span>
        </span>
      </header>
      <p className="muted">
        Take an order, price it from real costs, let the agent choose a production route within budget, record evidence and QC,
        and pay out only after the customer accepts.
      </p>

      <div className="stat-grid">
        <div className="stat"><span className="muted">Active orders</span><b>{d.activeReal}</b><span className="muted">real · {d.activeSimulated} simulated</span></div>
        <div className="stat"><span className="muted">Held in escrow</span><b>{microToUsdc(d.escrowHeldMicro.real)} USDC</b><span className="muted">real, testnet · waiting for acceptance</span></div>
        <div className="stat"><span className="muted">Paid out to Kesuni</span><b>{microToUsdc(d.releasedMicro.real)} USDC</b><span className="muted">real, testnet · {microToUsdc(d.releasedMicro.simulated)} in test orders</span></div>
        <div className="stat"><span className="muted">Printers online</span><b>{d.printersOnline} / {d.printersTotal}</b><span className="muted">read from the LAN bridge</span></div>
        <div className="stat"><span className="muted">Reputation</span><b>{r.score === null ? "—" : `${r.score} / 100`}</b><span className="muted">{EVIDENCE[r.evidence]}</span></div>
      </div>

      {d.attention.length > 0 && (
        <section className="card">
          <h2>Needs attention <span className="badge">{d.attention.length}</span></h2>
          <ul className="attention">
            {d.attention.slice(0, 12).map((a, i) => (
              <li key={`${a.orderId}-${a.kind}-${i}`}>
                <Link href={`/orders/${a.orderId}`}><b>{a.product}</b></Link>{" "}
                <span className="muted">({a.orderId})</span>: {a.text}
              </li>
            ))}
          </ul>
        </section>
      )}

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

      <div style={{ margin: "16px 0" }}><NewOrderForm /></div>
      {orders.length === 0 && <p className="muted">No orders yet.</p>}
      <div className="orders">
        {orders.map((o) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{o.customerName ? `${o.customerName}: ` : ""}{o.product}</strong>
              <span className={`badge ${o.label}`}>{o.label}</span>
            </div>
            <div className="muted">
              {o.id} · {o.quantity} unit · budget {microToUsdc(o.mandateMicro)} USDC · due {o.deadline} · <b>{o.status}</b>
              {o.agreement && " · agreed"}{o.review && ` · ${o.review.quality}★`}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
