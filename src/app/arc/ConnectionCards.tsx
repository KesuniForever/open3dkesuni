"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ChainHealth } from "@/lib/chain-health";
import Icon from "../components/Icon";
import Info from "../components/Info";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale } from "@/i18n/core";

export interface ConnectionProps {
  netName: string;
  isTestnet: boolean;
  /** From arcConfig(): the chain id we expect and the RPC host only (never the full URL). null: not configured. */
  rpc: { chainId: number; host: string | null; custom: boolean } | null;
  explorer: string | null;
  payout: { short: string; url: string | null } | null;
  escrowWallets: number;
  customerWallets: number;
}

type Tone = "ok" | "bad" | "warn" | "";
const ARC: Record<ChainHealth["arc"]["status"], [string, Tone]> = {
  ok: ["Live · read only", "ok"], stale: ["Block is stale", "warn"], wrong_chain: ["Wrong chain", "bad"],
  bad_token: ["USDC mismatch", "bad"], unreachable: ["Unreachable", "bad"], not_configured: ["Not configured", ""],
};
const CIRCLE: Record<ChainHealth["circle"]["status"], [string, Tone]> = {
  ok: ["Reachable · read only", "ok"], unreachable: ["Unreachable", "bad"], not_configured: ["Not configured", "warn"],
};
const time = (iso: string, locale = "en-GB") =>
  `${new Date(iso).toLocaleTimeString(locale, { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`;
function Wait() {
  const t = useT();
  return <span className="arc-wait" aria-label={t("Loading")} />;
}

/** Arc Testnet and Circle Wallets, side by side. The live part loads after the page (GET /api/health/chain, read-only). */
export default function ConnectionCards(p: ConnectionProps) {
  const t = useT();
  const locale = useLocale();
  const [h, setH] = useState<ChainHealth | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback((fresh: boolean, alive: () => boolean = () => true) =>
    fetch(`/api/health/chain${fresh ? "?fresh=1" : ""}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((j: ChainHealth) => { if (alive()) { setH(j); setError(""); } })
      .catch(() => { if (alive()) setError("Could not load the network check."); })
      .finally(() => { if (alive()) setBusy(false); }), []);

  useEffect(() => {
    let alive = true;
    void load(false, () => alive);
    return () => { alive = false; };
  }, [load]);

  function checkNow() {
    setBusy(true);
    void load(true);
  }

  const arc = h?.arc;
  const circ = h?.circle;
  const [arcText, arcTone] = arc ? ARC[arc.status] : [busy ? "Checking…" : "Not checked", "" as Tone];
  const [circText, circTone] = circ ? CIRCLE[circ.status] : [busy ? "Checking…" : "Not checked", "" as Tone];
  const chainId = arc?.chainId ?? p.rpc?.chainId;
  const blockUrl = p.explorer && arc?.blockNumber ? `${p.explorer}/block/${arc.blockNumber}` : null;
  const checked = h ? t("Checked {time}", { time: time(h.at, dateLocale(locale)) }) : "";
  const check = (
    <button type="button" className="primary" onClick={checkNow} disabled={busy}>
      <Icon name="pulse" size={16} />{busy ? t("Checking…") : t("Check now")}
    </button>
  );

  return (
    <>
      {error && <div className="alert bad arc-alert">{t(error)}</div>}
      <div className="arc-grid">
        <section className="arc-card">
          <div className="arc-top">
            <span className="arc-mark green"><Icon name="network" size={24} /></span>
            <span className={`badge ${arcTone}`}>{t(arcText)}</span>
          </div>
          <h2>{p.netName}</h2>
          <p className="arc-line">{t("Blocks and receipts, read from the RPC.")}</p>
          <dl className="kv-rows arc-facts">
            <div>
              <dt>{t("Network")}</dt>
              <dd>
                {chainId ?? "—"} · {p.isTestnet ? "Testnet" : "Mainnet"}
                {arc?.chainId !== undefined && arc.expectedChainId !== undefined && arc.chainId !== arc.expectedChainId && (
                  <span className="bad-text"> {t("(expected {n})", { n: arc.expectedChainId })}</span>
                )}
              </dd>
            </div>
            <div>
              <dt>{t("Latest block")}</dt>
              <dd>
                {arc?.blockNumber
                  ? <>#{arc.blockNumber}<span className="muted"> · {t("{n} s ago", { n: arc.blockAgeSec ?? "" })}</span></>
                  : busy ? <Wait /> : "—"}
              </dd>
            </div>
            <div>
              <dt>
                {t("USDC decimals")}{" "}
                <Info>{t("USDC on Arc has one balance with two views: native gas (18 decimals) and ERC-20 (6). Checks use the ERC-20 view.")}</Info>
              </dt>
              <dd>{arc?.usdcDecimals !== undefined ? <>{arc.usdcDecimals}{arc.usdcDecimals === 6 && <span className="arc-tick"> ✓</span>}</> : busy ? <Wait /> : "—"}</dd>
            </div>
            <div>
              <dt>RPC</dt>
              <dd className="mono">{p.rpc?.host ?? "—"}{p.rpc?.custom && <span className="muted"> {t("(own)")}</span>}</dd>
            </div>
            <div><dt>{t("Sending funds")}</dt><dd>{t("Not from here")}</dd></div>
          </dl>
          {arc?.reason && <p className="arc-reason">{t(arc.reason)}</p>}
          <div className="arc-actions">
            {check}
            {blockUrl && (
              <a className="btn-link ghost" href={blockUrl} target="_blank" rel="noreferrer">{t("Block in explorer")} <Icon name="arrow" size={15} /></a>
            )}
          </div>
          <small className="arc-caption">{checked ? `${checked} · ` : ""}{t("no key, wallet or signature needed")}</small>
        </section>

        <section className="arc-card">
          <div className="arc-top">
            <span className="arc-mark blue"><Icon name="wallet" size={24} /></span>
            <span className={`badge ${circTone}`}>{t(circText)}</span>
          </div>
          <h2>{t("Circle Wallets")}</h2>
          <p className="arc-line">{t("Developer-controlled wallets on {net}.", { net: p.netName })}</p>
          <dl className="kv-rows arc-facts">
            <div>
              <dt>{t("Wallet set")}</dt>
              <dd>{circ?.walletSet ? t(circ.walletSet) : busy ? <Wait /> : "—"}</dd>
            </div>
            <div>
              <dt>
                {t("Demo funds")}{" "}
                <Info>{t("Kesuni's own wallet that tops up test customer wallets. Internal: never counted as a payment.")}</Info>
              </dt>
              <dd>
                {circ?.wallet ? (
                  <><span className="mono">{circ.wallet.address}</span> · <b>{circ.wallet.usdc}</b> {p.isTestnet ? t("test USDC") : "USDC"}</>
                ) : circ?.wallet === null ? t("Not found in Circle") : busy ? <Wait /> : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Kesuni payout")}</dt>
              <dd>
                {p.payout ? (
                  p.payout.url
                    ? <a className="mono" href={p.payout.url} target="_blank" rel="noreferrer">{p.payout.short}</a>
                    : <span className="mono">{p.payout.short}</span>
                ) : t("Not set")}
              </dd>
            </div>
            <div>
              <dt>{t("Escrow wallets")}</dt>
              <dd>{p.escrowWallets}<span className="muted"> · {t("{n} customer", { n: p.customerWallets })}</span></dd>
            </div>
            <div><dt>{t("Sending funds")}</dt><dd>{t("Not from here")}</dd></div>
          </dl>
          {circ?.reason && <p className="arc-reason">{t(circ.reason)}</p>}
          <div className="arc-actions">
            {check}
            <Link className="btn-link ghost" href="/arc?tab=wallets" scroll={false}>{t("All wallets")} <Icon name="chevron" size={15} /></Link>
          </div>
          <small className="arc-caption">
            {circ?.status === "unreachable"
              ? t("Blocked ISP? Turn on WARP and check again.")
              : `${checked ? `${checked} · ` : ""}${t("keys stay on the server")}`}
          </small>
        </section>
      </div>
    </>
  );
}
