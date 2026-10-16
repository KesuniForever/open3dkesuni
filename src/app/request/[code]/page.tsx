import type { Metadata } from "next";
import { getLocale, getT } from "@/i18n/server";
import { CustTop } from "@/app/c/CustTop";
import { WhatsAppButton, whatsappNumber } from "@/app/c/whatsapp";
import { TabNav } from "@/app/components/Tabs";
import LiveRefresh from "@/app/live/LiveRefresh";
import { inviteValid } from "@/lib/invite";
import { cachedLive, LIVE_REFRESH_S } from "@/lib/live";
import { portalMachines, portalPrice } from "@/lib/portal";
import { idrPerUsdc } from "@/lib/costing";
import { jakartaToday, studioOnline } from "@/lib/customer";
import OrderForm from "./OrderForm";
import MyOrders from "./MyOrders";
import { MachinesTab, PORTAL_TABS, PriceTab, portalTab } from "./Portal";

// Read at every request: the printers report every few seconds (the Live studio data is kept a few seconds per language).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Order · Open3DKesuni"), robots: { index: false, follow: false } };
}

type Search = { tab?: string | string[]; g?: string | string[]; q?: string | string[]; m?: string | string[] };

/** The portal's address: src/proxy.ts shows /request/<invite code> at /customer, so the tabs keep that short link (and
 *  keep working when the code changes). */
const BASE = "/customer";

/**
 * The customer portal behind the private invite link: the order form (opens first), the orders sent from this
 * browser, the studio's printers and the price calculator. Open without the operator password (src/proxy.ts);
 * everything here is read-only except the order form, which posts to /api/c with the same code. A wrong code shows one
 * sentence: no tabs, no data. (The token research is on the Live studio page, /live.)
 */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Search> }) {
  const { code } = await params;
  const t = await getT();
  const locale = await getLocale();
  const whatsapp = whatsappNumber(process.env.KESUNI_WHATSAPP);
  if (!inviteValid(code)) {
    return (
      <main className="cust" lang={locale}>
        <CustTop />
        <p>{t("This order link is not valid. Please check the link from Kesuni.")}</p>
        <WhatsAppButton number={whatsapp} label={t("Chat Kesuni on WhatsApp")} />
      </main>
    );
  }
  const search = await searchParams;
  const tab = portalTab(search.tab);
  return (
    <div className="cust portal" lang={locale}>
      <CustTop home={BASE}>{t("Customer portal")}</CustTop>
      <TabNav tabs={PORTAL_TABS} active={tab} basePath={BASE} t={t} />
      <main className="portal-main">
        {tab === "order" && (
          <OrderForm code={code} embedded rate={idrPerUsdc()} today={jakartaToday()} whatsapp={whatsapp} studioLive={studioOnline()} />
        )}
        {tab === "orders" && <MyOrders orderHref={BASE} />}
        {tab === "machines" && (
          <>
            <MachinesTab m={portalMachines(cachedLive(t, locale), t)} t={t} locale={locale} />
            <LiveRefresh seconds={LIVE_REFRESH_S} />
          </>
        )}
        {tab === "price" && <PriceTab p={portalPrice(search)} action={BASE} t={t} />}
      </main>
    </div>
  );
}
