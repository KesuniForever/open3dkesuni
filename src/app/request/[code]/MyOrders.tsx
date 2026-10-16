"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CustomerView } from "@/lib/customer";
import { dateLocale, type Locale } from "@/i18n/core";
import { useLocale, useT } from "@/i18n/client";
import Info from "@/app/components/Info";
import { forgetOrder, listRemembered, rememberOrder, type RememberedOrder } from "@/app/c/my-orders";
import { orderLinkFrom, orderStatus, type OrderStatus } from "./order-status";

// The portal's "My orders": the orders sent from this browser (kept in localStorage by the order form), each with its
// status read from its own order page's API (GET /api/c/<token>), plus a field to open an order by its link.
// No account: another phone sees nothing here, and the order links keep working on their own.

/** One order as this list shows it; "missing": the link no longer finds an order. */
type Seen = { status: OrderStatus; product: string; quantity: number } | "missing";

const REFRESH_MS = 20_000;

/** The order page's own view, cut to what the list shows. null: no answer (offline): keep the last status. */
async function readOrder(link: string): Promise<Seen | null> {
  try {
    const res = await fetch(`/api${link}`, { cache: "no-store" });
    if (res.status === 404) return "missing";
    if (!res.ok) return null;
    const v = (await res.json()) as CustomerView;
    return { status: orderStatus(v), product: v.order.product, quantity: v.order.quantity };
  } catch {
    return null;
  }
}

const sentAt = (iso: string, locale: Locale): string => Number.isFinite(Date.parse(iso))
  ? new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  : "";

export default function MyOrders({ orderHref }: { orderHref: string }) {
  const t = useT();
  const locale = useLocale();
  // null until this browser's list is read (the server cannot see it).
  const [list, setList] = useState<RememberedOrder[] | null>(null);
  const [seen, setSeen] = useState<Record<string, Seen>>({});

  const load = useCallback(async () => {
    const mine = listRemembered();
    setList(mine);
    const got = await Promise.all(mine.map(async (o) => [o.link, await readOrder(o.link)] as const));
    setSeen((prev) => {
      const next = { ...prev };
      for (const [link, x] of got) if (x) next[link] = x;
      return next;
    });
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const onShow = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, [load]);

  // This list may be the only place the customer kept the order's link: ask first.
  const forget = (link: string) => {
    if (!window.confirm(t("Remove this order from this list? The order itself stays."))) return;
    forgetOrder(link);
    setList(listRemembered());
  };

  return (
    <>
      <section className="card">
        <h2>
          {t("My orders")}
          <Info>{t("Orders sent or opened on this phone or browser. Remove from list only hides an order here: the order itself stays.")}</Info>
        </h2>
        {list === null ? <p className="muted portal-empty">{t("Loading…")}</p>
          : list.length === 0 ? (
            <div className="portal-empty">
              <p className="muted">{t("No orders from this browser yet.")}</p>
              <Link href={orderHref} className="btn-link">{t("Order a 3D print")}</Link>
            </div>
          ) : (
            <ul className="portal-orders">
              {list.map((o) => <OrderRow key={o.link} o={o} seen={seen[o.link]} locale={locale} onForget={() => forget(o.link)} />)}
            </ul>
          )}
      </section>
      <OpenByLink />
    </>
  );
}

function OrderRow({ o, seen, locale, onForget }: { o: RememberedOrder; seen: Seen | undefined; locale: Locale; onForget: () => void }) {
  const t = useT();
  const live = seen && seen !== "missing" ? seen : null;
  const product = live?.product || o.product || t("Order");
  return (
    <li className="portal-order">
      <div className="portal-order-top">
        <b>{live && live.quantity > 1 ? `${live.quantity} × ` : ""}{product}</b>
        {seen === "missing" ? <span className="badge bad">{t("Not found")}</span>
          : live ? <span className={`badge ${live.status.tone}`}>{t(live.status.text, { pct: `${live.status.percent ?? 0}%`, ...live.status.vars })}</span>
            : <span className="badge">…</span>}
      </div>
      {live?.status.percent != null && (
        <div className="mach-bar portal-order-bar" role="progressbar" aria-valuenow={live.status.percent} aria-valuemin={0} aria-valuemax={100}
          aria-label={t("Print progress {n} percent", { n: live.status.percent })}>
          <span style={{ width: `${Math.max(2, live.status.percent)}%` }} />
        </div>
      )}
      {/* Remove sits on the left by the time, Open alone on the right: one is never tapped for the other. */}
      <div className="portal-order-foot">
        <span className="portal-order-when">
          <span className="muted">{sentAt(o.at, locale)}</span>
          <button type="button" className="quiet" onClick={onForget}>{t("Remove from list")}</button>
        </span>
        {seen !== "missing" && (
          <Link href={o.link} className={`btn-link${live?.status.yourTurn ? "" : " ghost"}`}>{t("Open")}</Link>
        )}
      </div>
    </li>
  );
}

/** What to paste, when the text holds no order link. */
export const NOT_A_LINK = "Paste the whole link Kesuni sent you (it starts with https://).";

/** Paste an order link from WhatsApp: the order is checked, kept in this list, then opened. */
function OpenByLink() {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // English text; translated when shown.
  const [error, setError] = useState<string | null>(null);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const link = orderLinkFrom(text);
    if (!link) return setError(NOT_A_LINK);
    setBusy(true);
    const x = await readOrder(link);
    setBusy(false);
    if (x === "missing") return setError("This order link was not found. Please check the link from Kesuni.");
    if (!x) return setError("Connection lost. Please try again.");
    rememberOrder(link, x.product);
    window.location.assign(link);
  }

  return (
    <section className="card">
      <form className="portal-open" onSubmit={open}>
        <label>{t("Have an order link? Paste it here")}
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Paste the link here")} inputMode="url" autoComplete="off" required maxLength={500} />
        </label>
        <button className="primary" disabled={busy || !text.trim()}>{busy ? t("Opening…") : t("Open")}</button>
      </form>
      {error && <div className="alert bad" role="status">{t(error)}</div>}
    </section>
  );
}
