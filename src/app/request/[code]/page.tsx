import type { Metadata } from "next";
import { getLocale, getT } from "@/i18n/server";
import { CustTop } from "@/app/c/CustTop";
import { TabNav } from "@/app/components/Tabs";
import LiveRefresh from "@/app/live/LiveRefresh";
import { inviteValid } from "@/lib/invite";
import { cachedLive, LIVE_REFRESH_S } from "@/lib/live";
import { portalMachines, portalPrice, portalToken } from "@/lib/portal";
import { tokenReadiness } from "@/lib/token-research";
import OrderForm from "./OrderForm";
import MyOrders from "./MyOrders";
import { MachinesTab, PORTAL_TABS, PriceTab, TokenTab, portalTab } from "./Portal";

// Read at every request: the printers report every few seconds (the Live studio data is kept a few seconds per language).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Order · Open3DKesuni"), robots: { index: false, follow: false } };
}

type Search = { tab?: string | string[]; g?: string | string[]; q?: string | string[]; m?: string | string[] };

/**
 * The customer portal behind the private invite link: the order form (opens first), the orders sent from this
 * browser, the studio's printers, the price calculator and the token research. Open without the operator password
 * (src/proxy.ts); everything here is read-only except the order form, which posts to /api/c with the same code.
 * A wrong code shows one sentence: no tabs, no data.
 */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Search> }) {
  const { code } = await params;
  const t = await getT();
  const locale = await getLocale();
  if (!inviteValid(code)) {
    return (
      <main className="cust" lang={locale}>
        <CustTop />
        <p>{t("This order link is not valid. Please check the link from Kesuni.")}</p>
      </main>
    );
  }
  const search = await searchParams;
  const tab = portalTab(search.tab);
  const base = `/request/${encodeURIComponent(code)}`;
  return (
    <div className="cust portal" lang={locale}>
      <CustTop>{t("Customer portal")}</CustTop>
      <TabNav tabs={PORTAL_TABS} active={tab} basePath={base} t={t} />
      <main className="portal-main">
        {tab === "order" && <OrderForm code={code} embedded />}
        {tab === "orders" && <MyOrders orderHref={base} />}
        {tab === "machines" && (
          <>
            <MachinesTab m={portalMachines(cachedLive(t, locale))} t={t} locale={locale} />
            <LiveRefresh seconds={LIVE_REFRESH_S} />
          </>
        )}
        {tab === "price" && <PriceTab p={portalPrice(search)} action={base} t={t} />}
        {tab === "token" && <TokenTab k={portalToken(tokenReadiness(t))} t={t} />}
      </main>
    </div>
  );
}
