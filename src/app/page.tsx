import Link from "next/link";
import { listOrders } from "@/lib/store";
import { microToUsdc } from "@/lib/policy";
import NewOrderForm from "./components/NewOrderForm";

export const dynamic = "force-dynamic";

export default function Home() {
  const orders = listOrders();
  return (
    <main className="wrap">
      <header className="topbar">
        <span className="brand">Kesuni 3D</span>
        <span className="muted">Orders</span>
      </header>
      <p className="muted">
        Take an order, let the agent choose a production route within budget, record evidence and QC,
        and pay only after acceptance.
      </p>
      <div style={{ margin: "16px 0" }}><NewOrderForm /></div>
      {orders.length === 0 && <p className="muted">No orders yet.</p>}
      <div className="orders">
        {orders.map((o) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{o.product}</strong>
              <span className={`badge ${o.label}`}>{o.label}</span>
            </div>
            <div className="muted">
              {o.id} · {o.jobId} · budget {microToUsdc(o.mandateMicro)} USDC · due {o.deadline} · <b>{o.status}</b>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
