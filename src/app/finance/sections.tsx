import type { ReactNode } from "react";
import Link from "next/link";
import Info from "../components/Info";
import Icon, { type IconName } from "../components/Icon";
import WeightCalculator from "../components/WeightCalculator";
import { microToIdr } from "@/lib/costing";
import type { PricingConfig } from "@/lib/pricing";
import type { OwnerRules } from "@/lib/owner-rules";
import {
  ACCOUNTS, rp, usdc, wib, type Account, type Bucket, type Finance, type JournalEntry, type OrderPosition, type TransferRow,
} from "@/lib/finance";
import type { ChainTxState, EscrowState } from "@/lib/types";
import { getLocale, getT } from "@/i18n/server";
import type { T } from "@/i18n/core";

const ESCROW: Record<EscrowState, { text: string; tone: string }> = {
  AWAITING_DEPOSIT: { text: "awaiting deposit", tone: "warn" },
  FUNDED: { text: "funded", tone: "testnet" },
  RELEASED: { text: "released", tone: "ok" },
  REFUNDED: { text: "refunded", tone: "" },
};
const KIND: Record<TransferRow["kind"], string> = {
  customer_topup: "Test top-up", deposit: "Customer deposit", release: "Release to Kesuni", refund: "Refund to customer",
};
const ENTRY: Record<JournalEntry["kind"], string> = {
  deposit: "Deposit locked in escrow", release: "Released after acceptance", refund: "Refunded after rejection",
};
const BAD_STATES: ChainTxState[] = ["FAILED", "DENIED", "CANCELLED"];
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const unit = (testMoney: boolean) => (testMoney ? "test USDC" : "USDC");

function LabelBadge({ t, bucket }: { t: T; bucket: Bucket }) {
  return bucket === "simulated" ? <span className="badge simulated">{t("simulated")}</span> : <span className="badge real">{t("real")}</span>;
}

function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="fin-empty">
      <span className="attention-icon green"><Icon name={icon} /></span>
      <b>{title}</b>
      {children && <span>{children}</span>}
    </div>
  );
}

function TxLink({ t, url, hash }: { t: T; url?: string; hash?: string }) {
  if (!url || !hash) return null;
  return (
    <a className="fin-hash" href={url} target="_blank" rel="noreferrer" aria-label={t("Open transaction {hash} in the explorer", { hash })}>
      {short(hash)}<Icon name="arrow" size={12} />
    </a>
  );
}

// ---------- Orders ----------

function PaidOut({ t, p }: { t: T; p: OrderPosition }) {
  if (p.releasedMicro) return <div><span className="fin-amt">{usdc(p.releasedMicro)}</span><span className="fin-sub">{t("released")}</span></div>;
  if (p.refundedMicro) return <div><span className="fin-amt">{usdc(p.refundedMicro)}</span><span className="fin-sub">{t("refunded")}</span></div>;
  return <span className="fin-dash">—</span>;
}

export async function OrdersTab({ f }: { f: Finance }) {
  const t = await getT();
  const rows = f.positions;
  return (
    <section className="card">
      <h2>
        {t("Position of each order")}
        <Info>{t("Agreed price in rupiah (what the customer pays Kesuni), and the same price as USDC in the order's escrow on Arc (test USDC on Arc Testnet). ≈ = converted at the display rate. Margin = price minus cost and fees (actual cost once reported).")}</Info>
      </h2>
      {rows.length === 0 ? (
        <Empty icon="orders" title={t("No orders yet")} />
      ) : (
        <div className="table-wrap">
          <table className="fin-table fin-stack">
            <thead>
              <tr>
                <th>{t("Order")}</th><th>{t("Agreed price")}</th><th>{t("Escrow")}</th>
                <th className="fin-num">{t("Deposited")}</th><th className="fin-num">{t("Released / refunded")}</th><th className="fin-num">{t("Margin")}</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.orderId} className={p.bucket === "simulated" ? "fin-simrow" : undefined}>
                  <td className="fin-main">
                    <Link href={`/orders/${p.orderId}`} className="fin-order"><b className="one-line">{p.product}</b></Link>
                    <span className="fin-sub">{p.orderId}{p.customerName ? ` · ${p.customerName}` : ""} <LabelBadge t={t} bucket={p.bucket} /></span>
                  </td>
                  <td data-label={t("Agreed price")}>
                    {p.price ? (
                      <div>
                        <span className="fin-amt">{p.price.idrExact ? "" : "≈"}{rp(p.price.idr)}</span>
                        <span className="fin-sub">{usdc(p.price.micro)} {t(unit(p.testMoney))} · {p.price.basis === "agreement" ? t("customer agreed") : t("quote chosen")}</span>
                      </div>
                    ) : <span className="fin-dash">{t("No price yet")}</span>}
                  </td>
                  <td data-label={t("Escrow")}>
                    {p.escrow ? (
                      <div>
                        <span className={`badge ${ESCROW[p.escrow.state].tone}`}>{t(ESCROW[p.escrow.state].text)}</span>
                        {p.pending > 0 && <span className="fin-sub">{t(p.pending === 1 ? "{n} transfer pending" : "{n} transfers pending", { n: p.pending })}</span>}
                      </div>
                    ) : <span className="fin-dash">{t("No escrow")}</span>}
                  </td>
                  <td data-label={t("Deposited")} className="fin-num">
                    {p.awaitingMicro > 0 ? (
                      <div><span className="fin-amt">0</span><span className="fin-sub">{t("of {amount}", { amount: usdc(p.awaitingMicro) })}</span></div>
                    ) : p.depositedMicro > 0 ? <span className="fin-amt">{usdc(p.depositedMicro)}</span> : <span className="fin-dash">—</span>}
                  </td>
                  <td data-label={t("Released / refunded")} className="fin-num"><PaidOut t={t} p={p} /></td>
                  <td data-label={t("Margin")} className="fin-num">
                    {p.margin ? <div><span className="fin-amt">{rp(p.margin.idr)}</span><span className="fin-sub">{t(p.margin.source)}</span></div> : <span className="fin-dash">—</span>}
                  </td>
                  <td className="fin-go">
                    <Link href={`/orders/${p.orderId}`} aria-label={t("Open order {id}", { id: p.orderId })}><Icon name="chevron" size={15} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Arc transfers ----------

/** One status: Circle's state until it is COMPLETE, then what Arc itself says about the transfer. */
function TxStatus({ t, tx }: { t: T; tx: TransferRow }) {
  if (tx.state !== "COMPLETE") {
    return <span className={`badge ${BAD_STATES.includes(tx.state) ? "bad" : "warn"}`}>{t(tx.state.toLowerCase().replace("_", " "))}</span>;
  }
  if (tx.verified === true) return <span className="badge ok">{t("verified on Arc")}</span>;
  if (tx.verified === false) return <div><span className="badge bad">{t("Arc mismatch")}</span>{tx.verifyReason && <span className="fin-sub">{t(tx.verifyReason)}</span>}</div>;
  return <span className="badge">{t("complete · not checked")}</span>;
}

export async function TransfersTab({ f }: { f: Finance }) {
  const t = await getT();
  const locale = await getLocale();
  const rows = f.transfers;
  const money = rows.filter((x) => !x.internal);
  const verified = money.filter((x) => x.verified === true).length;
  const mismatch = money.filter((x) => x.verified === false).length;
  return (
    <section className="card">
      <h2>
        {t("Arc transfers")}
        {money.length > 0 && <span className="badge ok">{t("{n} of {total} verified", { n: verified, total: money.length })}</span>}
        {mismatch > 0 && <span className="badge bad">{t("{n} mismatch", { n: mismatch })}</span>}
        <Info>{t("Every escrow transfer Circle made on Arc. \"Verified on Arc\" = Arc itself shows the same USDC transfer. Test top-ups are internal moves from Kesuni's demo-funds wallet, not customer payments.")}</Info>
      </h2>
      {rows.length === 0 ? (
        <Empty icon="chain" title={t("No Arc transfers yet")}>{t("They appear here when a customer deposits into an escrow.")}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="fin-table fin-stack">
            <thead>
              <tr><th>{t("Transfer")}</th><th>{t("Order")}</th><th className="fin-num">{t("Amount")}</th><th>{t("Status")}</th></tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.key} className={x.bucket === "simulated" || x.internal ? "fin-simrow" : undefined}>
                  <td className="fin-main">
                    <b>{t(KIND[x.kind])}</b>{x.internal && <span className="badge" style={{ marginLeft: 6 }}>{t("internal")}</span>}
                    <span className="fin-sub">{wib(x.at, locale)}{x.txHash && <> · <TxLink t={t} url={x.explorerUrl} hash={x.txHash} /></>}</span>
                  </td>
                  <td data-label={t("Order")}>
                    <div>
                      <Link href={`/orders/${x.orderId}`}>{x.orderId}</Link> <LabelBadge t={t} bucket={x.bucket} />
                    </div>
                  </td>
                  <td data-label={t("Amount")} className="fin-num">
                    <div><span className="fin-amt">{usdc(x.amountMicro)}</span><span className="fin-sub">{t(unit(x.testMoney))} · ≈{rp(microToIdr(x.amountMicro))}</span></div>
                  </td>
                  <td data-label={t("Status")}><TxStatus t={t} tx={x} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Journal ----------

const ORDERED: Account[] = ["escrow_held", "customer_funds", "kesuni_wallet", "revenue"];

export async function JournalTab({ f }: { f: Finance }) {
  const t = await getT();
  const locale = await getLocale();
  const { entries, balances, balanced } = f.ledger;
  return (
    <section className="card">
      <h2>
        {t("Journal")}
        <span className={`badge ${balanced ? "ok" : "bad"}`}><Icon name="check" size={12} />{balanced ? t("Debit = Credit") : t("Not balanced")}</span>
        <Info>{t("Double entry from completed escrow transfers. Deposit: escrow holds the customer's funds. Release: the funds move to Kesuni and become revenue. Refund: the funds go back. Test top-ups are not booked.")}</Info>
      </h2>
      <div className="fin-accounts">
        {ORDERED.map((a) => (
          <div key={a} className="fin-account">
            <span className="fin-account-name">{t(ACCOUNTS[a].name)}<Info>{t(ACCOUNTS[a].note)}</Info><span className="fin-account-side">{t(ACCOUNTS[a].side)}</span></span>
            <b>{usdc(balances.testnet[a])}<small>{t("test USDC")}</small></b>
            {balances.mainnet[a] > 0 && <span className="fin-stat-sub"><b>{usdc(balances.mainnet[a])} USDC</b> {t("real money on Arc")}</span>}
            <span className="fin-sim"><span className="badge simulated">{t("simulated")}</span>{usdc(balances.simulated[a])} {t("test USDC")}</span>
            {balances.simulatedMainnet[a] !== 0 && <span className="fin-sim"><span className="badge simulated">{t("simulated")}</span>{usdc(balances.simulatedMainnet[a])} {t("USDC on mainnet")}</span>}
          </div>
        ))}
      </div>
      {entries.length === 0 ? (
        <Empty icon="receipt" title={t("No journal entries yet")}>{t("Completed deposits, releases and refunds are booked here.")}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="fin-table fin-journal">
            <thead>
              <tr><th>{t("Account")}</th><th className="fin-num">{t("Debit")}</th><th className="fin-num">{t("Credit")}</th></tr>
            </thead>
            {entries.map((e) => {
              const amount = e.lines[0].debitMicro;
              return (
                <tbody key={e.id} className="fin-entry">
                  <tr className="fin-entry-head">
                    <td colSpan={3}>
                      <span className="fin-entry-line">
                        <b>{t(ENTRY[e.kind])}</b>
                        <Link href={`/orders/${e.orderId}`}>{e.orderId}</Link>
                        <LabelBadge t={t} bucket={e.bucket} />
                        {e.verified === false && <span className="badge bad">{t("Arc mismatch")}</span>}
                        <span className="fin-time">{wib(e.at, locale)} · {usdc(amount)} {t(unit(e.testMoney))} ≈{rp(microToIdr(amount))}</span>
                        <span className="fin-push"><TxLink t={t} url={e.explorerUrl} hash={e.txHash} /></span>
                      </span>
                    </td>
                  </tr>
                  {e.lines.map((l, i) => (
                    <tr key={i}>
                      <td className={l.creditMicro ? "fin-cr" : undefined}>{t(ACCOUNTS[l.account].name)}</td>
                      <td className="fin-num">{l.debitMicro ? usdc(l.debitMicro) : ""}</td>
                      <td className="fin-num">{l.creditMicro ? usdc(l.creditMicro) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Pricing ----------

export async function PricingTab({ cfg, rules, idrPerUsdc, network }: { cfg: PricingConfig; rules: OwnerRules; idrPerUsdc: number; network: string }) {
  const t = await getT();
  const margin = cfg.pricePerGramIdr > 0 ? Math.round((1 - cfg.costPerGramIdr / cfg.pricePerGramIdr) * 100) : 0;
  return (
    <>
      <div className="tile-grid">
        <div className="tile">
          <div className="tile-head">
            <div><div className="eyebrow fin-tile-eyebrow">{t("Official price")}</div><div className="fin-rule">{rp(cfg.pricePerGramIdr)}<small>{t("per gram")}</small></div></div>
            <span className="tile-icon"><Icon name="tag" /></span>
          </div>
          <dl className="kv-rows">
            <div><dt>{t("Cost")}</dt><dd>{t("{amount} per gram", { amount: rp(cfg.costPerGramIdr) })}</dd></div>
            <div><dt>{t("Margin")}</dt><dd>{margin}%</dd></div>
            <div><dt>{t("Price per piece")}</dt><dd>{t("rounded up to {amount}", { amount: rp(cfg.roundIdr) })}</dd></div>
            <div><dt>{t("Grams from")}</dt><dd>{t("the slicer (Bambu Studio)")}</dd></div>
          </dl>
        </div>
        <div className="tile">
          <div className="tile-head">
            <div><div className="eyebrow fin-tile-eyebrow">{t("Owner's limits")}</div><div className="fin-rule">{rp(rules.minOrderIdr)}<small>{t("smallest order")}</small></div></div>
            <span className="tile-icon"><Icon name="shield" /></span>
          </div>
          <dl className="kv-rows">
            <div><dt>{t("Below the smallest order")}</dt><dd>{t("owner approves")}</dd></div>
            <div><dt>{t("Owner approves above")}</dt><dd>{rp(rules.approvalAboveIdr)}</dd></div>
            <div><dt>{t("Partner printing from")}</dt><dd>{rp(rules.partnerMinIdr)}</dd></div>
            <div><dt>{t("Lowest margin for the Chief")}</dt><dd>{rules.minMarginPct}%</dd></div>
          </dl>
        </div>
        <div className="tile">
          <div className="tile-head">
            <div><div className="eyebrow fin-tile-eyebrow">{t("Rupiah and USDC")}</div><div className="fin-rule">{rp(idrPerUsdc)}<small>{t("per USDC")}</small></div></div>
            <span className="tile-icon"><Icon name="wallet" /></span>
          </div>
          <dl className="kv-rows">
            <div><dt>{t("Customers pay")}</dt><dd>{t("rupiah, outside the app")}</dd></div>
            <div><dt>{t("Escrow locks")}</dt><dd>{t("the same price in USDC")}</dd></div>
            <div><dt>{t("Network")}</dt><dd>{network}</dd></div>
            <div><dt>{t("Rate used for")}</dt><dd>{t("display only")} <Info>{t("Converts USDC amounts to ≈ rupiah on these pages. Prices are set in rupiah.")}</Info></dd></div>
          </dl>
        </div>
      </div>
      <div className="fin-pricing">
        <WeightCalculator pricing={cfg} />
        <section className="card fin-check">
          <h2 style={{ margin: 0 }}>{t("Cost check")}</h2>
          <p>{t("Material, power, labour, machine wear and a reprint reserve, to check the price per gram still covers the cost.")}</p>
          <div><Link href="/calculator" className="btn-link"><Icon name="calculator" size={16} />{t("Open the full calculator")}</Link></div>
        </section>
      </div>
    </>
  );
}
