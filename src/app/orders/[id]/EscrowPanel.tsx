"use client";

import { useEffect, useState } from "react";
import { microToUsdc } from "@/lib/policy";
import type { ChainTx, Escrow, Order } from "@/lib/types";
import type { PublicNetwork } from "@/lib/network";
import { useT } from "@/i18n/client";

const FINAL = ["COMPLETE", "FAILED", "DENIED", "CANCELLED"];
const KIND_LABEL: Record<ChainTx["kind"], string> = {
  customer_topup: "Test USDC to customer (from Kesuni demo funds)",
  deposit: "Customer pays into escrow",
  release: "Escrow released to Kesuni",
  refund: "Escrow refunded to customer",
};
const STATE_TEXT: Record<Escrow["state"], string> = {
  AWAITING_DEPOSIT: "Waiting for the customer to pay into escrow",
  FUNDED: "Funds locked in escrow until the customer accepts or rejects",
  RELEASED: "Released to Kesuni after the customer accepted",
  REFUNDED: "Returned to the customer after rejection",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function EscrowPanel({ order, escrow, network, hasPlan, busy, act, onChange }: {
  order: Order;
  escrow: Escrow | null;
  network: PublicNetwork; // the escrow's chain, else the configured one (explorer links)
  hasPlan: boolean;
  busy: boolean;
  act: (url: string, body: unknown, success: string) => Promise<void>;
  onChange: () => void;
}) {
  const t = useT();
  const url = `/api/orders/${order.id}/escrow`;
  const pending = escrow?.txs.some((tx) => !FINAL.includes(tx.state)) ?? false;
  const [syncing, setSyncing] = useState(false);

  // While a transfer is pending, ask the server to check Circle every 3 s.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(async () => {
      setSyncing(true);
      try { await fetch(url, { cache: "no-store" }); onChange(); } finally { setSyncing(false); }
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, url, onChange]);

  const run = (action: string, success: string) => act(url, { action }, success);
  const open = escrow === null && hasPlan && !["ACCEPTED", "REJECTED", "PAID"].includes(order.status);
  const toppedUp = escrow?.txs.some((tx) => tx.kind === "customer_topup" && !["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) ?? false;

  return (
    <section className="card money">
      <h2><span className="step">$</span> {t("Customer payment (escrow on {network} via Circle)", { network: network.name })}</h2>
      {!escrow ? (
        <>
          <p className="muted">
            {t("The customer pays the chosen quote into an escrow wallet that only releases after they accept the goods.")}
            {!hasPlan && " " + t("Choose a plan first: the escrow amount is the chosen quote's price.")}
          </p>
          <button className="primary" disabled={busy || !open} onClick={() => run("open", t("Escrow wallets created on Circle."))}>
            {t("Open escrow")}
          </button>
        </>
      ) : (
        <>
          <p>
            <b>{microToUsdc(escrow.amountMicro)} USDC</b> · {t(STATE_TEXT[escrow.state])}{" "}
            <span className="badge">{t(escrow.label)}</span>{pending && <span className="muted"> · {t("confirming on Arc")}{syncing ? "…" : ""}</span>}
          </p>
          <dl className="grid kv">
            <div><dt>{t("Customer wallet")}</dt><dd className="mono" title={escrow.customerAddress}>{short(escrow.customerAddress)}</dd></div>
            <div><dt>{t("Escrow wallet")}</dt><dd className="mono" title={escrow.escrowAddress}>{short(escrow.escrowAddress)}</dd></div>
            <div><dt>{t("Network")}</dt><dd>{escrow.network}</dd></div>
          </dl>
          <div className="row" style={{ marginTop: 12 }}>
            {escrow.state === "AWAITING_DEPOSIT" && escrow.label === "testnet" && !toppedUp && (
              <button disabled={busy || pending} onClick={() => run("topup", t("Sent test USDC to the customer wallet."))}>
                {t("Give customer test USDC")}
              </button>
            )}
            {escrow.state === "AWAITING_DEPOSIT" && (
              <button className="primary" disabled={busy || pending} onClick={() => run("deposit", t("Payment sent to escrow."))}>
                {t("Customer pays into escrow")}
              </button>
            )}
            {escrow.state === "FUNDED" && (
              <>
                <button className="primary" disabled={busy || pending || order.status !== "ACCEPTED"}
                  onClick={() => run("release", t("Release sent to Kesuni."))}>
                  {t("Release to Kesuni")}
                </button>
                <button disabled={busy || pending || order.status !== "REJECTED"}
                  onClick={() => run("refund", t("Refund sent to the customer."))}>
                  {t("Refund customer")}
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  {t("The policy engine checks acceptance, QC evidence, amount and recipient before any release.")}
                </span>
              </>
            )}
          </div>
          {escrow.txs.length > 0 && (
            <ol className="log" style={{ marginTop: 12 }}>
              {escrow.txs.map((tx) => (
                <li key={tx.idempotencyKey}>
                  {t(KIND_LABEL[tx.kind])}: {microToUsdc(tx.amountMicro)} USDC{" "}
                  <span className={`badge ${tx.state === "COMPLETE" ? "ok" : FINAL.includes(tx.state) ? "bad" : ""}`}>{t(tx.state.toLowerCase())}</span>{" "}
                  {tx.txHash && <a href={`${network.explorerTxBase}${tx.txHash}`} target="_blank" rel="noreferrer">{t("view proof")}</a>}
                  {tx.verified?.ok === true && (
                    <> <span className="badge ok" title={tx.verified.logId}>{t("verified on Arc")}{tx.verified.internal ? ` · ${t("internal")}` : ""}</span></>
                  )}
                  {tx.verified?.ok === false && <> <span className="badge bad">{t("Arc mismatch")}</span><span className="muted"> {tx.verified.reason && t(tx.verified.reason)}</span></>}
                  {tx.state === "COMPLETE" && tx.txHash && !tx.verified && <> <span className="muted" style={{ fontSize: 12 }}>{t("Arc check pending")}</span></>}
                  {tx.errorReason && <span className="muted"> {t(tx.errorReason)}</span>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
