"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ChainHealth } from "@/lib/chain-health";
import { dateLocale, type Locale } from "@/i18n/core";
import { useLocale, useT } from "@/i18n/client";
import Info from "./Info";

const ARC_TEXT: Record<ChainHealth["arc"]["status"], string> = {
  ok: "live", stale: "stale", wrong_chain: "wrong chain", bad_token: "USDC mismatch", unreachable: "unreachable", not_configured: "not configured",
};
const CIRCLE_TEXT: Record<ChainHealth["circle"]["status"], string> = { ok: "reachable", unreachable: "unreachable", not_configured: "not configured" };
const tone = (s: string) => (s === "ok" ? "ok" : s === "stale" || s === "not_configured" ? "" : "bad");
const time = (iso: string, locale: Locale) =>
  `${new Date(iso).toLocaleTimeString(dateLocale(locale), { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`;

/** Arc RPC and Circle health, loaded after the page so a slow or blocked network never delays or breaks it. */
export default function ChainHealthCard() {
  const t = useT();
  const locale = useLocale();
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
        <Info>
          {h
            ? t("Read-only checks of the networks the escrow runs on ({name}); nothing is sent.", { name: h.network.name })
            : t("Read-only checks of the networks the escrow runs on; nothing is sent.")}
          {h && ` ${h.cached ? t("Checked {time} (refreshes every minute).", { time: time(h.at, locale) }) : t("Checked {time}.", { time: time(h.at, locale) })}`}
        </Info>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontWeight: 400, fontSize: 13 }}>
          <Link href="/arc?tab=check">{t("Check a transaction")}</Link>
          <button onClick={checkNow} disabled={busy}>{busy ? t("Checking…") : t("Check now")}</button>
        </span>
      </h2>
      {error && <div className="alert bad" style={{ fontSize: 13 }}>{t(error)}</div>}
      {!h && !error && <p className="muted">{t("Checking Arc and Circle…")}</p>}
      {arc && circ && (
        <p className="status-line" style={{ marginBottom: 4 }}>
          <span>Arc <span className={`badge ${tone(arc.status)}`}>{t(ARC_TEXT[arc.status])}</span></span>
          <span>Circle <span className={`badge ${tone(circ.status)}`}>{t(CIRCLE_TEXT[circ.status])}</span></span>
          {circ.wallet && <span>{t("Demo funds")} <b>{circ.wallet.usdc} USDC</b>{h.network.isTestnet && <span className="muted"> {t("(test)")}</span>}</span>}
        </p>
      )}
      {arc && circ && (
        <details className="fold" open={arc.status !== "ok" || circ.status !== "ok"}>
        <summary>{t("Details")}</summary>
        <div className="grid">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Arc RPC</div>
            <span className={`badge ${tone(arc.status)}`}>{t(ARC_TEXT[arc.status])}</span>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {arc.chainId !== undefined && <>{t("chain {id}", { id: arc.chainId })}{arc.chainId === arc.expectedChainId ? " ✓" : ` ${t("(expected {id})", { id: String(arc.expectedChainId) })}`}<br /></>}
              {arc.blockNumber && <>{t("block {n} · {s} s old", { n: arc.blockNumber, s: arc.blockAgeSec ?? "" })}<br /></>}
              {arc.usdcDecimals !== undefined && <>{t("USDC decimals {n}", { n: arc.usdcDecimals })}{arc.usdcDecimals === 6 ? " ✓" : ""}<br /></>}
              {arc.reason && <span className="muted">{t(arc.reason)}</span>}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>{t("Circle wallets")}</div>
            <span className={`badge ${tone(circ.status)}`}>{t(CIRCLE_TEXT[circ.status])}</span>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {circ.walletSet && <>{t("wallet set {state}", { state: t(circ.walletSet) })}<br /></>}
              {circ.wallet && <>{t("demo-funds wallet {address} · {state}", { address: circ.wallet.address, state: circ.wallet.state.toLowerCase() })}<br /><b>{circ.wallet.usdc} USDC</b>{h.network.isTestnet && <span className="muted"> {t("(test USDC)")}</span>}<br /></>}
              {circ.wallet === null && <span className="muted">{t("demo-funds wallet not found in Circle")}<br /></span>}
              {circ.reason && <span className="muted">{t(circ.reason)}</span>}
              {circ.status === "unreachable" && <span className="muted"><br />{t("On a blocked ISP, turn on WARP and check again.")}</span>}
            </div>
          </div>
        </div>
        </details>
      )}
    </section>
  );
}
