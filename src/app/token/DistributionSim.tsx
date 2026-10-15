"use client";

import { useState } from "react";
import { distributionPreview, LIMITS, rp, units } from "@/lib/token-research-model";
import Info from "../components/Info";
import { Slider } from "./DesignModel";
import { useLocale, useT } from "@/i18n/client";

/** Profit distribution illustration: local state only. Not a claim right and not a declared payout. */
export default function DistributionSim() {
  const t = useT();
  const locale = useLocale();
  const [profit, setProfit] = useState("0");
  const [share, setShare] = useState(10);
  const [holders, setHolders] = useState("100");
  const d = distributionPreview({ monthlyProfitIdr: Number(profit), sharePct: share, holders: Number(holders) }, t);

  return (
    <div className="tok-two">
      <section className="card">
        <div className="tok-panel-head">
          <h2>{t("Distribution simulator")}</h2>
          <span className="badge warn">{t("Simulation · not an offer")}</span>
        </div>
        <div className="tok-fields">
          <label>
            {t("Monthly profit after tax and reserves (Rp)")}
            <input type="number" inputMode="numeric" min={0} max={LIMITS.profitMax} step={1000} value={profit}
              onChange={(e) => setProfit(e.target.value)} />
            <span className="tok-hint">{Number.isFinite(Number(profit)) ? rp(Number(profit)) : "—"}</span>
          </label>
          <Slider label={t("Share to holders")} value={share} onChange={setShare} max={100} unit="%" />
          <label>
            {t("Holders")}
            <input type="number" inputMode="numeric" min={1} max={LIMITS.holdersMax} step={1} value={holders}
              onChange={(e) => setHolders(e.target.value)} />
          </label>
        </div>
        <p className="tok-note">
          {t("Lawful profit only.")}
          <Info>{t("Never escrow, customer deposits, money owed to suppliers, tax held for others, or test USDC.")}</Info>
        </p>
      </section>

      <section className="tok-result" aria-live="polite">
        <span className="tok-loud">{t("Simulation · not a claim right")}</span>
        <span className="tok-result-label">{t("Pool in this scenario")}</span>
        <strong className="tok-result-big">{rp(d.poolIdr)}</strong>
        {d.ok ? (
          <dl className="kv-rows">
            <div><dt>{t("Per holder / month")}</dt><dd>{rp(d.perHolderIdr)}</dd></div>
            <div><dt>{t("Holders")}</dt><dd>{units(Number(holders), locale === "id" ? "id-ID" : "en")}</dd></div>
            <div><dt>{t("Left after even split")}</dt><dd>{rp(d.leftoverIdr)}</dd></div>
          </dl>
        ) : (
          <div className="alert bad tok-errors" role="alert"><ul>{d.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        <small>{t("Declares no profit share. Would need a legal instrument, approval and a funded pool.")}</small>
      </section>
    </div>
  );
}
