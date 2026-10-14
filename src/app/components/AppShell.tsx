"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon, { BrandMark, type IconName } from "./Icon";

type NavItem = { href: string; label: string; icon: IconName; active: (path: string) => boolean };

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: "overview", active: (p) => p === "/" },
      { href: "/#orders", label: "Orders", icon: "orders", active: (p) => p.startsWith("/orders/") },
      { href: "/kalkulator", label: "Price calculator", icon: "calculator", active: (p) => p.startsWith("/kalkulator") },
    ],
  },
  {
    group: "Arc & Chief",
    items: [
      { href: "/arc", label: "Arc transactions", icon: "chain", active: (p) => p.startsWith("/arc") },
      { href: "/review", label: "Daily review", icon: "review", active: (p) => p.startsWith("/review") },
    ],
  },
];

/** Customer pages (opened from WhatsApp) never get the operator shell, not even the 404 for a cut-off link (/c, /pesan). */
export const isCustomerPage = (path: string) =>
  path === "/c" || path.startsWith("/c/") || path === "/pesan" || path.startsWith("/pesan/");

function crumb(path: string): string[] {
  if (path.startsWith("/orders/")) return ["Orders", decodeURIComponent(path.split("/")[2] ?? "")];
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
            aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "close" : "menu"} size={20} />
          </button>
        </div>
        <nav id="side-nav" className="side-nav" aria-label="Operator">
          {NAV.map((g) => (
            <div key={g.group} className="side-group">
              <div className="side-label">{g.group}</div>
              {g.items.map((i) => {
                const on = i.active(path);
                return (
                  <Link key={i.href} href={i.href} className={`side-link${on ? " on" : ""}`} aria-current={on ? "page" : undefined}
                    onClick={() => setOpen(false)}>
                    <Icon name={i.icon} />{i.label}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="side-note">
            <div className="side-label">Network</div>
            <b>{network.name}</b>
            <span>
              {network.isTestnet
                ? "Real Circle wallets, test USDC. Real printers and customers."
                : "Real USDC. Every release still needs the policy engine."}
            </span>
          </div>
        </nav>
      </aside>
      <div className="shell-main">
        <header className="shell-top">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/">Open3DKesuni</Link>
            {trail.map((t, i) => (
              <span key={`${t}-${i}`} className="crumb">
                <Icon name="chevron" size={14} />
                {i === trail.length - 1 ? <b>{t}</b> : t === "Orders" ? <Link href="/#orders">{t}</Link> : t}
              </span>
            ))}
          </nav>
          <span className={`net-pill${network.isTestnet ? "" : " main"}`}>
            <span className="net-dot" />{network.name}{network.isTestnet ? " · test USDC" : ""}
          </span>
        </header>
        <div className="shell-body">{children}</div>
      </div>
    </div>
  );
}
