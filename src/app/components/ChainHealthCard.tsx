"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ChainHealth } from "@/lib/chain-health";

const ARC_TEXT: Record<ChainHealth["arc"]["status"], string> = {
  ok: "live", stale: "stale", wrong_chain: "wrong chain", bad_token: "USDC mismatch", unreachable: "unreachable", not_configured: "not configured",
};
const CIRCLE_TEXT: Record<ChainHealth["circle"]["status"], string> = { ok: "reachable", unreachable: "unreachable", not_configured: "not configured" };
const tone = (s: string) => (s === "ok" ? "ok" : s === "stale" || s === "not_configured" ? "" : "bad");
const time = (iso: string) => `${new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`;

/** Arc RPC and Circle health, loaded after the page so a slow or blocked network never delays or breaks it. */
export default function ChainHealthCard() {
  const [h, setH] = useState<ChainHealth | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  // Fetch, then set state in the callbacks (never synchronously in an effect).
  const fetchHealth = useCallback((fresh: boolean, alive: () => boolean = () => true) =>
    fetch(`/api/health/chain${fresh ? "?fresh=1" : ""}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((j: ChainHealth) => { if (alive()) { setH(j); setError(""); } })
      .catch(() => { if (alive()) setError("Could not load the network check."); })
      .finally(() => { if (alive()) setBusy(false); }), []);

  useEffect(() => {
    let alive = true;
    void fetchHealth(false, () => alive);
    return () => { alive = false; };
  }, [fetchHealth]);

  function checkNow() {
    setBusy(true);
    void fetchHealth(true);
  }

  const arc = h?.arc;
  const circ = h?.circle;
  return (
    <section className="card">
      <h2>
        Arc + Circle {h && <span className="badge">{h.network.label}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontWeight: 400, fontSize: 13 }}>
          <Link href="/arc">Check a transaction</Link>
          <button onClick={checkNow} disabled={busy}>{busy ? "Checking…" : "Check now"}</button>
        </span>
      </h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Read-only checks of the networks the escrow runs on{h ? ` (${h.network.name})` : ""}; nothing is sent.
        {h && ` Checked ${time(h.at)}${h.cached ? " (cached, refreshes every minute)" : ""}.`}
      </p>
      {error && <div className="alert bad" style={{ fontSize: 13 }}>{error}</div>}
      {!h && !error && <p className="muted">Checking Arc and Circle…</p>}
      {arc && circ && (
        <div className="grid">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Arc RPC</div>
            <span className={`badge ${tone(arc.status)}`}>{ARC_TEXT[arc.status]}</span>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {arc.chainId !== undefined && <>chain {arc.chainId}{arc.chainId === arc.expectedChainId ? " ✓" : ` (expected ${arc.expectedChainId})`}<br /></>}
              {arc.blockNumber && <>block {arc.blockNumber} · {arc.blockAgeSec} s old<br /></>}
              {arc.usdcDecimals !== undefined && <>USDC decimals {arc.usdcDecimals}{arc.usdcDecimals === 6 ? " ✓" : ""}<br /></>}
              {arc.reason && <span className="muted">{arc.reason}</span>}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Circle wallets</div>
            <span className={`badge ${tone(circ.status)}`}>{CIRCLE_TEXT[circ.status]}</span>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {circ.walletSet && <>wallet set {circ.walletSet}<br /></>}
              {circ.wallet && <>demo-funds wallet {circ.wallet.address} · {circ.wallet.state.toLowerCase()}<br /><b>{circ.wallet.usdc} USDC</b>{h.network.isTestnet && <span className="muted"> (test USDC)</span>}<br /></>}
              {circ.wallet === null && <span className="muted">demo-funds wallet not found in Circle<br /></span>}
              {circ.reason && <span className="muted">{circ.reason}</span>}
              {circ.status === "unreachable" && <span className="muted"><br />On a blocked ISP, turn on WARP and check again.</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
