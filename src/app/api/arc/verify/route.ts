import { NextResponse } from "next/server";
import { openArcMismatchTask, verifyStoredTx, verifyTransfer, type ArcCheck } from "@/lib/arc-verify";
import { network } from "@/lib/network";
import { usdcToMicro } from "@/lib/policy";
import * as store from "@/lib/store";
import { fail, readJson, str } from "@/lib/http";

// Check a USDC transfer on Arc (read-only RPC; nothing is sent, escrow state never changes). Operator only (proxy.ts).
// Body either { txHash, from, to, amountUsdc } (any transfer, nothing saved)
// or { orderId, idempotencyKey } (re-check one stored escrow tx and save the result on it).
const STATUS: Record<ArcCheck["status"], number> = { verified: 200, mismatch: 200, not_found: 200, unavailable: 502, invalid: 400 };

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail(400, "Send a JSON body");
  const explorer = (hash: string) => network().explorerTxUrl(hash);

  if (body.orderId || body.idempotencyKey) {
    const orderId = str(body.orderId);
    const key = str(body.idempotencyKey);
    const r = await verifyStoredTx(orderId, key);
    if ("error" in r) return fail(r.error === "Transaction not found" ? 404 : 409, r.error);
    const tx = store.getEscrow(orderId)?.txs.find((t) => t.idempotencyKey === key);
    if (r.saved) {
      store.addLog({ orderId, actor: "human", tool: "arc_verify", input: { kind: tx?.kind, txHash: tx?.txHash }, ok: r.saved.ok,
        output: r.saved.ok ? { verified: true, logId: r.saved.logId } : { verified: false, reason: r.saved.reason }, at: r.saved.at });
      // The same follow-up as the heartbeat: a mismatch opens one needs_info task (escrow is never changed).
      if (!r.saved.ok && tx) openArcMismatchTask(orderId, tx, r.saved);
    }
    return NextResponse.json({ check: r.check, saved: r.saved ?? null, explorerUrl: tx?.txHash ? explorer(tx.txHash) : null },
      { status: STATUS[r.check.status] });
  }

  const txHash = str(body.txHash).trim();
  let amountMicro: number;
  try {
    amountMicro = usdcToMicro(str(body.amountUsdc).trim());
  } catch {
    return fail(400, "Amount must be a USDC number like 12.5 (max 6 decimals)");
  }
  const check = await verifyTransfer({ txHash, from: str(body.from).trim(), to: str(body.to).trim(), amountMicro });
  return NextResponse.json({ check, explorerUrl: check.status === "invalid" ? null : explorer(txHash) }, { status: STATUS[check.status] });
}
