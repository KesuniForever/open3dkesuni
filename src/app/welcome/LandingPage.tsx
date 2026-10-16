import type { Metadata } from "next";
import { getLocale, getT } from "@/i18n/server";
import { cachedLive } from "@/lib/live";
import { DEMO_VIDEO_URL, videoEmbed } from "@/lib/landing";
import { CustTop } from "../c/CustTop";
import Icon from "@/app/components/Icon";
import Landing, { type LandingStats } from "./Landing";
import "../live/live.css";
import "./landing.css";

export async function landingMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Open3DKesuni · A 3D-print studio that runs itself"),
    description: t("An AI agent runs the order desk of a real 3D-print studio in Padang; the customer's USDC waits in escrow on Arc until they accept the part."),
    robots: { index: false, follow: false },
  };
}

/**
 * The landing page, served at "/" (everyone's first page) and /welcome: what Open3DKesuni is, before any operator
 * screen. Open without the operator password (GET and HEAD, src/proxy.ts). Links only, no forms. The three live
 * numbers come from the Live studio view (kept a few seconds, src/lib/live.ts).
 */
export default async function LandingPage() {
  const t = await getT();
  const locale = await getLocale();
  let stats: LandingStats | null = null;
  try {
    const o = cachedLive(t, locale).overview;
    stats = { printersOnline: o.printers.online, printersTotal: o.printers.total, orders: o.orders.total, arcVerified: o.money.verified };
  } catch {
    stats = null; // the page still explains the studio without the numbers
  }
  return (
    <main className="live lp" lang={locale}>
      {/* The team's way in, top right. A full page load on purpose: from the internet the browser asks for the password. */}
      <CustTop action={<a className="lp-btn ghost lp-top-dash" href="/dashboard"><Icon name="orders" size={14} />{t("Dashboard")}</a>} />
      <Landing t={t} stats={stats} video={videoEmbed(DEMO_VIDEO_URL)} />
    </main>
  );
}
