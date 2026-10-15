"use client";

import { useState } from "react";
import { allocationModel, LIMITS, teamUnlockedPct, teamUnlockedUnits, units, type SliceId } from "@/lib/token-research-model";
import Info from "../components/Info";
import { useLocale, useT } from "@/i18n/client";

const COLOR: Record<SliceId, string> = { community: "var(--lime-strong)", team: "var(--primary)", treasury: "#c9d1da" };

export function Slider({ label, value, onChange, max, unit }: {
  label: string; value: number; onChange: (v: number) => void; max: number; unit: string;
}) {
  return (
    <label className="tok-range">
      <span className="tok-range-head"><span>{label}</span><b>{value}{unit}</b></span>
      <input type="range" min={0} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Allocation & vesting model: local state only, nothing is saved, issued or offered. */
export default function DesignModel() {
  const t = useT();
  const locale = useLocale();
  const num = (n: number) => units(n, locale === "id" ? "id-ID" : "en");
  const [supply, setSupply] = useState("1000000");
  const [community, setCommunity] = useState(50);
  const [team, setTeam] = useState(20);
  const [treasury, setTreasury] = useState(30);
  const [cliff, setCliff] = useState(12);
  const [vesting, setVesting] = useState(36);
  const m = allocationModel({
    supply: Number(supply), communityPct: community, teamPct: team, treasuryPct: treasury, cliffMonths: cliff, vestingMonths: vesting,
  }, t);
  const mo = ` ${t("mo")}`;
  const span = Math.max(1, m.teamFullMonth);
  const teamUnits = m.slices.find((s) => s.id === "team")?.units ?? 0;

  return (
    <div className="tok-two">
      <section className="card">
        <div className="tok-panel-head">
          <h2>{t("Allocation model")}</h2>
          <span className="badge warn">{t("Simulation · not an offer")}</span>
        </div>
        <div className="tok-fields">
          <label>
            {t("Total supply (model units)")}
            <input type="number" inputMode="numeric" min={1} max={LIMITS.supplyMax} step={1} value={supply}
              onChange={(e) => setSupply(e.target.value)} />
          </label>
          <Slider label={t("Community")} value={community} onChange={setCommunity} max={100} unit="%" />
          <Slider label={t("Team")} value={team} onChange={setTeam} max={100} unit="%" />
          <Slider label={t("Treasury")} value={treasury} onChange={setTreasury} max={100} unit="%" />
          <div className="tok-fields two">
            <Slider label={t("Team cliff")} value={cliff} onChange={setCliff} max={LIMITS.cliffMax} unit={mo} />
            <Slider label={t("Team vesting")} value={vesting} onChange={setVesting} max={LIMITS.vestingMax} unit={mo} />
          </div>
        </div>
        <p className="tok-note">
          {t("Internal model, not issued.")}
          <Info>{t("No ticker, contract address or price. Model units are not company assets or cash. Nothing here is saved.")}</Info>
        </p>
      </section>

      <section className="card">
        <div className="tok-panel-head">
          <h2>{t("Allocation preview")}</h2>
          <span className={`badge ${m.totalPct === 100 ? "ok" : "bad"}`}>{t("Total {pct}%", { pct: m.totalPct })}</span>
        </div>
        {!m.ok ? (
          <div className="alert bad tok-errors" role="alert">
            <ul>{m.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        ) : (
          <>
            <div className="tok-stack" role="img"
              aria-label={m.slices.map((s) => `${s.label} ${s.pct}%`).join(", ")}>
              {m.slices.map((s) => <span key={s.id} style={{ width: `${s.pct}%`, background: COLOR[s.id] }} title={`${s.label} ${s.pct}%`} />)}
            </div>
            <dl className="kv-rows">
              {m.slices.map((s) => (
                <div key={s.id}>
                  <dt><span className="tok-dot" style={{ background: COLOR[s.id] }} />{s.label} · {s.pct}%</dt>
                  <dd>{t("{n} units", { n: num(s.units) })}</dd>
                </div>
              ))}
            </dl>
            <p className="tok-sub">{t("Team unlock")}</p>
            <div className="tok-vest" role="img"
              aria-label={t("Locked for {cliff} months, then unlocks over {vesting} months, fully at month {month}", { cliff, vesting, month: m.teamFullMonth })}>
              {cliff > 0 && <span className="cliff" style={{ width: `${(cliff / span) * 100}%` }} />}
              {vesting > 0 && <span className="linear" style={{ width: `${(vesting / span) * 100}%` }} />}
            </div>
            <div className="tok-vest-scale">
              <span>{t("Month {n}", { n: 0 })}</span>
              {cliff > 0 && vesting > 0 && <span>{t("Cliff ends · month {n}", { n: cliff })}</span>}
              <span>{t("Fully unlocked · month {n}", { n: m.teamFullMonth })}</span>
            </div>
            <dl className="tok-unlock">
              {[12, 24, 36, 48].map((month) => {
                const pct = teamUnlockedPct(month, cliff, vesting);
                return (
                  <div key={month}>
                    <dt>{t("Month {n}", { n: month })}</dt>
                    <dd>{Math.round(pct)}%</dd>
                    <span>{t("{n} units", { n: num(teamUnlockedUnits(teamUnits, month, cliff, vesting)) })}</span>
                  </div>
                );
              })}
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
