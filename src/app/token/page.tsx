import Link from "next/link";
import "./token.css";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Callout from "../components/Callout";
import Info from "../components/Info";
import Icon from "../components/Icon";
import { network } from "@/lib/network";
import { tokenReadiness, WHY, type Gate, type GateCheck, type GateStatus, type Readiness } from "@/lib/token-research";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import DesignModel from "./DesignModel";
import DistributionSim from "./DistributionSim";

export const dynamic = "force-dynamic";

const TABS: Tab[] = [
  { id: "gates", label: "Launch gates" },
  { id: "design", label: "Design & vesting" },
  { id: "market", label: "Market watcher" },
  { id: "distribution", label: "Distribution simulation" },
];

const TONE: Record<GateStatus, string> = { PASS: "ok", "NOT YET": "warn", BLOCKED: "bad", UNKNOWN: "" };

const fmt = (v: number | null, unit: GateCheck["unit"]) => (v === null ? "—" : `${v.toLocaleString("en")}${unit}`);

function GateCard({ g, t }: { g: Gate; t: T }) {
  return (
    <article className={`tok-gate ${g.status === "PASS" ? "pass" : g.status === "BLOCKED" ? "blocked" : ""}`}>
      <div className="tok-gate-top">
        <span className="tok-n">{g.n}{g.live && <span className="tok-live">{t("Live")}</span>}</span>
        <span className={`badge ${TONE[g.status]}`}>{t(g.status)}</span>
      </div>
      <h3>{g.title}{g.why && <Info><b>{t("Why:")}</b> {g.why}</Info>}</h3>
      <p>{g.line}</p>
      {g.checks && (
        <ul className="tok-checks">
          {g.checks.map((c) => (
            <li key={c.label} title={t("{label}: {value} of {target} needed", { label: c.label, value: fmt(c.value, c.unit), target: `${c.target}${c.unit}` })}>
              <b>{fmt(c.value, c.unit)}<small>/{c.target}{c.unit}</small></b>
              <span>{c.short}</span>
              <span className={`tok-meter${c.ok ? " ok" : ""}`} aria-hidden="true">
                <span style={{ width: `${c.value === null ? 0 : Math.min(100, (c.value / c.target) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <small>
        {g.live ? (
          <>
            {t("Live data · reviewer: {reviewer} · {period}", { reviewer: g.reviewer, period: g.period })}
            <Info>{t("Evidence: {evidence}. Real orders only.", { evidence: g.evidence })}</Info>
          </>
        ) : t("Evidence / reviewer / period: none yet")}
      </small>
    </article>
  );
}

function GatesTab({ r, t }: { r: Readiness; t: T }) {
  return (
    <>
      <div className="tok-bar">
        <span><b>{r.passed} / {r.total}</b> {t("gates with PASS evidence")}</span>
        <span className="tok-live">{t("{n} computed live from real orders", { n: r.gates.filter((g) => g.live).length })}</span>
      </div>
      <div className="tok-gates">
        {r.gates.map((g) => <GateCard key={g.id} g={g} t={t} />)}
      </div>
      <Callout icon="info" title={t("UNKNOWN is not PASS.")}>
        {t("Thresholds are an internal draft, not a regulator's rule. Simulated orders never count.")}
      </Callout>
    </>
  );
}

function DesignTab({ t }: { t: T }) {
  return (
    <>
      <DesignModel />
      <section className="card">
        <h2>{t("Rights stay separate")}</h2>
        <div className="tok-rights">
          <div><h3>{t("Reputation")}</h3><p>{t("A non-transferable record of work. No profit right.")}</p></div>
          <div><h3>{t("Utility")}</h3><p>{t("Only if a real service need is proven first.")}</p></div>
          <div><h3>{t("Profit right")}</h3><p>{t("A separate, legally classified instrument with a signed agreement.")}</p></div>
        </div>
      </section>
    </>
  );
}

function MarketTab({ netName, t }: { netName: string; t: T }) {
  return (
    <section className="card">
      <div className="tok-empty">
        <span className="tok-empty-icon"><Icon name="pulse" size={26} /></span>
        <h3>{t("No token exists, so there is nothing to watch.")}</h3>
        <p>{t("No price, volume, liquidity or venue.")}</p>
      </div>
      <dl className="tok-facts">
        <div><dt>{t("Market price")}</dt><dd>—</dd></div>
        <div><dt>{t("Verified holders")}</dt><dd>—</dd></div>
        <div><dt>{t("Venue / contract")}</dt><dd>—</dd></div>
      </dl>
      <div className="tok-market-go">
        <Link href="/arc?tab=transfers" className="btn-link ghost">
          <Icon name="network" size={16} />{t("Real escrow transfers on {net}", { net: netName })}
        </Link>
      </div>
    </section>
  );
}

/** Token research: launch gates from live data, plus local simulations. No token, sale, price or wallet connect. */
export default async function TokenPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const t = await getT();
  const tabs = TABS.map((x) => ({ ...x, label: t(x.label) }));
  const tab = pickTab(tabs, (await searchParams).tab);
  const net = network();
  const r = tokenReadiness(t);
  return (
    <main className="wrap">
      <PageHead
        eyebrow={t("Research & readiness")}
        title={t("Prove the value before issuing.")}
        sub={t("Research and simulation only. No token, sale or price exists.")}
        actions={
          <>
            <span className={`badge ${r.overall === "ISSUANCE BLOCKED" ? "bad" : "warn"}`}><Icon name="shield" size={13} />{t(r.overall)}</span>
            {net.isTestnet && <span className="badge testnet">{t("{net} only", { net: net.name })}</span>}
          </>
        }
      />

      <section className="tok-hero" aria-label={t("Research only")}>
        <div>
          <span className="tok-pill"><Icon name="flask" size={12} />{t("Research only")}</span>
          <h2>{t("Production first.")}<br />{t("Tokens only if needed.")}</h2>
          <p>
            {t("Open3DKesuni works without a token. Never offered in Indonesia")} <Info><b>{t("Why:")}</b> {t(WHY.indonesia)}</Info>
            <br />{t("No investment offering or promised returns.")}
          </p>
        </div>
        <span className="tok-hero-icon"><Icon name="flask" size={62} /></span>
      </section>

      <Tabs tabs={tabs} active={tab} basePath="/token" />
      {tab === "gates" && <GatesTab r={r} t={t} />}
      {tab === "design" && <DesignTab t={t} />}
      {tab === "market" && <MarketTab netName={net.name} t={t} />}
      {tab === "distribution" && <DistributionSim />}
    </main>
  );
}
