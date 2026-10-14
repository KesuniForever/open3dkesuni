import type { Traction } from "@/lib/traction";

const KIND = { deposit: "Customer paid into escrow", release: "Escrow released to Kesuni", refund: "Escrow refunded to customer" } as const;
const STATUS_ORDER = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED", "PAID", "REJECTED"] as const;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Real usage: real customers, real orders and their real Arc transfers. Also served as JSON at /api/traction. */
export default function TractionCard({ t }: { t: Traction }) {
  const a = t.arcTxs;
  const statuses = STATUS_ORDER.filter((s) => t.realOrdersByStatus[s] > 0);
  return (
    <section className="card">
      <h2>
        Real usage
        <a href="/api/traction" style={{ marginLeft: "auto", fontWeight: 400, fontSize: 13 }}>JSON</a>
      </h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Real customers and real orders only; money on Arc through real Circle wallets. <b>{t.rule}</b>
      </p>
      <div className="grid">
        <div><div className="muted" style={{ fontSize: 12 }}>Real customers</div><b>{t.realCustomers}</b></div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Real orders</div><b>{t.realOrders}</b>
          {statuses.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{statuses.map((s) => `${t.realOrdersByStatus[s]} ${s}`).join(" · ")}</div>}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Real Arc transactions</div><b>{a.count}</b>
          <div className="muted" style={{ fontSize: 12 }}>{a.byKind.deposit} deposit · {a.byKind.release} release · {a.byKind.refund} refund</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Verified on Arc</div><b>{a.verifiedOnArc} / {a.count}</b>
          <div className="muted" style={{ fontSize: 12 }}>{a.notCheckedYet} not checked yet{a.mismatchOnArc > 0 && ` · ${a.mismatchOnArc} mismatch`}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Transfer volume</div>
          <b>{a.volume.testnet.usdc} USDC</b><div className="muted" style={{ fontSize: 12 }}>test USDC on Arc Testnet</div>
          {a.volume.mainnet.micro > 0 && <><b>{a.volume.mainnet.usdc} USDC</b><div className="muted" style={{ fontSize: 12 }}>real USDC on Arc mainnet</div></>}
        </div>
      </div>
      {a.last.length > 0 ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr className="muted" style={{ textAlign: "left" }}><th>When (WIB)</th><th>Order</th><th>Transfer</th><th>USDC</th><th>Arc tx</th><th>Check</th></tr>
            </thead>
            <tbody>
              {a.last.map((x) => (
                <tr key={`${x.orderId}-${x.txHash}`}>
                  <td>{when(x.at)}</td>
                  <td>{x.orderId}</td>
                  <td>{KIND[x.kind]}</td>
                  <td>{x.amountUsdc} <span className="badge">{x.networkLabel}</span></td>
                  <td><a className="mono" href={x.explorerUrl} target="_blank" rel="noreferrer">{short(x.txHash)}</a></td>
                  <td>
                    {x.verifiedOnArc === true && <span className="badge ok">verified</span>}
                    {x.verifiedOnArc === false && <span className="badge bad">mismatch</span>}
                    {x.verifiedOnArc === null && <span className="muted">not yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>No completed Arc transfers on real orders yet.</p>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Counted: deposit, release and refund of real orders, COMPLETE with an Arc tx hash. Customers are counted, never named
        (the same name twice is one customer). Not counted here: {t.excluded.simulatedOrders} simulated order{t.excluded.simulatedOrders === 1 ? "" : "s"}, {t.excluded.demoTopups} demo top-up{t.excluded.demoTopups === 1 ? "" : "s"} of test USDC.
      </p>
    </section>
  );
}
