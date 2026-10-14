import Link from "next/link";
import { listEscrows, getOrder } from "@/lib/store";
import { microToUsdc } from "@/lib/policy";
import { explorerTxBase, network } from "@/lib/network";
import { arcConfig } from "@/lib/arc-verify";
import type { ChainTx } from "@/lib/types";
import { ArcCheckForm, RecheckButton } from "./ArcCheck";

export const dynamic = "force-dynamic";

const KIND: Record<ChainTx["kind"], string> = {
  customer_topup: "Test top-up (internal)", deposit: "Customer deposit", release: "Release to shop", refund: "Refund to customer",
};
const time = (iso: string) =>
  `${new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WIB`;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Operator page: check any USDC transfer on Arc, and the Arc check of every escrow transfer. */
export default function ArcPage() {
  const net = network();
  const cfg = arcConfig();
  const rows = listEscrows().flatMap((e) => e.txs.map((tx) => ({ escrow: e, order: getOrder(e.orderId), tx })));
  const money = rows.filter((r) => r.tx.kind !== "customer_topup");
  const count = (f: (r: (typeof rows)[number]) => boolean) => money.filter(f).length;
  const verified = count((r) => r.tx.verified?.ok === true);
  const mismatched = count((r) => r.tx.verified?.ok === false);

  return (
    <main className="wrap">
      <header className="page-head">
        <div>
          <p className="eyebrow">Arc check</p>
          <h1>Arc transactions, checked on chain.</h1>
          <p className="page-sub">
            Circle reports a transfer as complete; this page asks {cfg.ok && cfg.chainId === 5042002 ? "Arc Testnet (chain 5042002)" : net.name} itself.
            A transfer counts as verified when its receipt succeeded, its block is canonical, and it holds exactly one USDC Transfer
            with the same sender, recipient and amount (USDC on Arc has 6 decimals). Read-only: nothing is sent and no escrow
            changes. The heartbeat checks up to 5 new transfers per beat.
            {net.isTestnet && ` ${net.name}: test USDC, not real money.`}
          </p>
        </div>
      </header>
      {!cfg.ok && <div className="alert bad">{cfg.reason}</div>}

      <section className="card">
        <h2>Check a transaction</h2>
        <ArcCheckForm />
      </section>

      <section className="card">
        <h2>
          Escrow transfers <span className="badge">{money.length}</span>
          <span className="badge ok">{verified} verified</span>
          {mismatched > 0 && <span className="badge bad">{mismatched} mismatch</span>}
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Customer deposits, releases and refunds of every escrow (Circle wallets on {net.name}). Test top-ups from the demo-funds
          wallet are internal moves, listed but not counted as customer payments.
        </p>
        {rows.length === 0 && <p className="muted">No escrow transfers yet.</p>}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Order</th><th>Transfer</th><th>USDC</th><th>Circle</th><th>Arc</th><th /></tr>
              </thead>
              <tbody>
                {rows.map(({ escrow, order, tx }) => (
                  <tr key={tx.idempotencyKey}>
                    <td>
                      <Link href={`/orders/${escrow.orderId}`}>{escrow.orderId}</Link>
                      {order && <div className="muted" style={{ fontSize: 12 }}>{order.product} · {order.label}</div>}
                    </td>
                    <td>
                      {KIND[tx.kind]}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {time(tx.at)}
                        {tx.txHash && <> · <a href={`${explorerTxBase(escrow.network)}${tx.txHash}`} target="_blank" rel="noreferrer">{short(tx.txHash)}</a></>}
                      </div>
                    </td>
                    <td>{microToUsdc(tx.amountMicro)}</td>
                    <td><span className={`badge ${tx.state === "COMPLETE" ? "ok" : ""}`}>{tx.state.toLowerCase()}</span></td>
                    <td>
                      {tx.verified?.ok === true && <span className="badge ok" title={tx.verified.logId}>verified on Arc</span>}
                      {tx.verified?.ok === false && <><span className="badge bad">mismatch</span><div className="muted" style={{ fontSize: 12 }}>{tx.verified.reason}</div></>}
                      {!tx.verified && <span className="muted" style={{ fontSize: 12 }}>{tx.state === "COMPLETE" && tx.txHash ? "not checked yet" : "—"}</span>}
                      {tx.verified && <div className="muted" style={{ fontSize: 12 }}>{time(tx.verified.at)}</div>}
                    </td>
                    <td>
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
    </main>
  );
}
