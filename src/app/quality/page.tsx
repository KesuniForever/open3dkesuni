import Link from "next/link";
import "./quality.css";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Callout from "../components/Callout";
import Info from "../components/Info";
import Icon, { type IconName } from "../components/Icon";
import WeightCalculator from "../components/WeightCalculator";
import CostCalculator from "../components/CostCalculator";
import { listOrders, listVendors } from "@/lib/store";
import { idrPerUsdc } from "@/lib/costing";
import { pricingConfig } from "@/lib/pricing";
import { ownerRules } from "@/lib/owner-rules";
import { reputation } from "@/lib/reputation";
import {
  marginRows, partnerRows, qualityOverview, reputationParts, reviewRows,
  type MarginRow, type QualityRow, type QualitySummary,
} from "@/lib/quality";
import { getLocale, getT } from "@/i18n/server";
import { dateLocale, type Locale, type T } from "@/i18n/core";

export const dynamic = "force-dynamic";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const day = (iso: string, locale: Locale) => new Date(iso).toLocaleDateString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** t("{n} review") / t("{n} reviews"): the English stays "1 review", "2 reviews"; Indonesian has one form. */
const plural = (t: T, n: number, one: string, many: string) => t(n === 1 ? one : many, { n });

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getT();
  const locale = await getLocale();
  const orders = listOrders();
  const q = qualityOverview(orders);
  const vendors = listVendors();
  const tabs: Tab[] = [
    { id: "cost", label: t("Costs & margin") },
    { id: "qc", label: t("Agreements & QC"), count: q.rows.length },
    { id: "partners", label: t("Production partners"), count: vendors.length },
    { id: "reputation", label: t("Reputation") },
  ];
  const tab = pickTab(tabs, (await searchParams).tab);
  const { real, simulated: sim } = q;

  return (
    <main className="wrap qual">
      <PageHead eyebrow={t("Value & quality")} title={t("Healthy profits. Worthwhile results.")}
        sub={t("Clear costs, agreed quality and a reputation built from finished work.")}
        actions={<>
          <Link href="/orders" className="btn-link ghost">{t("Orders")}</Link>
          <Link href="/calculator" className="btn-link"><Icon name="calculator" size={16} />{t("Price calculator")}</Link>
        </>} />

      <Callout icon="shield" title={t("Healthy business. Worthwhile results.")}
        aside={<span className="badge real">{t("Real orders only")}</span>}>
        {t("Kesuni keeps its margin. Customers know what they pay for and how it is checked.")}
      </Callout>

      <div className="stat-grid">
        <Stat icon="check" label={t("QC pass rate")}
          info={t("Real orders the customer accepted against the agreed quality check, out of all accepted or rejected. Simulated: {accepted} of {decided} accepted, not counted.", { accepted: sim.accepted, decided: sim.decided })}
          value={real.passRatePct} unit="%" sub={real.decided ? t("{n} of {total} accepted", { n: real.accepted, total: real.decided }) : t("No real results yet")} />
        <Stat icon="calendar" label={t("On time")}
          info={t("Finished real orders accepted by the end of their deadline day (Jakarta time). Simulated: {onTime} of {finished}, not counted.", { onTime: sim.onTime, finished: sim.finished })}
          value={real.onTimePct} unit="%" sub={real.finished ? t("{n} of {total} finished", { n: real.onTime, total: real.finished }) : t("No finished real orders yet")} />
        <Stat icon="star" label={t("Average review")}
          info={t("Mean of the quality, communication and worth-the-price stars on real orders. Simulated reviews: {n}, not counted.", { n: sim.reviews })}
          value={real.avgReview} unit="/ 5" sub={real.reviews ? plural(t, real.reviews, "{n} review", "{n} reviews") : t("No real reviews yet")} />
        <Stat icon="shield" label={t("Agreed orders")}
          info={t("The customer approved this exact spec, quality promise and price before paying (SHA-256 fingerprint). Simulated: {n}.", { n: sim.agreed })}
          value={real.agreed} unit={t("of {n} real", { n: real.orders })} sub={real.orders ? t("{n} without a current agreement", { n: real.orders - real.agreed }) : t("No real orders yet")} />
      </div>

      <Tabs tabs={tabs} active={tab} basePath="/quality" />

      {tab === "cost" && <CostTab t={t} />}
      {tab === "qc" && <QcTab t={t} locale={locale} rows={q.rows} real={real} sim={sim} />}
      {tab === "partners" && <PartnersTab t={t} />}
      {tab === "reputation" && <ReputationTab t={t} locale={locale} />}
    </main>
  );
}

function Stat({ icon, label, info, value, unit, sub }: {
  icon: IconName; label: string; info: React.ReactNode; value: number | null; unit: string; sub: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label"><span>{label} <Info>{info}</Info></span><Icon name={icon} /></span>
      <b>{value === null ? "—" : value}{value !== null && <small className="stat-unit">{unit}</small>}</b>
      <span className="muted">{sub}</span>
    </div>
  );
}

// ---------- Costs & margin ----------

function CostTab({ t }: { t: T }) {
  const rules = ownerRules();
  const pricing = pricingConfig();
  const gramMargin = pricing.pricePerGramIdr > 0
    ? Math.round(((pricing.pricePerGramIdr - pricing.costPerGramIdr) / pricing.pricePerGramIdr) * 100) : 0;
  const margins = marginRows(undefined, rules.minMarginPct);
  const real = margins.filter((m) => m.real);
  const sim = margins.filter((m) => !m.real);
  const tiles: { value: string; label: string; detail: string }[] = [
    { value: rp(pricing.pricePerGramIdr), label: t("Price per gram"), detail: t("Rounded up to {amount} per piece", { amount: rp(pricing.roundIdr) }) },
    { value: `${rules.minMarginPct}%`, label: t("Minimum margin"), detail: t("Lowest the Chief may price at") },
    { value: rp(rules.minOrderIdr), label: t("Minimum order"), detail: t("Below it: owner approval") },
    { value: rp(rules.partnerMinIdr), label: t("Partners from"), detail: t("Smaller orders stay in-house") },
  ];
  return (
    <>
      <div className="qual-rules">
        {tiles.map((tile, i) => (
          <div key={tile.label} className="qual-rule">
            <span className="qual-rule-n">0{i + 1}</span>
            <div>
              <span className="qual-rule-label">{tile.label}</span>
              <b>{tile.value}</b>
              <small>{tile.detail}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="qual-two">
        <WeightCalculator pricing={pricing} />
        <section className="card qual-margin-card">
          <h2>
            {t("Margin")}
            <Info>{t("At the official price per gram, after Kesuni's cost per gram (filament, finishing, print hours, electricity). The Chief may not price under the owner's minimum.")}</Info>
          </h2>
          <div className="qual-meter-head">
            <b>{gramMargin}%</b>
            <span className="muted">{t("per gram: {price} price, {cost} cost", { price: rp(pricing.pricePerGramIdr), cost: rp(pricing.costPerGramIdr) })}</span>
          </div>
          <div className="qual-meter" role="img" aria-label={t("Cost {cost}%, margin {margin}%, owner minimum {min}%", { cost: 100 - gramMargin, margin: gramMargin, min: rules.minMarginPct })}>
            <span className="qual-meter-cost" style={{ width: `${Math.max(0, 100 - gramMargin)}%` }} />
            <span className="qual-meter-margin" style={{ width: `${Math.max(0, gramMargin)}%` }} />
            <i className="qual-meter-min" style={{ left: `${100 - rules.minMarginPct}%` }} />
          </div>
          <div className="qual-meter-legend">
            <span><i className="qual-dot cost" />{t("Cost")}</span>
            <span><i className="qual-dot margin" />{t("Margin")}</span>
            <span><i className="qual-dot min" />{t("Minimum {n}%", { n: rules.minMarginPct })}</span>
          </div>
          <h3 className="qual-sub">
            {t("Real quotes")}
            <Info>{t("Kesuni's own price on each real order against its planned cost and, once production reported it, the actual cost. Under {n}% is flagged.", { n: rules.minMarginPct })}</Info>
          </h3>
          {real.length === 0
            ? <p className="qual-empty-box"><Icon name="tag" size={16} />{t("No real orders priced by Kesuni yet.")}</p>
            : <MarginList t={t} rows={real} />}
          {sim.length > 0 && (
            <details className="fold">
              <summary>{t("Simulated orders ({n}, not counted)", { n: sim.length })}</summary>
              <MarginList t={t} rows={sim} />
            </details>
          )}
        </section>
      </div>

      <div className="section-head qual-section">
        <p className="eyebrow">{t("Cost check")}</p>
        <h2>{t("Know what the work really costs.")}
          <Info>{t("The official price stays per gram (above). This calculator only checks that it still covers material, power, labour, machine wear and a reprint reserve.")}</Info>
        </h2>
      </div>
      <CostCalculator idrPerUsdc={idrPerUsdc()} />
    </>
  );
}

function MarginList({ t, rows }: { t: T; rows: MarginRow[] }) {
  return (
    <ul className="qual-margins">
      {rows.map((m) => (
        <li key={m.orderId}>
          <Link href={`/orders/${m.orderId}`} className="qual-margin-name">
            <b className="one-line">{m.product}</b>
            <span className="muted">{m.orderId} · {rp(m.priceIdr)} · {m.method === "weight" ? t("by weight") : t("calculator")}</span>
          </Link>
          <span className="qual-margin-nums">
            <span className={`badge ${m.plannedMarginPct < 0 || m.belowMin ? "bad" : "ok"}`}>{t("plan {n}%", { n: m.plannedMarginPct })}</span>
            {m.actualMarginPct !== null
              ? <span className={`badge ${m.belowMin ? "bad" : "ok"}`}>{t("actual {n}%", { n: m.actualMarginPct })}</span>
              : <span className="badge">{t("no actual yet")}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Agreements & QC ----------

function QcTab({ t, locale, rows, real, sim }: { t: T; locale: Locale; rows: QualityRow[]; real: QualitySummary; sim: QualitySummary }) {
  return (
    <>
      <section className="card">
        <h2>
          {t("Results")}
          <Info>{t("Pass rate = accepted ÷ (accepted + rejected) by the customer. Simulated orders are tests: shown for reference, never counted.")}</Info>
        </h2>
        <div className="table-wrap">
          <table className="qual-results">
            <thead>
              <tr><th></th><th>{t("Orders")}</th><th>{t("Agreed")}</th><th>{t("QC on file")}</th><th>{t("Accepted")}</th><th>{t("Rejected")}</th><th>{t("Pass rate")}</th></tr>
            </thead>
            <tbody>
              <SummaryRow t={t} label="real" s={real} />
              <SummaryRow t={t} label="simulated" s={sim} />
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>
          {t("Per order")}
          <Info>{t("Agreement: the customer approved spec + quality promise + price. QC: photos and checks on file. Plan vs actual: the operator's report after printing. Result: the customer's accept or reject.")}</Info>
        </h2>
        {rows.length === 0 ? <p className="muted qual-empty">{t("No orders yet.")}</p> : (
          <div className="qual-table" role="table" aria-label={t("Agreements and QC per order")}>
            <div className="qual-tr qual-th" role="row">
              <span role="columnheader">{t("Order")}</span>
              <span role="columnheader">{t("Agreement")}</span>
              <span role="columnheader">{t("QC evidence")}</span>
              <span role="columnheader">{t("Plan vs actual")}</span>
              <span role="columnheader">{t("Result")}</span>
            </div>
            {rows.map((r) => <QcRowView key={r.orderId} t={t} locale={locale} r={r} />)}
          </div>
        )}
      </section>
    </>
  );
}

function SummaryRow({ t, label, s }: { t: T; label: "real" | "simulated"; s: QualitySummary }) {
  return (
    <tr className={label === "simulated" ? "qual-sim-row" : undefined}>
      <th scope="row"><span className={`badge ${label}`}>{t(label)}</span>{label === "simulated" && <small className="muted"> {t("not counted")}</small>}</th>
      <td>{s.orders}</td>
      <td>{s.agreed}</td>
      <td>{s.withQcEvidence}</td>
      <td>{s.accepted}</td>
      <td>{s.rejected}</td>
      <td><b>{s.passRatePct === null ? "—" : `${s.passRatePct}%`}</b></td>
    </tr>
  );
}

const AGREEMENT: Record<QualityRow["agreement"], { text: string; tone: string }> = {
  agreed: { text: "Agreed", tone: "ok" },
  changed: { text: "Changed since", tone: "bad" },
  spec: { text: "Not approved", tone: "warn" },
  none: { text: "No spec", tone: "" },
};

function QcRowView({ t, locale, r }: { t: T; locale: Locale; r: QualityRow }) {
  const a = AGREEMENT[r.agreement];
  const ev = [
    r.evidence.photo && plural(t, r.evidence.photo, "{n} photo", "{n} photos"),
    r.evidence.qc && plural(t, r.evidence.qc, "{n} QC check", "{n} QC checks"),
    r.evidence.log && plural(t, r.evidence.log, "{n} log", "{n} logs"),
  ].filter(Boolean) as string[];
  const x = r.actual;
  return (
    <div className="qual-tr" role="row">
      <span role="cell" className="qual-order">
        <Link href={`/orders/${r.orderId}`}><b className="one-line">{r.product}</b></Link>
        <span className="muted">{r.orderId} · {plural(t, r.quantity, "{n} unit", "{n} units")} · <span className={`badge ${r.real ? "real" : "simulated"}`}>{r.real ? t("real") : t("simulated")}</span></span>
      </span>
      <span role="cell" data-label={t("Agreement")}>
        <span className={`badge ${a.tone}`}>{t(a.text)}{r.agreement === "agreed" && r.agreementVersion ? ` v${r.agreementVersion}` : ""}</span>
        {r.promise && <span className="muted qual-promise" title={r.promise}>{r.promise}</span>}
      </span>
      <span role="cell" data-label={t("QC evidence")} className={ev.length ? "" : "muted"}>
        {ev.length ? ev.join(" · ") : t("None yet")}
      </span>
      <span role="cell" data-label={t("Plan vs actual")}>
        {x ? (
          <span className="qual-actual">
            <span>{t("{passed}/{total} passed first time", { passed: x.unitsPassed, total: x.quantity })}</span>
            <span>
              ±{x.maxDeviationMm} mm
              {x.withinTolerance !== null && <span className={`badge ${x.withinTolerance ? "ok" : "bad"}`}>{t(x.withinTolerance ? "in {n} mm" : "over {n} mm", { n: x.toleranceMm ?? "" })}</span>}
            </span>
            <span className="muted">{rp(x.actualCostIdr)}{x.plannedCostIdr !== null && ` ${t("vs {amount} plan", { amount: rp(x.plannedCostIdr) })}`}</span>
          </span>
        ) : <span className="muted">{t("No report yet")}</span>}
      </span>
      <span role="cell" data-label={t("Result")}>
        {r.result === "waiting" ? <span className="muted">{t("Waiting")}</span> : (
          <span className="qual-actual">
            <span className={`badge ${r.result === "accepted" ? "ok" : "bad"}`}>{t(r.result)}</span>
            <span className="muted">
              {r.decidedAt && day(r.decidedAt, locale)}
              {r.onTime !== null && <> · {r.onTime ? t("on time") : t("late")}</>}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

// ---------- Production partners ----------

function PartnersTab({ t }: { t: T }) {
  const rules = ownerRules();
  const rows = partnerRows();
  const own = rows.filter((p) => p.own);
  const realPartners = rows.filter((p) => !p.own && !p.simulated);
  const demo = rows.filter((p) => !p.own && p.simulated);
  return (
    <>
      <Callout icon="network" tone="blue" title={t("Partners only for orders from {amount}.", { amount: rp(rules.partnerMinIdr) })}>
        {t("Smaller orders stay in Kesuni's studio. Kesuni keeps {n}% when a partner prints.", { n: rules.partnerMarginPct })}
      </Callout>
      <div className="tile-grid">
        {own.map((p) => <PartnerTile key={p.id} t={t} p={p} />)}
        {realPartners.map((p) => <PartnerTile key={p.id} t={t} p={p} />)}
        {realPartners.length === 0 && (
          <div className="tile qual-empty-tile">
            <div className="tile-head"><span className="tile-icon"><Icon name="network" /></span></div>
            <h3>{t("No real production partners yet")}</h3>
            <p>{t("Every real order is printed in-house.")}</p>
          </div>
        )}
        {demo.map((p) => <PartnerTile key={p.id} t={t} p={p} />)}
      </div>
    </>
  );
}

function PartnerTile({ t, p }: { t: T; p: ReturnType<typeof partnerRows>[number] }) {
  return (
    <div className="tile">
      <div className="tile-head">
        <span className={`tile-icon${p.simulated ? " qual-tile-sim" : ""}`}><Icon name={p.own ? "printer" : "network"} /></span>
        <span className="qual-badges">
          <span className="badge">{p.own ? "Kesuni" : t("Partner")}</span>
          {p.simulated ? <span className="badge simulated">{t("simulated")}</span>
            : <span className={`badge ${p.approved ? "ok" : "warn"}`}>{p.approved ? t("approved") : t("not approved")}</span>}
        </span>
      </div>
      <h3>{p.name}</h3>
      {p.simulated && <p>{t("Demo only, for simulated orders.")}</p>}
      <dl className="kv-rows">
        <div><dt>{t("Payout wallet")}</dt><dd className={p.placeholderAddress ? "muted" : "mono"}>{p.placeholderAddress ? t("Placeholder") : shortAddr(p.address)}</dd></div>
        <div><dt>{t("Quotes on real orders")}</dt><dd>{p.quotes.real}</dd></div>
        <div><dt>{t("Chosen on real orders")}</dt><dd>{p.chosen.real}</dd></div>
        <div><dt>{t("Quotes on simulated orders")}</dt><dd className="muted">{p.quotes.simulated}</dd></div>
      </dl>
    </div>
  );
}

// ---------- Reputation ----------

const EVIDENCE: Record<string, { text: string; tone: string }> = {
  none: { text: "No evidence yet", tone: "" },
  limited: { text: "Limited evidence", tone: "warn" },
  solid: { text: "Solid evidence", tone: "ok" },
};

function ReputationTab({ t, locale }: { t: T; locale: Locale }) {
  const r = reputation();
  const parts = reputationParts(r);
  const reviews = reviewRows();
  const realReviews = reviews.filter((x) => x.real);
  const simReviews = reviews.filter((x) => !x.real);
  const ev = EVIDENCE[r.evidence];
  return (
    <>
      <div className="qual-rep">
        <section className="card qual-score">
          <p className="eyebrow">{t("Reputation from results")}</p>
          <div className="qual-score-n">{r.score ?? "—"}<small>/ 100</small></div>
          <span className={`badge ${ev.tone}`}>{t(ev.text)}</span>
          <p className="muted">{r.finished
            ? t("From {orders} and {reviews}.", {
              orders: plural(t, r.finished, "{n} finished real order", "{n} finished real orders"),
              reviews: plural(t, r.reviews, "{n} review", "{n} reviews"),
            })
            : t("Shown after the first finished real order.")}</p>
        </section>
        <section className="card">
          <h2>
            {t("What the score weighs")}
            <Info>{t("Each part starts at a neutral 70/100 worth three orders, so one order cannot swing the score. Real orders only; simulated orders never count.")}</Info>
          </h2>
          <div className="qual-weights">
            {parts.map((p) => (
              <div key={p.label} className="qual-weight">
                <b>{p.weightPct}%</b>
                <span>{t(p.label)}</span>
                <small className={p.value === null ? "muted" : ""}>{p.value ?? "—"}</small>
              </div>
            ))}
          </div>
          <details className="fold qual-fold">
            <summary>{t("How it is counted")}</summary>
            <p className="muted">
              {t("Order count adds confidence, not points. On time = accepted by the end of the deadline day. Passed first time = units that passed QC without rework, from the operator's report. Under 5 finished orders the evidence is limited.")}
            </p>
          </details>
        </section>
      </div>

      <section className="card">
        <h2>{t("Customer reviews")} {realReviews.length > 0 && <span className="badge">{realReviews.length}</span>}</h2>
        {realReviews.length === 0
          ? <p className="muted qual-empty">{t("No real customer reviews yet. Customers can review after they accept the item.")}</p>
          : <ReviewList t={t} locale={locale} rows={realReviews} />}
        {simReviews.length > 0 && (
          <details className="fold qual-fold">
            <summary>{t("Simulated reviews ({n}, not counted)", { n: simReviews.length })}</summary>
            <ReviewList t={t} locale={locale} rows={simReviews} />
          </details>
        )}
      </section>
    </>
  );
}

function ReviewList({ t, locale, rows }: { t: T; locale: Locale; rows: ReturnType<typeof reviewRows> }) {
  return (
    <ul className="qual-reviews">
      {rows.map((x) => (
        <li key={x.orderId}>
          <div className="qual-review-head">
            <span className="qual-stars"><Icon name="star" size={15} /> {x.avg}</span>
            <Link href={`/orders/${x.orderId}`} className="one-line">{x.product}</Link>
            {!x.real && <span className="badge simulated">{t("simulated")}</span>}
          </div>
          {x.review.text && <p>{x.review.text}</p>}
          <small className="muted">
            {t("Quality {quality} · communication {communication} · worth the price {value}", { quality: x.review.quality, communication: x.review.communication, value: x.review.value })} · {x.review.by} · {day(x.review.at, locale)}
          </small>
        </li>
      ))}
    </ul>
  );
}
