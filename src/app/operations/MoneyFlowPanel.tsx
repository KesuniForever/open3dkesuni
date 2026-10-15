import Icon, { type IconName } from "../components/Icon";
import Info from "../components/Info";
import { microToUsdc } from "@/lib/policy";
import type { Amount, FlowSet, FlowStep } from "@/lib/ops";
import { makeT, type T } from "@/i18n/core";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const EN: T = makeT("en", {});

/** "0.1 test USDC", plus real USDC when a mainnet escrow exists. Each escrow keeps its own network. */
export function usdc(a: Amount, t: T = EN): string {
  const test = t("{amount} test USDC", { amount: microToUsdc(a.testnet) });
  return a.mainnet > 0 ? `${a.testnet > 0 ? `${test} + ` : ""}${microToUsdc(a.mainnet)} USDC` : test;
}

function Node({ icon, name, sub, strong }: { icon: IconName; name: string; sub: string; strong?: boolean }) {
  return (
    <div className={`ops-node-box${strong ? " strong" : ""}`}>
      <span className="ops-node-icon"><Icon name={icon} size={18} /></span>
      <b>{name}</b>
      <span>{sub}</span>
    </div>
  );
}

function Edge({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div className={`ops-edge${tone ? ` ${tone}` : ""}`}>
      <span className="ops-edge-label">{label}</span>
      <span className="ops-edge-line" aria-hidden="true" />
      <span className="ops-edge-value"><b>{value}</b>{sub && <small>{sub}</small>}</span>
    </div>
  );
}

/** The money path as a picture: the Rupiah price between customer and Kesuni, then test USDC through the escrow. */
export default function MoneyFlowPanel({ s, network, t }: { s: FlowSet; network: { name: string; isTestnet: boolean }; t: T }) {
  const step = (x: FlowStep) => ({ value: String(x.count), sub: usdc(x.micro, t) });
  return (
    <section className="card ops-flow">
      <h2>{t("Money path")}</h2>

      <p className="ops-lane-head">
        {t("Rupiah · the price")}
        <Info>{t("Goods in Indonesia are paid in Rupiah. The app records the price the customer agreed; the Rupiah payment itself is not recorded here.")}</Info>
      </p>
      <div className="ops-lane">
        <Node icon="orders" name={t("Customer")} sub={t("agrees the price")} />
        <Edge label={t("Pays in Rupiah")} value={rp(s.agreedIdr)}
          sub={t(s.orders === 1 ? "agreed · {agreed} of {n} order" : "agreed · {agreed} of {n} orders", { agreed: s.agreed, n: s.orders })} />
        <Node icon="layers" name="Kesuni" sub={t("the studio")} />
      </div>

      <p className="ops-lane-head">
        {t(network.isTestnet ? "Test USDC" : "USDC")} · {t("{name} escrow", { name: network.name })}
        <Info>{t("Circle wallets on Arc. On testnet, Kesuni's demo-funds wallet tops up the customer's wallet with test USDC. The escrow pays out only after the customer accepts, or refunds after a rejection.")}</Info>
      </p>
      <div className="ops-lane">
        <Node icon="wallet" name={t("Demo funds")} sub={t("Kesuni test wallet")} />
        <Edge label={t("Top-up")} {...step(s.topup)} />
        <Node icon="wallet" name={t("Customer wallet")} sub={t("one per order")} />
        <Edge label={t("Deposit")} {...step(s.deposit)} />
        <Node icon="shield" name={t("Escrow")} sub={t("{n} holding now", { n: s.held.count })} strong />
        <div className="ops-split">
          <div className="ops-branch">
            <Edge label={t("Accepted · release")} {...step(s.release)} />
            <Node icon="check" name={t("Kesuni wallet")} sub={t("paid out")} />
          </div>
          <div className="ops-branch">
            <Edge label={t("Rejected · refund")} {...step(s.refund)} tone="bad" />
            <Node icon="arrow" name={t("Customer")} sub={t("refunded")} />
          </div>
        </div>
      </div>

      <p className="status-line ops-flow-foot">
        <span><b>{s.escrows}</b> {t(s.escrows === 1 ? "escrow" : "escrows")}</span>
        <span><b>{s.awaiting}</b> {t("waiting for a deposit")}</span>
        <span><b>{s.pending}</b> {t(s.pending === 1 ? "transfer in progress" : "transfers in progress")}</span>
        {s.failed > 0 && <span className="bad-text"><b>{s.failed}</b> {t("failed")}</span>}
      </p>
    </section>
  );
}
