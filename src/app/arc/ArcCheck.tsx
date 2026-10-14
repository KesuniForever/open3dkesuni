"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ArcCheck } from "@/lib/arc-verify";

type Result = { check?: ArcCheck; explorerUrl?: string | null; error?: string };

const TITLE: Record<ArcCheck["status"], string> = {
  verified: "Verified on Arc", mismatch: "Does not match", not_found: "Not found on Arc (yet)",
  unavailable: "Arc RPC unavailable", invalid: "Check the input",
};

function ResultBox({ r }: { r: Result }) {
  if (r.error) return <div className="alert bad">{r.error}</div>;
  const c = r.check;
  if (!c) return null;
  return (
    <div className={`alert ${c.status === "verified" ? "ok" : "bad"}`}>
      <b>{TITLE[c.status]}</b>
      {c.status === "verified" ? (
        <div style={{ fontSize: 13 }}>
          Exactly one matching USDC Transfer, log {c.logIndex} in block {c.blockNumber}. ID <code>{c.logId}</code>
        </div>
      ) : (
        <div style={{ fontSize: 13 }}>{c.reason}</div>
      )}
      {r.explorerUrl && <div style={{ fontSize: 13 }}><a href={r.explorerUrl} target="_blank" rel="noreferrer">Open in the explorer</a></div>}
    </div>
  );
}

async function post(body: unknown): Promise<Result> {
  try {
    const res = await fetch("/api/arc/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    return j.check ? j : { error: j.error ?? `Error ${res.status}` };
  } catch {
    return { error: "Network error. Is the server running?" };
  }
}

/** Paste any transfer and check it on Arc. Nothing is saved or sent. */
export function ArcCheckForm() {
  const [f, setF] = useState({ txHash: "", from: "", to: "", amountUsdc: "" });
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setR(await post(f));
    setBusy(false);
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <label>Transaction hash
        <input value={f.txHash} onChange={set("txHash")} placeholder="0x… (64 hex characters)" spellCheck={false} required />
      </label>
      <div className="row">
        <label style={{ flex: "1 1 260px" }}>From (sender)
          <input value={f.from} onChange={set("from")} placeholder="0x…" spellCheck={false} required />
        </label>
        <label style={{ flex: "1 1 260px" }}>To (recipient)
          <input value={f.to} onChange={set("to")} placeholder="0x…" spellCheck={false} required />
        </label>
        <label style={{ flex: "0 1 140px" }}>Amount (USDC)
          <input value={f.amountUsdc} onChange={set("amountUsdc")} inputMode="decimal" placeholder="12.5" required />
        </label>
      </div>
      <div><button className="primary" disabled={busy}>{busy ? "Checking on Arc…" : "Check on Arc"}</button></div>
      {r && <ResultBox r={r} />}
    </form>
  );
}

/** Re-check one stored escrow transfer and save the result on it. */
export function RecheckButton({ orderId, idempotencyKey }: { orderId: string; idempotencyKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    const res = await post({ orderId, idempotencyKey });
    setR(res.check?.status === "verified" ? null : res);
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button onClick={() => void run()} disabled={busy} style={{ fontSize: 12, padding: "4px 10px" }}>{busy ? "Checking…" : "Check now"}</button>
      {r && (r.error || (r.check && r.check.status !== "mismatch")) && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{r.error ?? (r.check && "reason" in r.check ? r.check.reason : "")}</div>
      )}
    </div>
  );
}
