import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Icon from "../components/Icon";
import Link from "next/link";
import AutoRefresh from "./AutoRefresh";
import { Deadlines, Printers, Stats, Week } from "./CapacityViews";
import { capacity, formatters } from "@/lib/capacity";
import { getLocale, getT } from "@/i18n/server";
import "./capacity.css";

export const dynamic = "force-dynamic";

/** Capacity planner: live printer time and open deadlines for the next 7 Jakarta days. Read-only. */
export default async function CapacityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getT();
  const f = formatters(await getLocale(), t);
  const c = capacity();
  const tabs: Tab[] = [
    { id: "week", label: t("Week") },
    { id: "deadlines", label: t("Deadlines"), count: c.deadlines.length },
    { id: "printers", label: t("Printers"), count: c.lanes.length },
  ];
  const tab = pickTab(tabs, (await searchParams).tab);

  return (
    <main className="wrap">
      <AutoRefresh seconds={60} />
      <PageHead eyebrow={t("Capacity planner")} title={t("Make room for your next job.")}
        sub={t("Live printer time and open deadlines for the next 7 days.")}
        actions={<>
          <Link className="btn-link ghost" href="/machines"><Icon name="printer" size={16} />{t("My machines")}</Link>
          <Link className="btn-link" href="/orders?tab=open"><Icon name="orders" size={16} />{t("Open orders")}</Link>
        </>} />
      <Tabs tabs={tabs} active={tab} basePath="/capacity" />
      <Stats c={c} f={f} />
      {tab === "week" && <Week c={c} f={f} />}
      {tab === "deadlines" && <Deadlines c={c} f={f} />}
      {tab === "printers" && <Printers c={c} f={f} />}
    </main>
  );
}
