import Link from "next/link";
import { listOrders } from "@/lib/store";
import { budgetText } from "@/lib/budget";
import { idrPerUsdc } from "@/lib/costing";
import { network } from "@/lib/network";
import { getT } from "@/i18n/server";
import NewOrderForm from "../components/NewOrderForm";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Icon from "../components/Icon";

export const dynamic = "force-dynamic";

const OPEN = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED"];

/** Every order in one list, filtered by tab: open work, finished, real only, simulated only. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getT();
  const orders = listOrders();
  const groups: Record<string, typeof orders> = {
    all: orders,
    open: orders.filter((o) => OPEN.includes(o.status)),
    done: orders.filter((o) => !OPEN.includes(o.status)),
    real: orders.filter((o) => o.label === "real"),
    simulated: orders.filter((o) => o.label === "simulated"),
  };
  const tabs: Tab[] = [
    { id: "all", label: t("All"), count: groups.all.length },
    { id: "open", label: t("In progress"), count: groups.open.length },
    { id: "done", label: t("Finished"), count: groups.done.length },
    { id: "real", label: t("Real"), count: groups.real.length },
    { id: "simulated", label: t("Simulated"), count: groups.simulated.length },
  ];
  const tab = pickTab(tabs, (await searchParams).tab);
  const shown = groups[tab];
  const testnet = network().isTestnet;

  return (
    <main className="wrap">
      <PageHead eyebrow={t("Orders")} title={t("From quote to payout.")} sub={t("Every order, its status and its money in one list.")}
        actions={<NewOrderForm rate={idrPerUsdc()} />} />
      <Tabs tabs={tabs} active={tab} basePath="/orders" />
      <section className="card orders-panel">
        {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("No orders here yet.")}</p>}
        <div className="orders">
          {shown.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="order-row">
              <span className="attention-icon"><Icon name="box" /></span>
              <span className="order-info">
                <strong>{o.customerName ? `${o.customerName}: ` : ""}{o.product}</strong>
                <span className="muted">
                  {t("{id} · {units} · budget {budget} · due {due} ·", {
                    id: o.id, units: t(o.quantity === 1 ? "{n} unit" : "{n} units", { n: o.quantity }),
                    budget: budgetText(o, t, testnet), due: o.deadline,
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
