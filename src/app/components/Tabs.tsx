import Link from "next/link";
import { getT } from "@/i18n/server";

export type Tab = { id: string; label: string; count?: number };

/**
 * Segmented tabs as plain links (?tab=<id>), so a page stays a server component and each tab can be linked to.
 * Read the active tab with `pickTab(tabs, (await searchParams).tab)`. Labels are English (or already translated).
 */
export default async function Tabs({ tabs, active, basePath }: { tabs: Tab[]; active: string; basePath: string }) {
  const t = await getT();
  return (
    <nav className="tabs" aria-label={t("Sections")}>
      {tabs.map((tab) => (
        <Link key={tab.id} href={tab.id === tabs[0].id ? basePath : `${basePath}?tab=${tab.id}`} scroll={false}
          className={`tab${tab.id === active ? " on" : ""}`} aria-current={tab.id === active ? "page" : undefined}>
          {t(tab.label)}{tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function pickTab(tabs: Tab[], wanted: string | string[] | undefined): string {
  const w = Array.isArray(wanted) ? wanted[0] : wanted;
  return tabs.some((t) => t.id === w) ? (w as string) : tabs[0].id;
}
