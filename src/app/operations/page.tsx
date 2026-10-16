import Link from "next/link";
import { Suspense } from "react";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import HeartbeatCard from "../components/HeartbeatCard";
import Icon from "../components/Icon";
import Info from "../components/Info";
import { Lock, Tick } from "../chief/marks";
import LineMore from "../chief/LineMore";
import IntegrationPanel, { IntegrationFallback } from "./IntegrationPanel";
import MoneyFlowPanel, { usdc } from "./MoneyFlowPanel";
import AuditPanel from "./AuditPanel";
import * as store from "@/lib/store";
import { network } from "@/lib/network";
import { notReadyReason } from "@/lib/printer/actions";
import { agentSettings, maxWakesPerHour } from "@/lib/agent/chief";
import { ARC_CHECKS_PER_BEAT, heartbeatStatus } from "@/lib/agent/heartbeat";
import { dailyReviewHour } from "@/lib/agent/daily-review";
import { chiefAuthority } from "@/lib/agent/authority";
import { traction } from "@/lib/traction";
import { storagePlan } from "@/lib/deploy";
import {
  ago, allLog, auditEvents, chiefFeed, dbWhere, every, integrationRows, loadMoneyFlow, matchesFilter, pickFilter, type TagFilter,
} from "@/lib/ops";
import { getLocale, getT } from "@/i18n/server";
import type { Locale, T } from "@/i18n/core";
import "./operations.css";

export const dynamic = "force-dynamic";

const TABS: Tab[] = [
  { id: "status", label: "Integration status" },
  { id: "money", label: "Money flow" },
  { id: "audit", label: "Activity audit" },
  { id: "heartbeat", label: "Heartbeat" },
];
const AUDIT_SHOWN = 30;

function Filter({ base, active, items, t }: { base: string; active: string; items: { id: string; label: string; count?: number }[]; t: T }) {
  return (
    <nav className="ops-filter" aria-label={t("Filter")}>
      {items.map((i) => (
        <Link key={i.id} href={`${base}${i.id === items[0].id ? "" : `&filter=${i.id}`}`} scroll={false}
          className={i.id === active ? "on" : undefined} aria-current={i.id === active ? "true" : undefined}>
          {i.label}{i.count !== undefined && <span>{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

function StatusTab({ now, t, locale }: { now: Date; t: T; locale: Locale }) {
  const net = network();
  const orders = store.listOrders();
  const printers = store.listPrinters();
  const online = printers.filter((p) => !(notReadyReason(p, now.getTime()) ?? "").startsWith("offline")).length;
  const lastSeen = printers.map((p) => p.lastSeen).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const hb = heartbeatStatus();
  const s = agentSettings();
  const mainnetUnlocked = process.env.KESUNI_ALLOW_MAINNET === "1";
  const rows = integrationRows({
    now,
    agent: { mode: s.mode, model: s.model, profile: s.profile, hasApiKey: s.hasApiKey },
    heartbeat: {
      enabled: hb.enabled, intervalSeconds: hb.intervalSeconds, schedulerRunning: hb.schedulerRunning,
      lastAt: hb.last?.at ?? null, nextRunAt: hb.nextRunAt, lastErrors: hb.last?.errors.length ?? 0,
    },
    printers: { total: printers.length, online, lastSeen },
    network: { name: net.name, isTestnet: net.isTestnet },
    mainnetUnlocked,
    db: {
      orders: orders.length, real: orders.filter((o) => o.label === "real").length, logRows: allLog().length,
      where: dbWhere(storagePlan(process.env, process.cwd())),
    },
    customerLinks: orders.filter((o) => o.customerToken).length,
  }, t, locale);
  const usage = traction({ now });
  const a = chiefAuthority(now);
  const shownNet = { name: net.name, isTestnet: net.isTestnet };
  const limits: { ok: boolean; text: string }[] = [
    { ok: net.isTestnet, text: net.isTestnet ? t("{name} only: test USDC, no real money", { name: net.name }) : t("{name}: real USDC", { name: net.name }) },
    { ok: !mainnetUnlocked, text: t(mainnetUnlocked ? "Mainnet is unlocked (KESUNI_ALLOW_MAINNET=1)" : "Mainnet locked by code") },
    { ok: !a.hasPaymentTool, text: t(a.hasPaymentTool ? "A payment-like tool is in the Chief's tool list" : "The Chief has no payment tool") },
    { ok: true, text: t("Release or refund only after the customer decides") },
    { ok: true, text: t("Simulated orders never count as business") },
    { ok: false, text: t("Rupiah payments are not tracked in the app") },
  ];
  const sim = usage.excluded.simulatedOrders;
  const topups = usage.excluded.demoTopups;

  return (
    <>
      <Suspense fallback={<IntegrationFallback rows={rows} network={shownNet} t={t} />}>
        <IntegrationPanel rows={rows} network={shownNet} t={t} />
      </Suspense>
      <div className="ops-two">
        <section className="card">
          <h2>{t("Real usage")} <Info>{t(usage.rule)}</Info></h2>
          <dl className="kv-rows">
            <div><dt>{t("Real customers")}</dt><dd>{usage.realCustomers}</dd></div>
            <div><dt>{t("Real orders")}</dt><dd>{usage.realOrders}</dd></div>
            <div><dt>{t("Arc transfers on real orders")}</dt><dd>{usage.arcTxs.count}{usage.arcTxs.count > 0 && <span className="muted"> · {t("{n} verified", { n: usage.arcTxs.verifiedOnArc })}</span>}</dd></div>
            <div><dt>{t("Not counted")}</dt><dd className="muted">{t(sim === 1 ? "{n} simulated order" : "{n} simulated orders", { n: sim })} · {t(topups === 1 ? "{n} demo top-up" : "{n} demo top-ups", { n: topups })}</dd></div>
          </dl>
        </section>
        <section className="card">
          <h2>{t("Pilot limits")}</h2>
          <ul className="ops-checks">
            {limits.map((l) => (
              <li key={l.text}><span className={`ops-mark${l.ok ? " ok" : ""}`}>{l.ok ? <Tick /> : <Lock />}</span>{l.text}</li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function MoneyTab({ view, t }: { view: TagFilter; t: T }) {
  const net = network();
  const flow = loadMoneyFlow();
  const s = view === "simulated" ? flow.simulated : flow.real;
  const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return (
    <>
      <Filter base="/operations?tab=money" active={view === "simulated" ? "simulated" : "real"} t={t} items={[
        { id: "real", label: t("Real orders"), count: flow.real.orders },
        { id: "simulated", label: t("Simulated"), count: flow.simulated.orders },
      ]} />
      {view === "simulated" && (
        <p className="ops-note"><span className="badge simulated">{t("simulated")}</span> {t("Test orders only. These numbers are not real business.")}</p>
      )}
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label"><span>{t("Agreed price")} <Info>{t("Prices customers approved, in Rupiah, from the chosen quotes.")}</Info></span><Icon name="tag" /></span>
          <b>{rp(s.agreedIdr)}</b>
          <span className="muted">{t(s.orders === 1 ? "{agreed} of {n} order agreed" : "{agreed} of {n} orders agreed", { agreed: s.agreed, n: s.orders })}</span>
        </div>
        <div className="stat">
          <span className="stat-label"><span>{t("In escrow now")} <Info>{t("Funded escrows waiting for the customer to accept or reject.")}</Info></span><Icon name="shield" /></span>
          <b>{s.held.count}</b>
          <span className="muted">{usdc(s.held.micro, t)}</span>
        </div>
        <div className="stat">
          <span className="stat-label"><span>{t("Paid to Kesuni")} <Info>{t("Completed escrow releases after the customer accepted.")}</Info></span><Icon name="wallet" /></span>
          <b>{s.release.count}</b>
          <span className="muted">{usdc(s.release.micro, t)}</span>
        </div>
        <div className="stat">
          <span className="stat-label"><span>{t("Refunded")} <Info>{t("Completed refunds to the customer after a rejection.")}</Info></span><Icon name="arrow" /></span>
          <b>{s.refund.count}</b>
          <span className="muted">{usdc(s.refund.micro, t)}</span>
        </div>
      </div>
      <MoneyFlowPanel s={s} network={{ name: net.name, isTestnet: net.isTestnet }} t={t} />
    </>
  );
}

function AuditTab({ filter, all, now, t, locale }: { filter: TagFilter; all: boolean; now: Date; t: T; locale: Locale }) {
  const events = auditEvents({
    orders: store.listOrders(), log: allLog(), decisions: store.listAllDecisions(), tasks: store.listAllTasks(), escrows: store.listEscrows(),
  }, t);
  const count = (f: TagFilter) => events.filter((e) => matchesFilter(e.order.tag, f)).length;
  const shown = events.filter((e) => matchesFilter(e.order.tag, filter));
  const base = "/operations?tab=audit";
  return (
    <>
      <Filter base={base} active={filter} t={t} items={[
        { id: "all", label: t("All"), count: events.length },
        { id: "real", label: t("Real"), count: count("real") },
        { id: "simulated", label: t("Simulated"), count: count("simulated") },
      ]} />
      <AuditPanel events={all ? shown : shown.slice(0, AUDIT_SHOWN)} total={shown.length} now={now} t={t} locale={locale}
        empty={filter === "real" ? t("No activity on real orders yet. Test orders are under Simulated.") : undefined}
        more={!all && shown.length > AUDIT_SHOWN ? `${base}${filter === "all" ? "" : `&filter=${filter}`}&all=1` : undefined} />
    </>
  );
}

function HeartbeatTab({ now, t }: { now: Date; t: T }) {
  const hb = heartbeatStatus();
  const beats = chiefFeed(allLog(), store.listOrders(), Number.MAX_SAFE_INTEGER, t).filter((f) => f.kind === "heartbeat").slice(0, 6);
  const reviewHour = dailyReviewHour();
  const steps = [
    { title: t("Code checks every order and printer"), text: hb.enabled ? t("Free, every {every}.", { every: every(hb.intervalSeconds, t) }) : t("Timer off: only by button.") },
    { title: t("Code acts first"), text: t("Opens operator tasks, syncs payments, checks up to {n} transfers on Arc.", { n: ARC_CHECKS_PER_BEAT }) },
    {
      title: t("Wakes the Chief only for a new decision"),
      text: hb.mode === "claude" ? t("Claude, at most {n} wake-ups per hour.", { n: maxWakesPerHour() }) : t("Rules mode: only plan choices, no Claude."),
    },
    {
      title: t("Writes the daily review"),
      text: reviewHour === null ? t("Off by schedule; by button only.") : t("Once a day after {hour}:00 WIB.", { hour: String(reviewHour).padStart(2, "0") }),
    },
  ];
  return (
    <div className="ops-hb">
      <div className="ops-col">
        <HeartbeatCard initial={hb} />
        <section className="card">
          <h2>{t("Recent beats that found something")} <Info>{t("Only beats with a new problem are written to the log.")}</Info></h2>
          {beats.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t("No findings yet.")}</p> : (
            <ul className="ops-beats">
              {beats.map((b) => (
                <li key={b.id}>
                  <div className="ops-beat-top">
                    <b>{b.title}</b>{b.repeats > 1 && <span className="badge">×{b.repeats}</span>}
                    <span className="ops-beat-when">{ago(b.at, now, t)}</span>
                  </div>
                  <LineMore className="ops-line" line={b.line}>{b.text && <p>{b.text}</p>}</LineMore>
                  <div className="ops-event-meta">
                    {b.order.tag === "studio" ? <Link href="/machines">{t("Studio")}</Link> : b.order.tag === "removed" ? <span>{b.order.id}</span> : <Link href={`/orders/${b.order.id}`}>{b.order.id}</Link>}
                    {b.order.tag !== "real" && b.order.tag !== "studio" && <span className={`badge ${b.order.tag === "simulated" ? "simulated" : ""}`}>{t(b.order.tag === "removed" ? "order removed" : "simulated")}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="card">
        <h2>{t("How a beat works")}</h2>
        <ol className="ops-steps">
          {steps.map((s) => <li key={s.title}><b>{s.title}</b><span>{s.text}</span></li>)}
        </ol>
      </section>
    </div>
  );
}

/** Operations: the parts the system runs on, where the money goes, and everything that happened. */
export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string; all?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const locale = await getLocale();
  const tab = pickTab(TABS, sp.tab);
  const filter = pickFilter(sp.filter);
  const now = new Date();
  return (
    <main className="wrap">
      <PageHead eyebrow={t("Operations")} title={t("See the whole system.")} sub={t("Live parts, the money path and a full activity trail.")}
        actions={<>
          <Link className="btn-link ghost" href="/arc?tab=check">{t("Check a transaction")}</Link>
          <Link className="btn-link" href="/chief">{t("Chief (AI)")}</Link>
        </>} />
      <Tabs tabs={TABS.map((x) => ({ ...x, label: t(x.label) }))} active={tab} basePath="/operations" />
      {tab === "status" && <StatusTab now={now} t={t} locale={locale} />}
      {tab === "money" && <MoneyTab view={filter} t={t} />}
      {tab === "audit" && <AuditTab filter={filter} all={sp.all === "1"} now={now} t={t} locale={locale} />}
      {tab === "heartbeat" && <HeartbeatTab now={now} t={t} />}
    </main>
  );
}
