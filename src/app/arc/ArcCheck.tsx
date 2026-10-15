"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ArcCheck } from "@/lib/arc-verify";
import Icon from "../components/Icon";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/core";

type Result = { check?: ArcCheck; explorerUrl?: string | null; error?: string };

/** A stored escrow transfer the form can be filled with (real data, nothing invented). */
export interface Sample { label: string; txHash: string; from: string; to: string; amountUsdc: string }

const TITLE: Record<ArcCheck["status"], string> = {
  verified: "Verified on Arc", mismatch: "Does not match", not_found: "Not found on Arc (yet)",
  unavailable: "Arc RPC unavailable", invalid: "Check the input",
};

function ResultBox({ r }: { r: Result }) {
  const t = useT();
  if (r.error) return <div className="arc-proof bad" role="alert"><Icon name="info" size={20} /><div><b>{t("Check failed")}</b><p>{t(r.error)}</p></div></div>;
  const c = r.check;
  if (!c) return null;
  const ok = c.status === "verified";
  return (
    <div className={`arc-proof ${ok ? "ok" : "bad"}`} role="status">
      <Icon name={ok ? "check" : "info"} size={20} />
      <div>
        <b>{t(TITLE[c.status])}</b>
        {c.status === "verified" ? (
          <p>
            {t("One matching USDC Transfer · block #{block} · log {log}", { block: c.blockNumber, log: c.logIndex })}
            <br /><code>{c.logId}</code>
          </p>
        ) : (
          <p>{t(c.reason)}</p>
        )}
        {r.explorerUrl && <p><a href={r.explorerUrl} target="_blank" rel="noreferrer">{t("Open in the explorer")} <Icon name="arrow" size={14} /></a></p>}
      </div>
    </div>
  );
}

async function post(body: unknown, t: T): Promise<Result> {
  try {
    const res = await fetch("/api/arc/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    return j.check ? j : { error: j.error ?? t("Error {status}", { status: res.status }) };
  } catch {
    return { error: t("Network error. Is the server running?") };
  }
}

const EMPTY = { txHash: "", from: "", to: "", amountUsdc: "" };

/** Paste any transfer and check it on Arc. Nothing is saved or sent. */
export function ArcCheckForm({ samples = [] }: { samples?: Sample[] }) {
  const t = useT();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setR(await post(f, t));
    setBusy(false);
  }

  function fill(s: Sample) {
    setF({ txHash: s.txHash, from: s.from, to: s.to, amountUsdc: s.amountUsdc });
    setR(null);
  }

  return (
    <>
      {samples.length > 0 && (
        <div className="arc-samples">
          <span>{t("Fill from")}</span>
          {samples.map((s) => (
            <button key={`${s.label}-${s.txHash}`} type="button" className="arc-chip" onClick={() => fill(s)}>{s.label}</button>
          ))}
        </div>
      )}
      <form className="arc-form" onSubmit={(e) => void submit(e)}>
        <label className="arc-full">{t("Transaction hash")}
          <input value={f.txHash} onChange={set("txHash")} placeholder={t("0x… (64 hex characters)")} spellCheck={false} autoComplete="off" required />
        </label>
        <label>{t("From (sender)")}
          <input value={f.from} onChange={set("from")} placeholder="0x…" spellCheck={false} autoComplete="off" required />
        </label>
        <label>{t("To (recipient)")}
          <input value={f.to} onChange={set("to")} placeholder="0x…" spellCheck={false} autoComplete="off" required />
        </label>
        <label>{t("Amount (USDC)")}
          <input value={f.amountUsdc} onChange={set("amountUsdc")} inputMode="decimal" placeholder="12.5" autoComplete="off" required />
        </label>
        <div className="arc-submit">
          <button className="primary" disabled={busy}><Icon name="shield" size={16} />{busy ? t("Checking on Arc…") : t("Check on Arc")}</button>
          {(f.txHash || f.from || f.to || f.amountUsdc) && !busy && (
            <button type="button" onClick={() => { setF(EMPTY); setR(null); }}>{t("Clear")}</button>
          )}
        </div>
      </form>
      {r && <ResultBox r={r} />}
    </>
  );
}

/** Re-check one stored escrow transfer and save the result on it. */
export function RecheckButton({ orderId, idempotencyKey }: { orderId: string; idempotencyKey: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    const res = await post({ orderId, idempotencyKey }, t);
    setR(res.check?.status === "verified" ? null : res);
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button className="arc-recheck" onClick={() => void run()} disabled={busy}>{busy ? t("Checking…") : t("Check now")}</button>
      {r && (r.error || (r.check && r.check.status !== "mismatch")) && (
        <div className="arc-sub">{t(r.error ?? (r.check && "reason" in r.check ? r.check.reason : ""))}</div>
      )}
    </div>
  );
}
