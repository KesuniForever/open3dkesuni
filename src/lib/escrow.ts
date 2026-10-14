// Escrow actions: the only code that moves USDC. Same rule as actions.ts: HTTP routes and
// agent tools call these, and every money move is checked by the policy engine first.
//
// Safety rules:
// - Every Circle transfer gets a UUID idempotency key that is SAVED before Circle is called.
//   If the call fails or times out, the tx stays NOT_SUBMITTED and syncEscrow retries with
//   the same key, so Circle can never execute it twice.
// - Policy checks and the write that records a new transfer run without an `await` in
//   between, so two clicks cannot both pass the check.
import { randomUUID } from "node:crypto";
import * as store from "./store";
import { circle, FINAL_STATES } from "./circle";
import { isTestnetChain } from "./network";
import { checkEscrowOpen, checkRefund, checkRelease, microToUsdc } from "./policy";
import { assertTransition } from "./payment-state";
import { createPaymentIntent, type Fail } from "./actions";
import type { ChainTx, Escrow, PaymentIntent } from "./types";

type Ok = { ok: true; escrow: Escrow };
const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const live = (t: ChainTx) => !["FAILED", "DENIED", "CANCELLED"].includes(t.state);

function newTx(kind: ChainTx["kind"], from: string, to: string, amountMicro: number): ChainTx {
  return { kind, from, to, amountMicro, idempotencyKey: randomUUID(), state: "NOT_SUBMITTED", at: new Date().toISOString() };
}

/** Send the tx to Circle. The tx (with its key) must already be saved in the escrow. */
async function submit(orderId: string, tx: ChainTx): Promise<void> {
  let patch: Partial<ChainTx>;
  try {
    const t = await circle().transferUsdc({
      fromAddress: tx.from, to: tx.to, amountMicro: tx.amountMicro,
      idempotencyKey: tx.idempotencyKey, refId: `${orderId}:${tx.kind}`,
    });
    patch = { circleTxId: t.circleTxId, state: t.state, errorReason: undefined };
  } catch (e) {
    patch = { errorReason: `Circle call failed, will retry with the same key: ${message(e)}` };
  }
  const escrow = store.getEscrow(orderId);
  const saved = escrow?.txs.find((t) => t.idempotencyKey === tx.idempotencyKey);
  if (!escrow || !saved) return;
  Object.assign(saved, patch);
  store.saveEscrow(escrow);
}

/** Create the customer wallet and the per-order escrow wallet (both Circle SCA wallets on Arc). */
export async function openEscrow(orderId: string): Promise<Ok | Fail> {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const quote = order.chosenQuoteId ? store.getQuote(order.chosenQuoteId) : undefined;
  const policy = checkEscrowOpen(order, quote, store.getEscrow(orderId));
  if (!policy.ok) return fail(422, "Escrow blocked by policy", policy.reasons);

  let customer, escrowWallet;
  try {
    customer = await circle().createWallet(`${order.jobId} customer`, `${orderId}:customer`);
    escrowWallet = await circle().createWallet(`${order.jobId} escrow`, `${orderId}:escrow`);
  } catch (e) {
    return fail(502, `Could not create Circle wallets: ${message(e)}`);
  }
  if (store.getEscrow(orderId)) return fail(409, "Order already has an escrow"); // opened by a parallel request
  const network = circle().network;
  const escrow: Escrow = {
    orderId, amountMicro: quote!.priceMicro,
    escrowWalletId: escrowWallet.walletId, escrowAddress: escrowWallet.address,
    customerWalletId: customer.walletId, customerAddress: customer.address,
    state: "AWAITING_DEPOSIT", txs: [], network,
    label: isTestnetChain(network) ? "testnet" : "mainnet", createdAt: new Date().toISOString(),
  };
  store.saveEscrow(escrow);
  return { ok: true, escrow };
}

/**
 * Testnet only: give the customer's wallet test USDC from Kesuni's demo-funds wallet
 * (Circle's faucet API is not available to this account). Never on mainnet.
 */
export async function topUpCustomer(orderId: string): Promise<Ok | Fail> {
  const demoFunds = process.env.KESUNI_DEMO_FUNDS_ADDRESS;
  if (!demoFunds) return fail(501, "KESUNI_DEMO_FUNDS_ADDRESS is not set");
  if (!isTestnetChain(circle().network)) return fail(403, "Test top-ups are only allowed on testnet");
  const before = store.getEscrow(orderId);
  if (!before) return fail(404, "Order has no escrow");
  const balance = await circle().usdcBalanceMicro(before.customerWalletId);

  const escrow = store.getEscrow(orderId)!;
  if (escrow.state !== "AWAITING_DEPOSIT") return fail(409, `Escrow is ${escrow.state}`);
  if (escrow.txs.some((t) => t.kind === "customer_topup" && live(t))) return fail(409, "Customer was already topped up");
  if (balance >= escrow.amountMicro) return fail(409, `Customer already holds ${microToUsdc(balance)} USDC`);
  const tx = newTx("customer_topup", demoFunds, escrow.customerAddress, escrow.amountMicro - balance);
  escrow.txs.push(tx);
  store.saveEscrow(escrow);
  await submit(orderId, tx);
  return { ok: true, escrow: store.getEscrow(orderId)! };
}

/** The customer pays: their wallet -> escrow wallet, for exactly the escrow amount. */
export async function deposit(orderId: string): Promise<Ok | Fail> {
  const before = store.getEscrow(orderId);
  if (!before) return fail(404, "Order has no escrow");
  const balance = await circle().usdcBalanceMicro(before.customerWalletId);

  const escrow = store.getEscrow(orderId)!;
  if (escrow.state !== "AWAITING_DEPOSIT") return fail(409, `Escrow is ${escrow.state}`);
  if (escrow.txs.some((t) => t.kind === "deposit" && live(t))) return fail(409, "A deposit is already in progress or done");
  if (balance < escrow.amountMicro) {
    return fail(422, "Customer wallet has too little USDC", [`Holds ${microToUsdc(balance)} USDC, needs ${microToUsdc(escrow.amountMicro)} USDC`]);
  }
  const tx = newTx("deposit", escrow.customerAddress, escrow.escrowAddress, escrow.amountMicro);
  escrow.txs.push(tx);
  store.saveEscrow(escrow);
  await submit(orderId, tx);
  return { ok: true, escrow: store.getEscrow(orderId)! };
}

/** After the customer accepted: escrow -> shop, through a payment intent and the policy engine. */
export async function release(orderId: string): Promise<(Ok & { intent: PaymentIntent }) | Fail> {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const before = store.getEscrow(orderId);
  if (!before) return fail(404, "Order has no escrow");
  const balance = await circle().usdcBalanceMicro(before.escrowWalletId);

  const escrow = store.getEscrow(orderId)!;
  const quote = order.chosenQuoteId ? store.getQuote(order.chosenQuoteId) : undefined;
  const vendor = quote ? store.getVendor(quote.vendorId) : undefined;
  const policy = checkRelease({
    order, chosenQuote: quote, vendor, evidence: store.listEvidence(orderId),
    acceptance: store.getAcceptance(orderId), escrow, escrowBalanceMicro: balance,
  });
  if (!policy.ok) return fail(422, "Release blocked by policy", policy.reasons);

  // Reuse the order's intent if an earlier release attempt failed; otherwise create one.
  let intent = store.listIntents(orderId)[0];
  if (!intent) {
    const r = createPaymentIntent(orderId, { recipient: vendor!.address, amountMicro: escrow.amountMicro, idempotencyKey: randomUUID() });
    if (!r.ok) return r;
    intent = r.intent;
  }
  if (intent.state === "PAYMENT_INTENT_CREATED") {
    assertTransition(intent.state, "SUBMITTED");
    intent = { ...intent, state: "SUBMITTED", label: escrow.label, network: escrow.network };
    store.updateIntent(intent);
  }
  const tx = newTx("release", escrow.escrowAddress, vendor!.address, escrow.amountMicro);
  escrow.txs.push(tx);
  store.saveEscrow(escrow);
  await submit(orderId, tx);
  return { ok: true, escrow: store.getEscrow(orderId)!, intent };
}

/** After the customer rejected: escrow -> back to the customer's wallet. */
export async function refund(orderId: string): Promise<Ok | Fail> {
  const before = store.getEscrow(orderId);
  if (!before) return fail(404, "Order has no escrow");
  const balance = await circle().usdcBalanceMicro(before.escrowWalletId);

  const escrow = store.getEscrow(orderId)!;
  const policy = checkRefund({ acceptance: store.getAcceptance(orderId), escrow, escrowBalanceMicro: balance });
  if (!policy.ok) return fail(422, "Refund blocked by policy", policy.reasons);
  const tx = newTx("refund", escrow.escrowAddress, escrow.customerAddress, escrow.amountMicro);
  escrow.txs.push(tx);
  store.saveEscrow(escrow);
  await submit(orderId, tx);
  return { ok: true, escrow: store.getEscrow(orderId)! };
}

/**
 * Bring pending transfers up to date (one Circle call each, no long polling, so it fits
 * serverless). Retries NOT_SUBMITTED transfers with their saved key. Moves the escrow,
 * order and payment intent forward only on Circle's COMPLETE.
 */
export async function syncEscrow(orderId: string): Promise<Ok | Fail> {
  const start = store.getEscrow(orderId);
  if (!start) return fail(404, "Order has no escrow");

  for (const tx of start.txs) {
    if (FINAL_STATES.includes(tx.state)) continue;
    if (tx.state === "NOT_SUBMITTED") {
      await submit(orderId, tx);
      continue;
    }
    try {
      const t = await circle().getTransfer(tx.circleTxId!);
      const escrow = store.getEscrow(orderId)!;
      const saved = escrow.txs.find((x) => x.idempotencyKey === tx.idempotencyKey)!;
      Object.assign(saved, { state: t.state, txHash: t.txHash ?? saved.txHash, errorReason: t.errorReason });
      store.saveEscrow(escrow);
    } catch {
      // Leave it pending; the next sync asks again. Never resend a submitted transfer.
    }
  }

  const escrow = store.getEscrow(orderId)!;
  const done = (kind: ChainTx["kind"]) => escrow.txs.find((t) => t.kind === kind && t.state === "COMPLETE");
  if (escrow.state === "AWAITING_DEPOSIT" && done("deposit")) escrow.state = "FUNDED";
  if (escrow.state === "FUNDED" && done("refund")) escrow.state = "REFUNDED";
  const released = escrow.state === "FUNDED" ? done("release") : undefined;
  if (released) {
    escrow.state = "RELEASED";
    const intent = store.listIntents(orderId)[0];
    if (intent && intent.state === "SUBMITTED") {
      assertTransition(intent.state, "CONFIRMED");
      store.updateIntent({ ...intent, state: "CONFIRMED", txHash: released.txHash });
    }
    const order = store.getOrder(orderId);
    if (order && order.status === "ACCEPTED") store.saveOrder({ ...order, status: "PAID" });
  }
  store.saveEscrow(escrow);
  return { ok: true, escrow };
}
