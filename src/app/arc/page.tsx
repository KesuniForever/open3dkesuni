import Link from "next/link";
import { getOrder, getVendor, listEscrows } from "@/lib/store";
import { microToUsdc } from "@/lib/policy";
import { explorerTxBase, network } from "@/lib/network";
import { arcConfig } from "@/lib/arc-verify";
import {
  ROLE_LABEL, explorerAddressBase, explorerHome, isRealAddress, knownWallets, orderTag, rpcHost, shortAddress, transferCounts, transferRows,
  type OrderTag, type WalletRole,
} from "@/lib/arc-page";
import type { ChainTx } from "@/lib/types";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Callout from "../components/Callout";
import Info from "../components/Info";
import Icon, { type IconName } from "../components/Icon";
import ConnectionCards from "./ConnectionCards";
import { ArcCheckForm, RecheckButton, type Sample } from "./ArcCheck";
import { getLocale, getT } from "@/i18n/server";
import { dateLocale, type T } from "@/i18n/core";
import "./arc.css";

export const dynamic = "force-dynamic";

const KIND: Record<ChainTx["kind"], string> = {
  customer_topup: "Test top-up (internal)", deposit: "Customer deposit", release: "Release to shop", refund: "Refund to customer",
};
const ROLE_ICON: Record<WalletRole, IconName> = {
  kesuni_payout: "wallet", demo_funds: "flask", escrow: "shield", customer: "tag", shop_payout: "wallet",
};
const time = (iso: string, locale = "en-GB") =>
  `${new Date(iso).toLocaleString(locale, { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WIB`;
/** Transfer kinds as one word, for the check form's "Fill from" chips. */
const KIND_WORD: Record<ChainTx["kind"], string> = { customer_topup: "top-up", deposit: "deposit", release: "release", refund: "refund" };
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const RULE = "Circle reports a transfer as complete; this asks Arc itself. Verified: the receipt succeeded, its block is canonical, and it holds exactly one USDC Transfer with the same sender, recipient and amount (6 decimals). Read-only: nothing is sent and no escrow changes.";

/** Order id, linked unless the order was removed, with a badge when it is not real business. */
function OrderRef({ id, tag, t }: { id: string; tag?: OrderTag; t: T }) {
  return (
    <>
      {tag === "removed" ? <span>{id}</span> : <Link href={`/orders/${id}`}>{id}</Link>}
      {tag && tag !== "real" && <> <span className={`badge ${tag === "simulated" ? "simulated" : ""}`}>{t(tag === "removed" ? "order removed" : "simulated")}</span></>}
    </>
  );
}

/** Circle & Arc: read-only network status, a transfer check, every escrow transfer and every wallet the app knows. */
export default async function ArcPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getT();
  const locale = await getLocale();
  const at = (iso: string) => time(iso, dateLocale(locale));
  const net = network();
  const cfg = arcConfig();
  const escrows = listEscrows();
  const rows = transferRows(escrows, getOrder);
  const counts = transferCounts(rows);
  const current = { blockchain: net.blockchain, label: net.label };
  const own = getVendor("own")?.address;
  const payoutAddress = isRealAddress(own) ? own : undefined;
  const wallets = knownWallets(escrows, { payoutAddress, network: current, orderOf: getOrder });
  const addressUrl = (blockchain: string, address: string) => {
    const base = explorerAddressBase(explorerTxBase(blockchain));
    return base ? `${base}${address}` : null;
  };
  const explorer = explorerHome(net.explorerTxBase);

  const tabs: Tab[] = [
    { id: "connection", label: t("Connection") },
    { id: "check", label: t("Check a transaction") },
    { id: "transfers", label: t("Escrow transfers"), count: counts.transfers },
    { id: "wallets", label: t("Wallets"), count: wallets.length },
  ];
  const tab = pickTab(tabs, (await searchParams).tab);

  // The newest stored transfers with a hash, to fill the check form (real data only).
  const samples: Sample[] = rows
    .filter((r) => r.tx.txHash && r.tx.state === "COMPLETE")
    .slice(-4)
    .reverse()
    .map((r) => ({
      label: `${r.escrow.orderId} · ${t(KIND_WORD[r.tx.kind])}`,
      txHash: r.tx.txHash as string, from: r.tx.from, to: r.tx.to, amountUsdc: microToUsdc(r.tx.amountMicro),
    }));

  return (
    <main className="wrap">
      <PageHead
        eyebrow={net.isTestnet ? t("Testnet workspace") : "Circle & Arc"}
        title={t("Every transfer, checked on Arc.")}
        sub={<>{t("{net} and Circle, read-only.", { net: net.name })}{net.isTestnet && ` ${t("Test USDC, not real money.")}`}</>}
        actions={<>
          {explorer && <a className="btn-link ghost" href={explorer} target="_blank" rel="noreferrer">{t("Explorer")} <Icon name="arrow" size={15} /></a>}
          <Link className="btn-link" href="/arc?tab=check" scroll={false}><Icon name="receipt" size={16} />{t("Check a transaction")}</Link>
        </>}
      />
      <Callout icon="shield" title={t("Read the network, never send from here")}
        aside={<span className="badge testnet">{net.name}{net.isTestnet ? ` · ${t("test USDC")}` : ""}</span>}>
        {t("Nothing on this page signs or moves funds.")}
      </Callout>
      {!cfg.ok && <div className="alert bad arc-alert">{t(cfg.reason)}</div>}
      <Tabs tabs={tabs} active={tab} basePath="/arc" />

      {tab === "connection" && (
        <ConnectionCards
          netName={net.name}
          isTestnet={net.isTestnet}
          rpc={cfg.ok ? { chainId: cfg.chainId, host: rpcHost(cfg.rpcUrl), custom: cfg.custom } : null}
          explorer={explorer}
          payout={payoutAddress ? { short: shortAddress(payoutAddress), url: addressUrl(net.blockchain, payoutAddress) } : null}
          escrowWallets={escrows.length}
          customerWallets={new Set(escrows.map((e) => e.customerAddress.toLowerCase())).size}
        />
      )}

      {tab === "check" && (
        <section className="arc-card arc-check">
          <div className="arc-top">
            <span className="arc-mark green"><Icon name="receipt" size={24} /></span>
            <span className="badge testnet">{net.isTestnet ? "Testnet" : net.name} · {t("read only")}</span>
          </div>
          <h2>{t("Match a transfer with its receipt")} <Info>{t(RULE)}</Info></h2>
          <p className="arc-line">{t("Hash, sender, recipient and amount. Nothing is saved or sent.")}</p>
          <ArcCheckForm samples={samples} />
        </section>
      )}

      {tab === "transfers" && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-label">
                <span>
                  {t("Transfers")}{" "}
                  <Info>{t("Customer deposits, releases and refunds of every escrow. Simulated orders are test runs, not business; transfers of removed orders count as simulated. Test top-ups from the demo-funds wallet are internal: listed, not counted ({n}).", { n: counts.internal })}</Info>
                </span>
                <Icon name="receipt" />
              </span>
              <b>{counts.transfers}</b>
              <span className="muted">{t("{real} real · {simulated} simulated", { real: counts.onReal, simulated: counts.onSimulated })}</span>
            </div>
            <div className="stat">
              <span className="stat-label"><span>{t("Verified on Arc")} <Info>{t(RULE)}</Info></span><Icon name="check" /></span>
              <b className="arc-ok">{counts.verified}</b>
              <span className="muted">{t("of {n}", { n: counts.transfers })}</span>
            </div>
            <div className="stat">
              <span className="stat-label">
                <span>{t("Mismatch")} <Info>{t("Arc does not show the transfer Circle reported. A task is opened; the escrow is never changed.")}</Info></span>
                <Icon name="info" />
              </span>
              <b className={counts.mismatch ? "arc-bad" : undefined}>{counts.mismatch}</b>
              <span className="muted">{counts.mismatch ? t("needs a look") : t("none")}</span>
            </div>
            <div className="stat">
              <span className="stat-label">
                <span>{t("Not checked yet")} <Info>{t("Complete transfers waiting for a check. The heartbeat checks up to 5 new transfers per beat.")}</Info></span>
                <Icon name="pulse" />
              </span>
              <b>{counts.unchecked}</b>
              <span className="muted">{counts.unchecked ? t("next heartbeat") : t("all checked")}</span>
            </div>
          </div>

          <section className="card">
            <h2>
              {t("Escrow transfers")}
              <span className="badge testnet">{net.name}</span>
              {counts.mismatch > 0 && <span className="badge bad">{t("{n} mismatch", { n: counts.mismatch })}</span>}
            </h2>
            {rows.length === 0 && <p className="muted arc-empty">{t("No escrow transfers yet.")}</p>}
            {rows.length > 0 && (
              <div className="table-wrap">
                <table className="arc-table">
                  <thead>
                    <tr>
                      <th>{t("Order")}</th><th>{t("Transfer")}</th><th>USDC</th><th>Circle</th><th>Arc</th>
                      <th><span className="arc-sr">{t("Action")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ escrow, order, tx }) => (
                      <tr key={tx.idempotencyKey}>
                        <td className="arc-c-order">
                          <OrderRef id={escrow.orderId} tag={orderTag(order)} t={t} />
                          {order && <span className="arc-sub arc-clip" title={order.product}>{order.product}</span>}
                        </td>
                        <td className="arc-c-kind">
                          {t(KIND[tx.kind])}
                          <span className="arc-sub">
                            {at(tx.at)}
                            {tx.txHash && <> · <a className="mono" href={`${explorerTxBase(escrow.network)}${tx.txHash}`} target="_blank" rel="noreferrer">{shortHash(tx.txHash)}</a></>}
                          </span>
                        </td>
                        <td className="arc-num arc-c-amt">{microToUsdc(tx.amountMicro)}</td>
                        <td className="arc-c-circle"><span className={`badge ${tx.state === "COMPLETE" ? "ok" : ""}`}>{t(tx.state.toLowerCase())}</span></td>
                        <td className="arc-c-arc">
                          {tx.verified?.ok === true && <span className="badge ok" title={tx.verified.logId}>{t("verified on Arc")}</span>}
                          {tx.verified?.ok === false && <><span className="badge bad">{t("mismatch")}</span><span className="arc-sub">{t(tx.verified.reason ?? "")}</span></>}
                          {!tx.verified && <span className="arc-sub">{tx.state === "COMPLETE" && tx.txHash ? t("not checked yet") : "—"}</span>}
                          {tx.verified && <span className="arc-sub">{at(tx.verified.at)}</span>}
                        </td>
                        <td className="arc-c-act">
                          {tx.state === "COMPLETE" && tx.txHash && escrow.network === net.blockchain && (
                            <RecheckButton orderId={escrow.orderId} idempotencyKey={tx.idempotencyKey} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === "wallets" && (
        <section className="card">
          <h2>
            {t("Wallets")} <span className="badge">{wallets.length}</span>
            {net.isTestnet ? <span className="badge testnet">{t("test USDC")}</span> : <span className="badge warn">mainnet</span>}
            <Info>
              {t("Every address the app knows from its escrows, plus Kesuni's payout address.")}{" "}
              {net.isTestnet ? t("{net}: test USDC, not real money.", { net: net.name }) : ""}
            </Info>
          </h2>
          {wallets.length === 0 && <p className="muted arc-empty">{t("No wallets yet.")}</p>}
          <div className="arc-wallets">
            {wallets.map((w) => {
              const url = addressUrl(w.network, w.address);
              return (
                <div key={w.address.toLowerCase()} className="arc-wallet">
                  <span className={`arc-wallet-icon ${w.role}`}><Icon name={ROLE_ICON[w.role]} /></span>
                  <div className="arc-wallet-main">
                    <b>
                      {t(ROLE_LABEL[w.role])}
                      {w.roles.slice(1).filter((r) => !(w.role === "kesuni_payout" && r === "shop_payout")).map((r) => (
                        <span key={r} className="arc-also"> · {t(ROLE_LABEL[r].toLowerCase())}</span>
                      ))}
                    </b>
                    {url
                      ? <a className="mono arc-addr" href={url} target="_blank" rel="noreferrer" title={w.address}>{shortAddress(w.address)} <Icon name="arrow" size={13} /></a>
                      : <span className="mono arc-addr" title={w.address}>{shortAddress(w.address)}</span>}
                  </div>
                  <div className="arc-wallet-meta">
                    {w.orders.map((o) => (
                      <span key={o.id} className="arc-order"><OrderRef id={o.id} tag={o.tag} t={t} /></span>
                    ))}
                    {w.escrowState && <span>{t(w.escrowState.toLowerCase().replace("_", " "))}</span>}
                    <span>
                      {t(w.transfers === 1 ? "{n} transfer" : "{n} transfers", { n: w.transfers })}
                      {w.lastAt && ` · ${t("last {time}", { time: at(w.lastAt) })}`}
                    </span>
                  </div>
                  {w.label !== net.label && (w.label === "mainnet"
                    ? <span className="badge warn">mainnet</span>
                    : <span className="badge testnet">{t("test USDC")}</span>)}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
