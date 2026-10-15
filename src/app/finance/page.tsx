import type { ReactNode } from "react";
import Link from "next/link";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Callout from "../components/Callout";
import Info from "../components/Info";
import Icon, { type IconName } from "../components/Icon";
import { finance, rp, usdc, type Split } from "@/lib/finance";
import { idrPerUsdc, microToIdr } from "@/lib/costing";
import { pricingConfig } from "@/lib/pricing";
import { ownerRules } from "@/lib/owner-rules";
import { network } from "@/lib/network";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { JournalTab, OrdersTab, PricingTab, TransfersTab } from "./sections";
import "./finance.css";

export const dynamic = "force-dynamic";

const realOrders = (t: T, n: number) => t(n === 1 ? "{n} real order" : "{n} real orders", { n });
const orders = (t: T, n: number) => t(n === 1 ? "{n} order" : "{n} orders", { n });

function Stat({ label, icon, info, children }: { label: string; icon: IconName; info: ReactNode; children: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label"><span>{label} <Info>{info}</Info></span><Icon name={icon} /></span>
      {children}
    </div>
  );
}

/** A USDC pot: real orders big (test USDC, per escrow network), simulated orders underneath, never added in. */
function UsdcStat({ t, label, icon, info, micro, orders: n }: { t: T; label: string; icon: IconName; info: ReactNode; micro: Split; orders: Split }) {
  return (
    <Stat label={label} icon={icon} info={info}>
      <b>{usdc(micro.testnet)}<small className="stat-unit">{t("test USDC")}</small></b>
      <span className="fin-stat-sub">≈{rp(microToIdr(micro.testnet))} · {realOrders(t, n.testnet)}</span>
      {micro.mainnet > 0 && <span className="fin-stat-sub"><b>{usdc(micro.mainnet)} USDC</b> {t("real money on Arc")} · {orders(t, n.mainnet)}</span>}
      <span className="fin-sim"><span className="badge simulated">{t("simulated")}</span>{usdc(micro.simulated)} {t("test USDC")} · {t("not counted")}</span>
      {micro.simulatedMainnet > 0 && <span className="fin-sim"><span className="badge simulated">{t("simulated")}</span>{usdc(micro.simulatedMainnet)} {t("USDC on mainnet")} · {t("not counted")}</span>}
    </Stat>
  );
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getT();
  const f = finance();
  const net = network();
  const { agreed, quoted } = f.totals;
  const tabs: Tab[] = [
    { id: "orders", label: t("Orders"), count: f.positions.length },
    { id: "transfers", label: t("Arc transfers"), count: f.transfers.length },
    { id: "journal", label: t("Journal"), count: f.ledger.entries.length },
    { id: "pricing", label: t("Pricing") },
  ];
  const tab = pickTab(tabs, (await searchParams).tab);

  return (
    <main className="wrap">
      <PageHead
        eyebrow={t("Studio finance")}
        title={t("Every rupiah, accounted for.")}
        sub={t("Rupiah agreed with customers, and the USDC each order locks on {network}.", { network: net.name })}
        actions={<>
          <Link href="/arc?tab=check" className="btn-link ghost"><Icon name="chain" size={16} />{t("Arc check")}</Link>
          <Link href="/calculator" className="btn-link"><Icon name="calculator" size={16} />{t("Price calculator")}</Link>
        </>}
      />

      <div className="stat-grid">
        <Stat label={t("Agreed order value")} icon="receipt"
          info={t("Rupiah price of real orders the customer approved (price and spec unchanged since). Rejected orders are left out. Customers pay in rupiah, outside the app. ≈ = converted from USDC at {rate} per USDC.", { rate: rp(idrPerUsdc()) })}>
          <b>{agreed.real.approx ? "≈" : ""}{rp(agreed.real.idr)}</b>
          <span className="fin-stat-sub">{realOrders(t, agreed.real.count)}</span>
          {quoted.real.count > 0 && <span className="fin-stat-sub">+{quoted.real.approx ? "≈" : ""}{rp(quoted.real.idr)} {t("quoted, not approved yet")}</span>}
          <span className="fin-sim"><span className="badge simulated">{t("simulated")}</span>{agreed.simulated.approx ? "≈" : ""}{rp(agreed.simulated.idr)} · {t("not counted")}</span>
        </Stat>
        <UsdcStat t={t} label={t("In escrow now")} icon="shield" micro={f.totals.held} orders={f.totals.heldOrders}
          info={t("Deposited by the customer, not yet released or refunded. Waits until the customer accepts the print.")} />
        <UsdcStat t={t} label={t("Released to Kesuni")} icon="wallet" micro={f.totals.released} orders={f.totals.releasedOrders}
          info={t("Sent from escrow to Kesuni's wallet after the customer accepted the print.")} />
        <UsdcStat t={t} label={t("Refunded")} icon="arrow" micro={f.totals.refunded} orders={f.totals.refundedOrders}
          info={t("Sent back from escrow to the customer's wallet after a rejection.")} />
      </div>

      <Tabs tabs={tabs} active={tab} basePath="/finance" />
      {tab === "orders" && <OrdersTab f={f} />}
      {tab === "transfers" && <TransfersTab f={f} />}
      {tab === "journal" && <JournalTab f={f} />}
      {tab === "pricing" && <PricingTab cfg={pricingConfig()} rules={ownerRules()} idrPerUsdc={idrPerUsdc()} network={net.name} />}

      <Callout icon="shield" tone="blue" title={t("Customer money waits in escrow.")}>
        {t("Customers pay in rupiah. The same price stays locked on {network} until they accept the print.", { network: net.name })}
      </Callout>
    </main>
  );
}
