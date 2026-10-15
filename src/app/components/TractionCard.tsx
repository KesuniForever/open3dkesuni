import type { Traction } from "@/lib/traction";
import { dateLocale, type Locale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";
import Info from "./Info";

const KIND = { deposit: "Customer paid into escrow", release: "Escrow released to Kesuni", refund: "Escrow refunded to customer" } as const;
const STATUS_ORDER = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED", "PAID", "REJECTED"] as const;
const when = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Real usage: real customers, real orders and their real Arc transfers. Also served as JSON at /api/traction. */
export default async function TractionCard({ t: tr }: { t: Traction }) {
  const t = await getT();
  const locale = await getLocale();
  const a = tr.arcTxs;
  const statuses = STATUS_ORDER.filter((s) => tr.realOrdersByStatus[s] > 0);
  const sim = tr.excluded.simulatedOrders;
  const top = tr.excluded.demoTopups;
  return (
    <section className="card">
      <h2>
        {t("Real usage")}
        <Info>
          {t("Real customers and real orders only; money on Arc through real Circle wallets.")} <b>{t(tr.rule)}</b>{" "}
          {t("Counted: deposit, release and refund of real orders, COMPLETE with an Arc tx hash. Customers are counted, never named.")}{" "}
          {t("Not counted: {orders}, {topups} of test USDC.", {
            orders: t(sim === 1 ? "{n} simulated order" : "{n} simulated orders", { n: sim }),
            topups: t(top === 1 ? "{n} demo top-up" : "{n} demo top-ups", { n: top }),
          })}
        </Info>
        <a href="/api/traction" style={{ marginLeft: "auto", fontWeight: 400, fontSize: 13 }}>JSON</a>
      </h2>
      <div className="grid">
        <div><div className="muted" style={{ fontSize: 12 }}>{t("Real customers")}</div><b>{tr.realCustomers}</b></div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t("Real orders")}</div><b>{tr.realOrders}</b>
          {statuses.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{statuses.map((s) => `${tr.realOrdersByStatus[s]} ${s}`).join(" · ")}</div>}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t("Real Arc transactions")}</div><b>{a.count}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {t("{deposit} deposit · {release} release · {refund} refund", { deposit: a.byKind.deposit, release: a.byKind.release, refund: a.byKind.refund })}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t("Verified on Arc")}</div><b>{a.verifiedOnArc} / {a.count}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {t("{n} not checked yet", { n: a.notCheckedYet })}{a.mismatchOnArc > 0 && ` · ${t("{n} mismatch", { n: a.mismatchOnArc })}`}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t("Transfer volume")}</div>
          <b>{a.volume.testnet.usdc} USDC</b><div className="muted" style={{ fontSize: 12 }}>{t("test USDC on Arc Testnet")}</div>
          {a.volume.mainnet.micro > 0 && <><b>{a.volume.mainnet.usdc} USDC</b><div className="muted" style={{ fontSize: 12 }}>{t("real USDC on Arc mainnet")}</div></>}
        </div>
      </div>
      {a.last.length > 0 ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr className="muted" style={{ textAlign: "left" }}>
                <th>{t("When (WIB)")}</th><th>{t("Order")}</th><th>{t("Transfer")}</th><th>USDC</th><th>{t("Arc tx")}</th><th>{t("Check")}</th>
              </tr>
            </thead>
            <tbody>
              {a.last.map((x) => (
                <tr key={`${x.orderId}-${x.txHash}`}>
                  <td>{when(x.at, locale)}</td>
                  <td>{x.orderId}</td>
                  <td>{t(KIND[x.kind])}</td>
                  <td>{x.amountUsdc} <span className="badge">{x.networkLabel}</span></td>
                  <td><a className="mono" href={x.explorerUrl} target="_blank" rel="noreferrer">{short(x.txHash)}</a></td>
                  <td>
                    {x.verifiedOnArc === true && <span className="badge ok">{t("verified")}</span>}
                    {x.verifiedOnArc === false && <span className="badge bad">{t("mismatch")}</span>}
                    {x.verifiedOnArc === null && <span className="muted">{t("not yet")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>{t("No completed Arc transfers on real orders yet.")}</p>
      )}
    </section>
  );
}
