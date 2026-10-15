import Link from "next/link";
import { getDailyReview, listDailyReviews } from "@/lib/store";
import { dailyReviewHour, isDay, type DailyFacts } from "@/lib/agent/daily-review";
import { network } from "@/lib/network";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";
import ReviewButton from "./ReviewButton";
import Info from "../components/Info";

export const dynamic = "force-dynamic";

const time = (iso: string, locale: Locale) =>
  `${new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WIB`;
/** Thousands separator as each language writes it: 1,597 in English, 1.597 in Indonesian (like Rp1.650). */
const num = (locale: Locale) => (x: number) => x.toLocaleString(locale === "id" ? "id-ID" : "en");

/** The review text: "## Heading" lines become headings, "- " lines become list items. */
function ReviewText({ text }: { text: string }) {
  const blocks: { heading?: string; items: string[]; para: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.startsWith("## ");
    if (heading || blocks.length === 0) blocks.push({ heading: heading ? line.slice(3) : undefined, items: [], para: [] });
    if (heading) continue;
    const b = blocks[blocks.length - 1];
    if (/^[-*] /.test(line)) b.items.push(line.slice(2));
    else b.para.push(line);
  }
  return (
    <div>
      {blocks.map((b, i) => (
        <div key={i}>
          {b.heading && <h3 style={{ margin: "14px 0 4px" }}>{b.heading}</h3>}
          {b.para.map((p, j) => <p key={j} style={{ margin: "4px 0" }}>{p}</p>)}
          {b.items.length > 0 && <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}

function FactsTable({ f, t, locale }: { f: DailyFacts; t: T; locale: Locale }) {
  const c = f.chief;
  const tk = f.tasks;
  const n = num(locale);
  const rows: [string, string][] = [
    [t("Orders created"), t("{n} ({real} real, {simulated} simulated)", {
      n: f.orders.created.length, real: f.orders.createdReal, simulated: f.orders.createdSimulated,
    })],
    [t("Active now"), t("{real} real · {simulated} simulated", { real: f.orders.activeRealNow, simulated: f.orders.activeSimulatedNow })],
    [t("Plans chosen"), t("{chief} by the Chief · {person} by a person", { chief: f.plans.byAgent, person: f.plans.byHuman })],
    [t("Customer agreements"), String(f.agreements.count)],
    ...f.money.map((m): [string, string] => [
      t("Escrow {event} ({label} orders)", { event: t(m.event), label: t(m.orderLabel) }),
      `${t(m.count === 1 ? "{usdc} USDC (~{idr}) · {n} transfer · {network}" : "{usdc} USDC (~{idr}) · {n} transfers · {network}", {
        usdc: m.amountUsdc, idr: `Rp${m.amountIdrApprox.toLocaleString("id-ID")}`, n: m.count, network: m.network,
      })} ${m.testMoney ? t("(testnet, test USDC)") : t("(mainnet)")}`,
    ]),
    [t("Transfers pending now"), String(f.pendingTransfersNow)],
    [t("Operator tasks"), t("{opened} opened · {done} done · {open} open now", { opened: tk.opened, done: tk.done, open: tk.openNow }) +
      (tk.oldestOpen ? ` ${t("(oldest {hours} h, {order})", { hours: tk.oldestOpen.ageHours, order: tk.oldestOpen.orderId })}` : "")],
    [t("Chief runs"), t("{runs} ({woken} woken by the heartbeat)", { runs: c.runs, woken: c.heartbeatWakeups })],
    [t("Chief actions"), t("{logged} logged · {decisions} · {escalations} · {refused} refused by policy", {
      logged: c.toolCalls,
      decisions: t(c.decisions === 1 ? "{n} decision" : "{n} decisions", { n: c.decisions }),
      escalations: t(c.escalations === 1 ? "{n} escalation" : "{n} escalations", { n: c.escalations }),
      refused: c.refusals,
    })],
    [t("Messages to customers"), t("{chief} by the Chief · {people} by people", { chief: c.messagesToCustomers, people: c.messagesByPeople })],
    [t("Deadlines (next 3 days)"), f.deadlines.next3Days.map((o) => `${o.orderId} ${o.deadline}`).join(", ") || t("none")],
    [t("Overdue"), f.deadlines.overdue.map((o) => `${o.orderId} ${o.deadline}`).join(", ") || t("none")],
    [t("Printers online now"), `${f.printersNow.online} / ${f.printersNow.total}`],
    [t("Reputation"), f.reputation.score === null
      ? t("no finished real orders yet")
      : t("{score} / 100 ({n} finished)", { score: f.reputation.score, n: f.reputation.finished })],
    [t("Claude tokens (order runs)"), f.claudeTokens.logged
      ? t("{input} in · {output} out · {cache} cache read", {
        input: n(f.claudeTokens.input), output: n(f.claudeTokens.output), cache: n(f.claudeTokens.cacheRead),
      })
      : t("not logged")],
  ];
  if (c.refusalReasons.length) rows.push([t("Refusal reasons"), c.refusalReasons.map((x) => t(x)).join(" · ")]);
  return (
    <dl className="calc-kv">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getT();
  const locale = await getLocale();
  const n = num(locale);
  const { day } = await searchParams;
  const reviews = listDailyReviews();
  const shown = (typeof day === "string" && isDay(day) ? getDailyReview(day) : undefined) ?? reviews[0];
  const hour = dailyReviewHour();
  const net = network();
  return (
    <main className="wrap">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t("Daily review")}</p>
          <h1>{t("The Chief's daily report to the owner.")}</h1>
          <p className="page-sub">
            {t("Code counts the facts; Claude writes them up.")}
            {net.isTestnet && ` ${t("Money: test USDC on {network}.", { network: net.name })}`}{" "}
            <Info>
              {t("Claude gets no tools here; when Claude is off, a plain code template writes it.")}{" "}
              {hour === null
                ? t("The scheduled review is off (KESUNI_DAILY_REVIEW_HOUR=off).")
                : t("The heartbeat writes it once a day after {hour}:00 WIB.", { hour })}
            </Info>
          </p>
        </div>
        <div className="page-actions"><ReviewButton /></div>
      </header>

      {!shown && <p className="muted">{t("No reviews yet.")}</p>}
      {shown && (
        <section className="card">
          <h2>
            {t("Review {day}", { day: shown.day })}{" "}
            <span className={`badge ${shown.mode === "claude" ? "ok" : ""}`}>{shown.mode === "claude" ? `Claude · ${shown.model}` : t("code template")}</span>
          </h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {t("Written {time} ({by})", { time: time(shown.at, locale), by: shown.trigger === "schedule" ? t("by the heartbeat") : t("by hand") })}
            {shown.usage && ` · ${t("{input} in / {output} out tokens", { input: n(shown.usage.input_tokens), output: n(shown.usage.output_tokens) })}`}
          </p>
          {shown.error && <div className="alert bad" style={{ fontSize: 13 }}>{t("Code template used: {error}", { error: shown.error })}</div>}
          <ReviewText text={shown.text} />
          <h3 style={{ margin: "18px 0 6px" }}>{t("Facts behind it")}</h3>
          <FactsTable f={shown.facts as DailyFacts} t={t} locale={locale} />
          <div style={{ marginTop: 12 }}><ReviewButton day={shown.day} label={t("Rewrite review {day}", { day: shown.day })} /></div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="card">
          <h2>{t("All reviews")} <span className="badge">{reviews.length}</span></h2>
          <ul className="attention">
            {reviews.map((r) => (
              <li key={r.day}>
                <Link href={`/review?day=${r.day}`}>{r.day}</Link>{" "}
                <span className="muted">· {r.mode === "claude" ? "Claude" : t("code template")} · {time(r.at, locale)}</span>
                {shown?.day === r.day && <span className="badge" style={{ marginLeft: 6 }}>{t("shown")}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
