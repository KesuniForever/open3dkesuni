"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon, { BrandMark, type IconName } from "./Icon";
import LangSwitch from "./LangSwitch";
import { useT } from "@/i18n/client";

type NavItem = { href: string; label: string; icon: IconName; active: (path: string) => boolean };

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: "overview", active: (p) => p === "/" },
      { href: "/demo", label: "Demo center", icon: "play", active: (p) => p.startsWith("/demo") },
      { href: "/quality", label: "Value & quality", icon: "gauge", active: (p) => p.startsWith("/quality") },
      { href: "/machines", label: "My machines", icon: "printer", active: (p) => p.startsWith("/machines") },
      { href: "/orders", label: "Orders", icon: "orders", active: (p) => p === "/orders" || p.startsWith("/orders/") },
      { href: "/capacity", label: "Capacity", icon: "calendar", active: (p) => p.startsWith("/capacity") },
      { href: "/finance", label: "Finance", icon: "wallet", active: (p) => p.startsWith("/finance") },
      { href: "/calculator", label: "Price calculator", icon: "calculator", active: (p) => p.startsWith("/calculator") },
    ],
  },
  {
    group: "Open3DKesuni network",
    items: [
      { href: "/arc", label: "Circle & Arc", icon: "network", active: (p) => p.startsWith("/arc") },
      { href: "/chief", label: "Chief (AI)", icon: "bot", active: (p) => p.startsWith("/chief") },
      { href: "/operations", label: "Operations", icon: "pulse", active: (p) => p.startsWith("/operations") },
      { href: "/review", label: "Daily review", icon: "review", active: (p) => p.startsWith("/review") },
      { href: "/token", label: "Token research", icon: "flask", active: (p) => p.startsWith("/token") },
    ],
  },
];

/** Customer pages (opened from WhatsApp) never get the operator shell, not even the 404 for a cut-off link (/c, /request). */
export const isCustomerPage = (path: string) =>
  path === "/c" || path.startsWith("/c/") || path === "/request" || path.startsWith("/request/");

function crumb(path: string): string[] {
  if (path.startsWith("/orders/")) return ["Orders", decodeURIComponent(path.split("/")[2] ?? "")];
  // Longest match first, so "/" (Overview) never wins over a deeper page.
  for (const g of NAV) for (const i of g.items) if (i.active(path)) return [i.label];
  return [];
}

/**
 * The operator layout: a left sidebar (brand + grouped nav) and a top bar with a breadcrumb. On phone width the
 * sidebar becomes a top bar with a menu button. Pages render their own content inside.
 */
export default function AppShell({ network, children }: { network: { name: string; isTestnet: boolean }; children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const t = useT();
  if (isCustomerPage(path)) return <>{children}</>;
  const trail = crumb(path);

  return (
    <div className="shell">
      <aside className={`side${open ? " open" : ""}`}>
        <div className="side-head">
          <Link href="/" className="brand" onClick={() => setOpen(false)}>
            <BrandMark />
            <span>Open3DKesuni<small className="brand-sub">Operator</small></span>
          </Link>
          <button type="button" className="side-toggle" aria-expanded={open} aria-controls="side-nav"
            aria-label={open ? t("Close menu") : t("Open menu")} onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "close" : "menu"} size={20} />
          </button>
        </div>
        <nav id="side-nav" className="side-nav" aria-label="Operator">
          {NAV.map((g) => (
            <div key={g.group} className="side-group">
              <div className="side-label">{t(g.group)}</div>
              {g.items.map((i) => {
                const on = i.active(path);
                return (
                  <Link key={i.href} href={i.href} className={`side-link${on ? " on" : ""}`} aria-current={on ? "page" : undefined}
                    onClick={() => setOpen(false)}>
                    <Icon name={i.icon} />{t(i.label)}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="side-note">
            <div className="side-label">{t("Network")}</div>
            <b>{network.name}</b>
            <span>
              {network.isTestnet
                ? t("Real Circle wallets, test USDC. Real printers and customers.")
                : t("Real USDC. Every release still needs the policy engine.")}
            </span>
          </div>
        </nav>
      </aside>
      <div className="shell-main">
        <header className="shell-top">
          <nav className="crumbs" aria-label={t("Breadcrumb")}>
            <Link href="/">Open3DKesuni</Link>
            {trail.map((c, i) => (
              <span key={`${c}-${i}`} className="crumb">
                <Icon name="chevron" size={14} />
                {i === trail.length - 1 ? <b>{t(c)}</b> : c === "Orders" ? <Link href="/orders">{t(c)}</Link> : t(c)}
              </span>
            ))}
          </nav>
          <div className="shell-top-right">
            <span className={`net-pill${network.isTestnet ? "" : " main"}`}>
              <span className="net-dot" />{network.name}{network.isTestnet ? ` · ${t("test USDC")}` : ""}
            </span>
            <LangSwitch />
          </div>
        </header>
        <div className="shell-body">{children}</div>
      </div>
    </div>
  );
}
