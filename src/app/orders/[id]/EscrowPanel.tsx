"use client";

import { useEffect, useState } from "react";
import { microToUsdc } from "@/lib/policy";
import type { ChainTx, Escrow, Order } from "@/lib/types";

const EXPLORER = "https://explorer.testnet.arc.io/tx/";
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

export default function EscrowPanel({ order, escrow, hasPlan, busy, act, onChange }: {
  order: Order;
  escrow: Escrow | null;
  hasPlan: boolean;
  busy: boolean;
  act: (url: string, body: unknown, success: string) => Promise<void>;
  onChange: () => void;
}) {
  const url = `/api/orders/${order.id}/escrow`;
  const pending = escrow?.txs.some((t) => !FINAL.includes(t.state)) ?? false;
  const [syncing, setSyncing] = useState(false);

  // While a transfer is pending, ask the server to check Circle every 3 s.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      setSyncing(true);
      try { await fetch(url, { cache: "no-store" }); onChange(); } finally { setSyncing(false); }
    }, 3000);
    return () => clearInterval(t);
  }, [pending, url, onChange]);

  const run = (action: string, success: string) => act(url, { action }, success);
  const open = escrow === null && hasPlan && !["ACCEPTED", "REJECTED", "PAID"].includes(order.status);
  const toppedUp = escrow?.txs.some((t) => t.kind === "customer_topup" && !["FAILED", "DENIED", "CANCELLED"].includes(t.state)) ?? false;

  return (
    <section className="card">
      <h2><span className="step">$</span> Customer payment (escrow on Arc via Circle)</h2>
      {!escrow ? (
        <>
          <p className="muted">
            The customer pays the chosen quote into an escrow wallet that only releases after they accept the goods.
            {!hasPlan && " Choose a plan first: the escrow amount is the chosen quote's price."}
          </p>
          <button className="primary" disabled={busy || !open} onClick={() => run("open", "Escrow wallets created on Circle.")}>
            Open escrow
          </button>
        </>
      ) : (
        <>
          <p>
            <b>{microToUsdc(escrow.amountMicro)} USDC</b> · {STATE_TEXT[escrow.state]}{" "}
            <span className="badge">{escrow.label}</span>{pending && <span className="muted"> · confirming on Arc{syncing ? "…" : ""}</span>}
          </p>
          <dl className="grid kv">
            <div><dt>Customer wallet</dt><dd className="mono" title={escrow.customerAddress}>{short(escrow.customerAddress)}</dd></div>
            <div><dt>Escrow wallet</dt><dd className="mono" title={escrow.escrowAddress}>{short(escrow.escrowAddress)}</dd></div>
            <div><dt>Network</dt><dd>{escrow.network}</dd></div>
          </dl>
          <div className="row" style={{ marginTop: 12 }}>
            {escrow.state === "AWAITING_DEPOSIT" && escrow.label === "testnet" && !toppedUp && (
              <button disabled={busy || pending} onClick={() => run("topup", "Sent test USDC to the customer wallet.")}>
                Give customer test USDC
              </button>
            )}
            {escrow.state === "AWAITING_DEPOSIT" && (
              <button className="primary" disabled={busy || pending} onClick={() => run("deposit", "Payment sent to escrow.")}>
                Customer pays into escrow
              </button>
            )}
            {escrow.state === "FUNDED" && (
              <>
                <button className="primary" disabled={busy || pending || order.status !== "ACCEPTED"}
                  onClick={() => run("release", "Release sent to Kesuni.")}>
                  Release to Kesuni
                </button>
                <button disabled={busy || pending || order.status !== "REJECTED"}
                  onClick={() => run("refund", "Refund sent to the customer.")}>
                  Refund customer
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  The policy engine checks acceptance, QC evidence, amount and recipient before any release.
                </span>
              </>
            )}
          </div>
          {escrow.txs.length > 0 && (
            <ol className="log" style={{ marginTop: 12 }}>
              {escrow.txs.map((t) => (
                <li key={t.idempotencyKey}>
                  {KIND_LABEL[t.kind]}: {microToUsdc(t.amountMicro)} USDC{" "}
                  <span className={`badge ${t.state === "COMPLETE" ? "ok" : FINAL.includes(t.state) ? "bad" : ""}`}>{t.state.toLowerCase()}</span>{" "}
                  {t.txHash && <a href={`${EXPLORER}${t.txHash}`} target="_blank" rel="noreferrer">view proof</a>}
                  {t.errorReason && <span className="muted"> {t.errorReason}</span>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
