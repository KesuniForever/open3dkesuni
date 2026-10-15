// The /capacity views, kept apart from page.tsx so a page file only exports the page. Server components.
// Every view gets `f` (formatters in the visitor's language, with f.t for the words); English is the default.
import type { ReactNode } from "react";
import Link from "next/link";
import Icon, { type IconName } from "../components/Icon";
import Info from "../components/Info";
import {
  fmtTime, COLLECT_FROM_H, COLLECT_TO_H,
  type Capacity, type Cell, type Day, type DeadlineItem, type DeadlineState, type Fmt, type Lane, type PrinterStatus, type Segment,
} from "@/lib/capacity";
import { ownerRules } from "@/lib/owner-rules";
import type { T } from "@/i18n/core";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const hours = (n: number) => Math.round(n).toLocaleString("en-US");
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const COLLECT = `${hh(COLLECT_FROM_H)}–${hh(COLLECT_TO_H)}`;

const STATUS: Record<PrinterStatus, { text: string; tone: string }> = {
  ready: { text: "Ready", tone: "ok" },
  printing: { text: "Printing", tone: "real" },
  paused: { text: "Paused", tone: "warn" },
  bed_full: { text: "Collect part", tone: "warn" },
  held: { text: "Held", tone: "warn" },
  check: { text: "Check", tone: "bad" },
  offline: { text: "Offline", tone: "bad" },
};

const DUE: Record<DeadlineState, { text: string; tone: string }> = {
  overdue: { text: "Overdue", tone: "bad" },
  at_risk: { text: "At risk", tone: "warn" },
  tight: { text: "Tight", tone: "warn" },
  on_track: { text: "On track", tone: "ok" },
  no_plan: { text: "No plan yet", tone: "" },
  printed: { text: "Printed", tone: "ok" },
};

const SEGMENT: Record<Segment["kind"], string> = {
  busy: "Printing", paused: "Paused", wait: "Waiting for collection", held: "Held", offline: "Offline", free: "Free",
};

function ago(iso: string | undefined, now: number, t: T): string {
  if (!iso) return t("never");
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? t("{n} s ago", { n: s })
    : s < 3600 ? t("{n} min ago", { n: Math.round(s / 60) })
    : s < 172_800 ? t("{n} h ago", { n: Math.round(s / 3600) })
    : t("{n} d ago", { n: Math.round(s / 86_400) });
}

/** Why the printer cannot take a new job, in the visitor's language. */
const reasonText = (l: Lane, t: T): string | null => (l.why ? t(l.why.key, l.why.vars) : l.reason);

/** A block's label on the board, in the visitor's language. */
const cellText = (cell: Cell, t: T): string => (cell.label ? t(cell.label.key, cell.label.vars) : cell.text);

/** "Today" or "Thu" / "Kam". */
const dayShort = (d: Day, f: Fmt) => (d.isToday ? f.t("Today") : f.weekday(d.start));
/** "Today" or "Thu 15 Oct" / "Kam 15 Okt". */
const dayLong = (d: Day, f: Fmt) => (d.isToday ? f.t("Today") : `${f.weekday(d.start)} ${d.date} ${f.month(d.start)}`);

function laneLine(l: Lane, now: number, f: Fmt): string {
  const { t } = f;
  switch (l.status) {
    case "printing": return t("{pct}% · done {when}", { pct: l.percent ?? 0, when: l.finishKnown && l.finishAt ? f.when(l.finishAt, now) : t("time unknown") });
    case "paused": return t("{pct}% · needs an operator", { pct: l.percent ?? 0 });
    case "bed_full": return t("Collect the part first");
    case "held": return t("Held for {id}", { id: l.orderId ?? "" });
    case "offline": return t("Last report {ago}", { ago: ago(l.lastSeen, now, t) });
    case "check": return reasonText(l, t) ?? t("Check the printer");
    default: return t("Free now");
  }
}

/** One line for the phone list: what a busy block means. */
function segmentLine(s: Segment, now: number, f: Fmt): string {
  const { t } = f;
  const v = { id: s.orderId ?? "", when: s.to >= now ? f.when(s.to, now) : "" };
  switch (s.kind) {
    case "busy": return t(s.orderId ? (v.when ? "Printing {id} until {when}" : "Printing {id}") : v.when ? "Printing until {when}" : "Printing", v);
    case "paused": return s.orderId ? t("Paused {id}, needs an operator", v) : t("Paused, needs an operator");
    case "wait": return t(v.when ? "Part waits on the bed until {when}" : "Part waits on the bed", v);
    case "held": return s.text === "Check printer" ? t("Check the printer") : t("Held for {id}", { id: s.orderId ?? "" });
    case "offline": return t("Offline");
    default: return t("Free");
  }
}

function freeText(l: Lane, now: number, f: Fmt): string {
  if (l.freeFrom === null) return f.t("Not known");
  if (l.freeFrom > now) return f.when(l.freeFrom, now);
  return l.status === "bed_full" ? f.t("After collection") : f.t("Now");
}

const sim = (d: DeadlineItem, t: T) => (d.real ? null : <span className="badge simulated">{t("simulated")}</span>);

export function Stats({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  const s = c.stats;
  const next = s.nextReal;
  return (
    <div className="stat-grid">
      <div className="stat">
        <span className="stat-label"><span>{t("Printers")} <Info>{t("Live from the LAN bridge. No report in the last 2 minutes counts as offline.")}</Info></span><Icon name="printer" /></span>
        <b>{s.online} / {s.printers}<small className="stat-unit">{t("online")}</small></b>
        <span className="muted">{t("{n} h free this week", { n: hours(s.freeHoursWeek) })}</span>
      </div>
      <div className="stat">
        <span className="stat-label"><span>{t("Printing now")} <Info>{t("Printers that report a running or paused print right now.")}</Info></span><Icon name="pulse" /></span>
        <b>{s.printingNow}<small className="stat-unit">{t("printing")}</small></b>
        <span className="muted">{t("{n} ready for a new job", { n: c.rules.ready })}</span>
      </div>
      <div className="stat">
        <span className="stat-label">
          <span>{t("Booked this week")} <Info>{t("Sum of the chosen plan's ETA for open real orders that are in production or must start in the next 7 days. Partner plans are not counted. ETA is the promised turnaround, not pure print time.")}</Info></span>
          <Icon name="calendar" />
        </span>
        <b>{hours(s.bookedHoursReal)}<small className="stat-unit">{t("h · real")}</small></b>
        <span className="muted">{s.bookedHoursSimulated > 0 ? t("{n} h simulated, not counted", { n: hours(s.bookedHoursSimulated) }) : t("Real orders only")}</span>
      </div>
      <div className="stat">
        <span className="stat-label"><span>{t("Next deadline")} <Info>{t("The earliest open real order. Simulated orders are not counted ({n} open).", { n: s.openSimulated })}</Info></span><Icon name="tag" /></span>
        {next && next.dueAt !== null ? (
          <>
            <b className={next.state === "overdue" ? "bad-text" : undefined}>{f.day(next.dueAt)}</b>
            <span className="muted one-line">{next.orderId} · {f.dueIn(next.dueAt, c.now)}</span>
          </>
        ) : (
          <>
            <b>—</b>
            <span className="muted">{t("No open real orders")}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Week: the board + two panels ----------

export function Week({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  return (
    <>
      <div className="cap-toolbar">
        <span className="cap-pill"><Icon name="printer" size={14} />{t(c.lanes.length === 1 ? "{n} printer" : "{n} printers", { n: c.lanes.length })}</span>
        <span className="cap-hours">
          {t("Printers run 24 h · collection {hours} WIB", { hours: COLLECT })}
          <Info>{t("An assumption, not a booking system: printers can run day and night, but a person collects prints only {hours} WIB. A print that ends at night keeps the printer blocked until {from}.", { hours: COLLECT, from: hh(COLLECT_FROM_H) })}</Info>
        </span>
        <span className="cap-updated muted">{t("Updated {time} WIB", { time: fmtTime(c.now) })}</span>
      </div>
      {c.lanes.length === 0 ? (
        <section className="card cap-empty">
          <span className="cap-empty-icon"><Icon name="printer" size={26} /></span>
          <h3>{t("No printer has reported yet")}</h3>
          <p className="muted">{t("Start the LAN bridge and the board fills in by itself.")}</p>
        </section>
      ) : (
        <>
          <Board c={c} f={f} />
          <DayList c={c} f={f} />
        </>
      )}
      <div className="cap-two">
        <div>
          <UpcomingPanel c={c} f={f} />
          {c.lanes.length > 0 && <WeekLoad c={c} f={f} />}
        </div>
        <RulesPanel c={c} t={t} />
      </div>
    </>
  );
}

function Board({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  const last = c.days.length - 1;
  return (
    <section className="card cap-board-card" aria-label={t("Printer time, next 7 days")}>
      <div className="cap-scroll">
        <div className="cap-board">
          <div className="cap-axis">WIB</div>
          {c.days.map((d) => (
            <div key={d.key} className={`cap-day${d.isToday ? " today" : ""}`}>
              <small>{dayShort(d, f)}</small>
              <strong>{d.date}<span>{f.month(d.start)}</span></strong>
              <em>{t("{n} h free", { n: hours(d.freeHours) })}</em>
            </div>
          ))}

          {c.lanes.map((l) => (
            <div key={l.id} className="cap-row">
              <div className="cap-lane">
                <span className={`cap-dot ${l.status}`} aria-hidden="true" />
                <span className="cap-lane-text">
                  <b className="one-line">{l.name}</b>
                  <small className="one-line">{laneLine(l, c.now, f)}</small>
                </span>
              </div>
              {c.days.map((d) => (
                <div key={d.key} className={`cap-cell${d.isToday ? " today" : ""}`}>
                  {d.nowPct !== null && <span className="cap-past" style={{ width: `${d.nowPct}%` }} />}
                  {d.cells[l.id].map((cell, i) => (
                    <span key={i} className={`cap-bar ${cell.kind}`} style={{ left: `${cell.left}%`, width: `${cell.width}%` }}
                      title={`${l.name}: ${t(SEGMENT[cell.kind])}${cell.orderId ? ` (${cell.orderId})` : ""}, ${fmtTime(cell.from)}–${cell.to - d.start >= 86_400_000 ? "24:00" : fmtTime(cell.to)}`}>
                      {cell.kind !== "free" && cellText(cell, t)}
                    </span>
                  ))}
                  {d.nowPct !== null && <span className="cap-now" style={{ left: `${d.nowPct}%` }} />}
                </div>
              ))}
            </div>
          ))}

          <div className="cap-row due">
            <div className="cap-lane">
              <span className="cap-due-icon" aria-hidden="true"><Icon name="tag" size={14} /></span>
              <span className="cap-lane-text"><b>{t("Due")}</b><small>{t("Open orders")}</small></span>
            </div>
            {c.days.map((d, i) => (
              <div key={d.key} className={`cap-cell due${d.isToday ? " today" : ""}`}>
                {d.due.slice(0, 3).map((x) => (
                  <Link key={x.orderId} href={`/orders/${x.orderId}`} className={`cap-chip ${x.state}${x.real ? "" : " sim"}`}
                    title={`${x.product}: ${t(DUE[x.state].text)}${x.real ? "" : ` (${t("simulated")})`}`}>
                    {x.orderId}{!x.real && <small>{t("sim")}</small>}
                  </Link>
                ))}
                {d.due.length > 3 && <span className="cap-more">{t("+{n} more", { n: d.due.length - 3 })}</span>}
                {i === last && c.dueLater > 0 && <span className="cap-more">{t("+{n} later", { n: c.dueLater })}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cap-legend">
        <span><i className="free" />{t("Free")}</span>
        <span><i className="busy" />{t("Printing")}</span>
        <span><i className="wait" />{t("Part on bed")}</span>
        <span><i className="held" />{t("Held")}</span>
        <span><i className="offline" />{t("Offline")}</span>
        <span><i className="night" />{t("Nobody to collect")}</span>
        <span><i className="sim" />{t("Simulated order")}</span>
      </div>
    </section>
  );
}

/** Phone: the same week as one list of days. Quiet days are a single row. */
function DayList({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  return (
    <section className="card cap-days" aria-label={t("Printer time by day")}>
      <ul className="cap-day-list">
        {c.days.map((d, i) => {
          const end = d.start + 86_400_000;
          const items = c.lanes.flatMap((l) => l.segments
            .filter((s) => s.kind !== "free" && s.from >= d.start && s.from < end)
            .map((s) => ({ key: `${l.id}-${s.from}`, lane: l, s })));
          const later = i === c.days.length - 1 ? c.dueLater : 0;
          const quiet = items.length === 0 && d.due.length === 0 && later === 0;
          return (
            <li key={d.key} className={`cap-dayrow${d.isToday ? " today" : ""}`}>
              <div className="cap-dayrow-head">
                <b>{dayLong(d, f)}</b>
                <span className={d.freeHours > 0 ? "cap-free-chip" : "muted"}>{t("{n} h free", { n: hours(d.freeHours) })}</span>
              </div>
              {!quiet && (
                <ul>
                  {items.map(({ key, lane, s }) => (
                    <li key={key}>
                      <span className={`cap-dot ${s.kind === "busy" ? "printing" : s.kind === "wait" ? "bed_full" : lane.status}`} aria-hidden="true" />
                      <span><b>{lane.name}</b> <span className="muted">{segmentLine(s, c.now, f)}</span></span>
                    </li>
                  ))}
                  {d.due.map((x) => (
                    <li key={x.orderId}>
                      <span className="cap-due-icon sm" aria-hidden="true"><Icon name="tag" size={12} /></span>
                      <Link href={`/orders/${x.orderId}`} className="cap-dayrow-link">{t("Due {id}", { id: x.orderId })}</Link>
                      <span className={`badge ${DUE[x.state].tone}`}>{t(DUE[x.state].text)}</span>{sim(x, t)}
                    </li>
                  ))}
                  {later > 0 && <li className="muted">{t("+{n} due later", { n: later })}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Printer hours per day, all printers: free, booked, past or offline (TIMBAL's capacity chart, from live data). */
function WeekLoad({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  return (
    <section className="card">
      <h2>{t("Week load")} <Info>{t("All printer hours of each day ({n} × 24 h). Booked = printing, paused, a part waiting on the bed, or held for an order. Grey = already past or offline.", { n: c.lanes.length })}</Info></h2>
      <div className="cap-load" role="img"
        aria-label={t("Free printer hours per day: {list}", { list: c.days.map((d) => `${f.weekday(d.start)} ${hours(d.load.free)}`).join(", ") })}>
        {c.days.map((d) => (
          <div key={d.key} className={`cap-load-col${d.isToday ? " today" : ""}`}
            title={t("{day}: {free} h free · {booked} h booked · {past} h past or offline", { day: dayLong(d, f), free: hours(d.load.free), booked: hours(d.load.booked), past: hours(d.load.unavailable) })}>
            <span className="cap-load-val">{t("{n} h", { n: hours(d.load.free) })}</span>
            <div className="cap-load-bar">
              {d.load.unavailable > 0 && <i className="un" style={{ flexGrow: d.load.unavailable }} />}
              {d.load.booked > 0 && <i className="booked" style={{ flexGrow: d.load.booked }} />}
              {d.load.free > 0 && <i className="free" style={{ flexGrow: d.load.free }} />}
            </div>
            <small>{dayShort(d, f)}</small>
          </div>
        ))}
      </div>
      <div className="cap-load-legend">
        <span><i className="free" />{t("Free (h)")}</span>
        <span><i className="booked" />{t("Booked")}</span>
        <span><i className="un" />{t("Past or offline")}</span>
      </div>
    </section>
  );
}

function UpcomingPanel({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  const shown = c.deadlines.slice(0, 5);
  return (
    <section className="card">
      <h2>{t("Upcoming deadlines")} {c.deadlines.length > 0 && <span className="badge">{c.deadlines.length}</span>}</h2>
      {shown.length === 0 ? (
        <div className="cap-empty inline">
          <span className="cap-empty-icon"><Icon name="calendar" size={22} /></span>
          <h3>{t("No open orders yet")}</h3>
          <p className="muted">{t("Capacity is wide open.")}</p>
        </div>
      ) : (
        <ul className="cap-due-list">
          {shown.map((d) => <DueItem key={d.orderId} d={d} now={c.now} f={f} />)}
        </ul>
      )}
      {c.deadlines.length > shown.length && (
        <Link href="/capacity?tab=deadlines" className="cap-all" scroll={false}>{t("All {n} deadlines", { n: c.deadlines.length })}<Icon name="chevron" size={14} /></Link>
      )}
    </section>
  );
}

function DueItem({ d, now, f }: { d: DeadlineItem; now: number; f: Fmt }) {
  const { t } = f;
  return (
    <li>
      <Link href={`/orders/${d.orderId}`} className="cap-due-item">
        <span className={`cap-due-box ${d.state}`}><Icon name="calendar" size={18} /></span>
        <span className="cap-due-text">
          <b className="one-line">{d.product}</b>
          <small>
            {d.orderId} · {t("due {day}", { day: d.dueAt !== null ? f.day(d.dueAt) : d.deadline })}{" "}
            <span className={d.state === "overdue" ? "bad-text" : undefined}>({f.dueIn(d.dueAt, now)})</span>
            {d.etaHours !== null && (d.needsPrinter || d.partner) && ` · ${t(d.partner ? "partner {n} h" : "plan {n} h", { n: d.etaHours })}`}
          </small>
        </span>
        <span className="cap-due-badges">
          <span className={`badge ${DUE[d.state].tone}`}>{t(DUE[d.state].text)}</span>{sim(d, t)}
        </span>
      </Link>
    </li>
  );
}

function RulesPanel({ c, t }: { c: Capacity; t: T }) {
  const r = c.rules;
  // Real orders only, like the KPIs above; simulated late orders get a quiet marker of their own.
  const isLate = (d: DeadlineItem) => d.state === "overdue" || d.state === "at_risk";
  const late = c.deadlines.filter((d) => d.real && isLate(d)).length;
  const lateSim = c.deadlines.filter((d) => !d.real && isLate(d)).length;
  const count = (n: number) => <span className={`badge ${r.total > 0 && n === r.total ? "ok" : "warn"}`}>{n} / {r.total}</span>;
  const rows: { icon: IconName; text: string; badge: ReactNode }[] = [
    {
      icon: "check", text: t("Every order must finish before its deadline."),
      badge: (
        <>
          {lateSim > 0 && (
            <span className="cap-rule-sim" title={t(lateSim === 1 ? "{n} simulated order late, not counted" : "{n} simulated orders late, not counted", { n: lateSim })}>
              {t("+{n} simulated", { n: lateSim })}
            </span>
          )}
          {late ? <span className="badge bad">{t("{n} late", { n: late })}</span> : <span className="badge ok">{t("on track")}</span>}
        </>
      ),
    },
    { icon: "pulse", text: t("Online: a printer report in the last 2 minutes."), badge: count(r.online) },
    { icon: "box", text: t("Empty bed: the last print was marked collected."), badge: count(r.emptyBed) },
    { icon: "printer", text: t("Idle: not printing and not held for an order."), badge: count(r.idle) },
    { icon: "calendar", text: t("People collect prints {hours} WIB.", { hours: COLLECT }), badge: <span className="badge">{t("assumption")}</span> },
    { icon: "network", text: t("Partners only take orders of {amount} or more.", { amount: rp(ownerRules().partnerMinIdr) }), badge: <span className="badge">{t("owner rule")}</span> },
  ];
  // "{ready}" stays in the sentence so the number can be bold wherever the language puts it.
  const [before, after = ""] = t(r.total === 1 ? "{ready} of {total} printer ready for a new job now" : "{ready} of {total} printers ready for a new job now", { total: r.total }).split("{ready}");
  return (
    <section className="card">
      <h2>{t("Availability rules")} <Info>{t("A printer takes a new job only when it is online, its bed is empty and it is idle. These are checked in code before the Chief or a person links a printer.")}</Info></h2>
      <ul className="cap-rules">
        {rows.map((x) => (
          <li key={x.text}>
            <span className="cap-rule-icon"><Icon name={x.icon} size={15} /></span>
            <span className="cap-rule-text">{x.text}</span>
            {x.badge}
          </li>
        ))}
      </ul>
      <p className="cap-ready">
        {before}<b>{r.ready}</b>{after}
      </p>
    </section>
  );
}

// ---------- Deadlines tab ----------

export function Deadlines({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  if (c.deadlines.length === 0) {
    return (
      <section className="card cap-empty">
        <span className="cap-empty-icon"><Icon name="calendar" size={26} /></span>
        <h3>{t("No open orders yet")}</h3>
        <p className="muted">{t("New orders show up here with their deadline.")}</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>{t("Open orders by deadline")} <Info>{t("Start by = deadline minus the chosen plan's ETA. Orders already printed only wait for QC and delivery.")}</Info></h2>
      <ul className="cap-due-list cap-phone-only">
        {c.deadlines.map((d) => <DueItem key={d.orderId} d={d} now={c.now} f={f} />)}
      </ul>
      <div className="table-wrap cap-wide-only">
        <table className="cap-table">
          <thead>
            <tr><th>{t("Order")}</th><th>{t("Due")}</th><th>{t("Start by")}</th><th>{t("Plan")}</th><th>{t("Printer")}</th><th>{t("State")}</th></tr>
          </thead>
          <tbody>
            {c.deadlines.map((d) => {
              const lane = c.lanes.find((l) => l.id === d.printerId);
              return (
                <tr key={d.orderId} className={d.state === "overdue" ? "cap-late" : undefined}>
                  <td>
                    <Link href={`/orders/${d.orderId}`}><b>{d.orderId}</b></Link>{" "}{sim(d, t)}
                    <div className="muted cap-product one-line">{d.product} · {t(d.quantity === 1 ? "{n} unit" : "{n} units", { n: d.quantity })}</div>
                  </td>
                  <td>
                    {d.dueAt !== null ? f.day(d.dueAt) : d.deadline}
                    <div className={d.state === "overdue" ? "bad-text cap-sub" : "muted cap-sub"}>{f.dueIn(d.dueAt, c.now)}</div>
                  </td>
                  <td>{d.status === "IN_PRODUCTION" ? <span className="muted">{t("started")}</span>
                    : d.startBy !== null && (d.needsPrinter || d.partner) ? f.when(d.startBy, c.now) : <span className="muted">—</span>}</td>
                  <td>{d.etaHours !== null ? t("{n} h", { n: d.etaHours }) : <span className="muted">{t("none")}</span>}</td>
                  <td>{lane ? lane.name : <span className="muted">{d.partner ? t("Partner") : d.needsPrinter ? t("not linked") : "—"}</span>}</td>
                  <td><span className={`badge ${DUE[d.state].tone}`}>{t(DUE[d.state].text)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Printers tab ----------

export function Printers({ c, f }: { c: Capacity; f: Fmt }) {
  const { t } = f;
  if (c.lanes.length === 0) {
    return (
      <section className="card cap-empty">
        <span className="cap-empty-icon"><Icon name="printer" size={26} /></span>
        <h3>{t("No printer has reported yet")}</h3>
        <p className="muted">{t("Start the LAN bridge to see each printer here.")}</p>
      </section>
    );
  }
  return (
    <div className="tile-grid">
      {c.lanes.map((l) => {
        const reason = reasonText(l, t);
        return (
          <section key={l.id} className="tile">
            <div className="tile-head">
              <span className="tile-icon"><Icon name="printer" /></span>
              <span className={`badge ${STATUS[l.status].tone}`}>{t(STATUS[l.status].text)}</span>
            </div>
            <h3>{l.name}</h3>
            {(l.status === "printing" || l.status === "paused") && l.percent !== null && (
              <div className="cap-progress" role="img" aria-label={t("{n}% printed", { n: l.percent })}>
                <span className={l.status} style={{ width: `${l.percent}%` }} />
              </div>
            )}
            <dl className="kv-rows">
              <div><dt>{t("Now")}</dt><dd>{l.status === "offline" ? t("No live report") : laneLine(l, c.now, f)}</dd></div>
              <div><dt>{t("Free for a new job")}</dt><dd>{freeText(l, c.now, f)}</dd></div>
              <div><dt>{t("Free this week")}</dt><dd>{t("{n} h", { n: hours(l.freeHours) })}</dd></div>
              <div><dt>{t("Order")}</dt><dd>{l.orderId ? <Link href={`/orders/${l.orderId}`}>{l.orderId}</Link> : t("None")}</dd></div>
              <div><dt>{t("Last report")}</dt><dd>{ago(l.lastSeen, c.now, t)}</dd></div>
            </dl>
            {l.status === "bed_full" && reason && <p className="cap-reason">{reason[0].toUpperCase() + reason.slice(1)}</p>}
          </section>
        );
      })}
    </div>
  );
}
