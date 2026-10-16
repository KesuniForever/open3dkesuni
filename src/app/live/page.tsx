import type { Metadata } from "next";
import { getLocale, getT } from "@/i18n/server";
import { cachedLive, LIVE_REFRESH_S } from "@/lib/live";
import { CustTop } from "../c/CustTop";
import Icon from "@/app/components/Icon";
import LiveStudio, { liveTab } from "./LiveStudio";
import LiveRefresh from "./LiveRefresh";
import "../welcome/landing.css";

// Read at every request (kept a few seconds per language, src/lib/live.ts): the printers report every few seconds.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Live studio · Open3DKesuni"),
    description: t("A real 3D-print studio in Padang, Indonesia. An AI agent runs the order desk; people do the hands-on work."),
    robots: { index: false, follow: false },
  };
}

/**
 * Live studio: the public, read-only page for judges and anyone with the link. Open without the operator password
 * (GET and HEAD only, src/proxy.ts); the customer layout, no operator navigation. Nothing here moves a printer or money.
 * Opens on the Overview; ?tab=printers, agent or money opens that tab (anything else: the Overview). The refresh keeps it.
 */
export default async function LivePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const t = await getT();
  const locale = await getLocale();
  const tab = liveTab((await searchParams).tab);
  const v = cachedLive(t, locale);
  return (
    <main className="live" lang={locale}>
      {/* The team's way in, as on the landing page. A full page load on purpose: from the internet the browser asks for the password. */}
      <CustTop action={<a className="lp-btn ghost lp-top-dash" href="/dashboard"><Icon name="orders" size={14} />{t("Dashboard")}</a>}>{t("Live studio")}</CustTop>
      <LiveStudio v={v} t={t} locale={locale} seconds={LIVE_REFRESH_S} tab={tab} />
      <LiveRefresh seconds={LIVE_REFRESH_S} />
    </main>
  );
}
