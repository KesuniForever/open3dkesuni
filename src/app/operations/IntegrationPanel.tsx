import Callout from "../components/Callout";
import Icon from "../components/Icon";
import { chainHealth } from "@/lib/chain-health";
import { chainRows, type IntegrationRow } from "@/lib/ops";
import type { T } from "@/i18n/core";

const TONE: Record<IntegrationRow["status"], string> = { ok: "ok", warn: "warn", bad: "bad", neutral: "" };

export function IntegrationList({ rows }: { rows: IntegrationRow[] }) {
  return (
    <div className="ops-list">
      {rows.map((r) => (
        <div key={r.id} className="ops-row">
          <span className={`ops-icon ${r.status}`}><Icon name={r.icon} size={19} /></span>
          <div className="ops-row-body">
            <strong>{r.name}</strong>
            <p>{r.line}</p>
          </div>
          <span className={`badge ${TONE[r.status]}`}>{r.chip}</span>
        </div>
      ))}
    </div>
  );
}

function Summary({ rows, network, t }: { rows: IntegrationRow[]; network: { name: string; isTestnet: boolean }; t: T }) {
  const ok = rows.filter((r) => r.status === "ok" || r.status === "neutral").length;
  const bad = rows.some((r) => r.status === "bad");
  return (
    <Callout tone={bad ? "amber" : ok === rows.length ? "green" : "blue"} icon="pulse"
      title={t("{ok} of {total} parts running", { ok, total: rows.length })}
      aside={<span className={`badge ${network.isTestnet ? "testnet" : "warn"}`}>{network.name} · {t(network.isTestnet ? "test USDC" : "real USDC")}</span>}>
      {t("Checked live on this server. No keys or secrets are shown.")}
    </Callout>
  );
}

/** Arc and Circle need a network call (cached 60 s, read-only): this part streams in after the rest of the page. */
export default async function IntegrationPanel({ rows, network, t }: { rows: IntegrationRow[]; network: { name: string; isTestnet: boolean }; t: T }) {
  const h = await chainHealth();
  const all = [...chainRows(h, t), ...rows];
  return (
    <>
      <Summary rows={all} network={network} t={t} />
      <section className="card ops-list-card"><IntegrationList rows={all} /></section>
    </>
  );
}

/** While Arc and Circle are checked: the local rows right away, the two network rows as "checking". */
export function IntegrationFallback({ rows, network, t }: { rows: IntegrationRow[]; network: { name: string; isTestnet: boolean }; t: T }) {
  const pending: IntegrationRow[] = [
    { id: "arc", icon: "chain", name: "Arc RPC", line: t("Checking {name}…", { name: network.name }), status: "neutral", chip: t("checking") },
    { id: "circle", icon: "wallet", name: t("Circle wallets"), line: t("Checking the wallet set…"), status: "neutral", chip: t("checking") },
  ];
  return (
    <>
      <Callout tone="blue" icon="pulse" title={t("Checking the network…")}>{t("Arc and Circle answer in a few seconds.")}</Callout>
      <section className="card ops-list-card"><IntegrationList rows={[...pending, ...rows]} /></section>
    </>
  );
}
