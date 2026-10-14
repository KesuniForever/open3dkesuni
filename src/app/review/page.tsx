import Link from "next/link";
import { getDailyReview, listDailyReviews } from "@/lib/store";
import { dailyReviewHour, isDay, type DailyFacts } from "@/lib/agent/daily-review";
import { network } from "@/lib/network";
import ReviewButton from "./ReviewButton";

export const dynamic = "force-dynamic";

const time = (iso: string) =>
  `${new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WIB`;
const n = (x: number) => x.toLocaleString("en");

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

function FactsTable({ f }: { f: DailyFacts }) {
  const c = f.chief;
  const t = f.tasks;
  const rows: [string, string][] = [
    ["Orders created", `${f.orders.created.length} (${f.orders.createdReal} real, ${f.orders.createdSimulated} simulated)`],
    ["Active now", `${f.orders.activeRealNow} real · ${f.orders.activeSimulatedNow} simulated`],
    ["Plans chosen", `${f.plans.byAgent} by the Chief · ${f.plans.byHuman} by a person`],
    ["Customer agreements", String(f.agreements.count)],
    ...f.money.map((m): [string, string] => [
      `Escrow ${m.event} (${m.orderLabel} orders)`,
      `${m.amountUsdc} USDC (~Rp${m.amountIdrApprox.toLocaleString("id-ID")}) · ${m.count} transfer${m.count === 1 ? "" : "s"} · ` +
        `${m.network}${m.testMoney ? " (testnet, test USDC)" : " (mainnet)"}`,
    ]),
    ["Transfers pending now", String(f.pendingTransfersNow)],
    ["Operator tasks", `${t.opened} opened · ${t.done} done · ${t.openNow} open now${t.oldestOpen ? ` (oldest ${t.oldestOpen.ageHours} h, ${t.oldestOpen.orderId})` : ""}`],
    ["Chief runs", `${c.runs} (${c.heartbeatWakeups} woken by the heartbeat)`],
    ["Chief actions", `${c.toolCalls} logged · ${c.decisions} decisions · ${c.escalations} escalations · ${c.refusals} refused by policy`],
    ["Messages to customers", `${c.messagesToCustomers} by the Chief · ${c.messagesByPeople} by people`],
    ["Deadlines (next 3 days)", f.deadlines.next3Days.map((o) => `${o.orderId} ${o.deadline}`).join(", ") || "none"],
    ["Overdue", f.deadlines.overdue.map((o) => `${o.orderId} ${o.deadline}`).join(", ") || "none"],
    ["Printers online now", `${f.printersNow.online} / ${f.printersNow.total}`],
    ["Reputation", f.reputation.score === null ? "no finished real orders yet" : `${f.reputation.score} / 100 (${f.reputation.finished} finished)`],
    ["Claude tokens (order runs)", f.claudeTokens.logged
      ? `${n(f.claudeTokens.input)} in · ${n(f.claudeTokens.output)} out · ${n(f.claudeTokens.cacheRead)} cache read`
      : "not logged"],
  ];
  if (c.refusalReasons.length) rows.push(["Refusal reasons", c.refusalReasons.join(" · ")]);
  return (
    <dl className="calc-kv">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { day } = await searchParams;
  const reviews = listDailyReviews();
  const shown = (typeof day === "string" && isDay(day) ? getDailyReview(day) : undefined) ?? reviews[0];
  const hour = dailyReviewHour();
  const net = network();
  return (
    <main className="wrap">
      <header className="page-head">
        <div>
          <p className="eyebrow">Daily review</p>
          <h1>The Chief&apos;s daily report to the owner.</h1>
          <p className="page-sub">
            Code counts the facts; Claude only writes them up (no tools), or a plain code
            template does when Claude is off.{" "}
            {hour === null ? "The scheduled review is off (KESUNI_DAILY_REVIEW_HOUR=off)." : `The heartbeat writes it once a day after ${hour}:00 WIB.`}
            {net.isTestnet && ` All money runs on ${net.name}: test USDC, not real money.`}
          </p>
        </div>
        <div className="page-actions"><ReviewButton /></div>
      </header>

      {!shown && <p className="muted">No reviews yet.</p>}
      {shown && (
        <section className="card">
          <h2>
            Review {shown.day}{" "}
            <span className={`badge ${shown.mode === "claude" ? "ok" : ""}`}>{shown.mode === "claude" ? `Claude · ${shown.model}` : "code template"}</span>
          </h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Written {time(shown.at)} ({shown.trigger === "schedule" ? "by the heartbeat" : "by hand"})
            {shown.usage && ` · ${n(shown.usage.input_tokens)} in / ${n(shown.usage.output_tokens)} out tokens`}
          </p>
          {shown.error && <div className="alert bad" style={{ fontSize: 13 }}>Code template used: {shown.error}</div>}
          <ReviewText text={shown.text} />
          <h3 style={{ margin: "18px 0 6px" }}>Facts behind it</h3>
          <FactsTable f={shown.facts as DailyFacts} />
          <div style={{ marginTop: 12 }}><ReviewButton day={shown.day} label={`Tulis ulang review ${shown.day}`} /></div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="card">
          <h2>All reviews <span className="badge">{reviews.length}</span></h2>
          <ul className="attention">
            {reviews.map((r) => (
              <li key={r.day}>
                <Link href={`/review?day=${r.day}`}>{r.day}</Link>{" "}
                <span className="muted">· {r.mode === "claude" ? "Claude" : "code template"} · {time(r.at)}</span>
                {shown?.day === r.day && <span className="badge" style={{ marginLeft: 6 }}>shown</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
