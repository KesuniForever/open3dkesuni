// Capacity board for /capacity: when each printer is busy or free over the next 7 Jakarta days, and which open
// orders are due. Read-only. buildCapacity() is pure (pass "now" for tests); capacity() gathers live store data.
//
// Nothing here is a booking: there are no reservations. Busy time comes only from what a printer reports (state,
// percent, remaining minutes); deadlines and plan ETAs come from the orders and their chosen quote. Simulated orders
// are shown with their label and kept out of the real numbers (as in dashboard.ts and traction.ts).
//
// Working-hours assumption (shown on the page): printers can run 24 h, but a person collects finished prints only
// between 08:00 and 21:00 WIB. A print that ends at night keeps its bed full (printer blocked) until 08:00.
import * as store from "./store";
import { notReadyReason, printFinished } from "./printer/actions";
import { deadlineEnd } from "./owner-rules";
import { notReadyMsg, type Msg } from "./machines";
import { dateLocale, makeT, type Locale, type T } from "../i18n/core";
import type { Order, OrderStatus, Printer, Quote } from "./types";

/** English, for the agent and tests. The page passes formatters(locale, t) for Indonesian. */
const EN: T = makeT("en", {});
const en = (m?: Msg): string => (m ? EN(m.key, m.vars) : "");

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const WIB = 7 * HOUR;
export const WINDOW_DAYS = 7;
export const COLLECT_FROM_H = 8;
export const COLLECT_TO_H = 21;
/** A deadline closer than this (or a start-by closer than this) is "tight". */
const TIGHT_MS = DAY;
/** A block piece this wide (% of a day) gets its full label; this wide, a short one. */
const LABEL_FULL_PCT = 40;
const LABEL_SHORT_PCT = 16;

/** Orders that still have work before delivery. Later statuses are printed already. */
const OPEN: OrderStatus[] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"];
const PRINTING = ["RUNNING", "PREPARE", "SLICING"];

export type PrinterStatus = "offline" | "printing" | "paused" | "bed_full" | "held" | "check" | "ready";
export type SegmentKind = "busy" | "paused" | "wait" | "held" | "offline" | "free";

export interface Segment {
  kind: SegmentKind;
  from: number;
  to: number;
  orderId?: string;
  /** Label for the block, empty for free time. */
  text: string;
  /** A shorter label for a narrow block. */
  short: string;
  /** text and short as dictionary keys, for the visitor's language. */
  label?: Msg;
  shortLabel?: Msg;
}

export interface Lane {
  id: string;
  name: string;
  status: PrinterStatus;
  /** Why it cannot take a new job right now (notReadyReason), or null when ready. */
  reason: string | null;
  /** The same reason as a dictionary key, for the visitor's language. */
  why: Msg | null;
  percent: number | null;
  /** Estimated end of the current print (snapshot time + remaining minutes), when printing or paused. */
  finishAt: number | null;
  /** false when the printer did not report remaining minutes, or is paused. */
  finishKnown: boolean;
  orderId?: string;
  jobName: string | null;
  lastSeen?: string;
  /** When it can take a new job, if known within the window. */
  freeFrom: number | null;
  /** Free printer hours left in the window. */
  freeHours: number;
  segments: Segment[];
}

export type DeadlineState = "overdue" | "at_risk" | "tight" | "on_track" | "no_plan" | "printed";

export interface DeadlineItem {
  orderId: string;
  product: string;
  real: boolean;
  status: OrderStatus;
  quantity: number;
  deadline: string;
  /** End of the deadline day, Jakarta time. null if the deadline is not a valid date. */
  dueAt: number | null;
  etaHours: number | null;
  /** Latest start that still meets the deadline: deadline end minus the chosen plan's ETA. */
  startBy: number | null;
  state: DeadlineState;
  /** Still needs Kesuni printer time (an own plan is chosen and the print has not finished). */
  needsPrinter: boolean;
  /** The chosen plan is a partner's: tracked for its deadline, but it uses none of Kesuni's printers. */
  partner: boolean;
  printerId?: string;
}

export interface Cell {
  kind: SegmentKind;
  /** Position inside the day, 0..100 (% of 24 h). */
  left: number;
  width: number;
  text: string;
  /** text as a dictionary key, for the visitor's language. */
  label?: Msg;
  orderId?: string;
  from: number;
  to: number;
}

export interface Day {
  key: string;          // YYYY-MM-DD, Jakarta
  start: number;
  weekday: string;      // "Thu"
  date: string;         // "15"
  month: string;        // "Oct"
  isToday: boolean;
  /** Where "now" is inside today, 0..100; null for other days. */
  nowPct: number | null;
  /** Free printer hours this day, all printers together. */
  freeHours: number;
  /** All printer hours of the day (printers × 24) split three ways. booked = printing, paused, a part waiting on the
   *  bed, or held for an order; unavailable = already past (today) or offline. */
  load: { free: number; booked: number; unavailable: number };
  cells: Record<string, Cell[]>;
  /** Open orders due this day; overdue ones are listed on today. */
  due: DeadlineItem[];
}

export interface CapacityStats {
  printers: number;
  online: number;
  printingNow: number;
  /** Sum of the chosen own plan's ETA for open orders that are in production or must start within the window.
   *  Partner plans are left out: they use none of Kesuni's printers. */
  bookedHoursReal: number;
  bookedHoursSimulated: number;
  nextReal: DeadlineItem | null;
  openReal: number;
  openSimulated: number;
  freeHoursWeek: number;
}

export interface Capacity {
  now: number;
  windowStart: number;
  windowEnd: number;
  days: Day[];
  lanes: Lane[];
  deadlines: DeadlineItem[];
  /** Open orders due after the window. */
  dueLater: number;
  stats: CapacityStats;
  /** Live counts for the availability rules. */
  rules: { total: number; online: number; emptyBed: number; idle: number; ready: number };
}

export interface CapacityInput {
  now: number;
  printers: Printer[];
  orders: Order[];
  /** The chosen quote of each order (by order id), when it has one. */
  chosenQuotes: Record<string, Quote | undefined>;
  /** IN_PRODUCTION orders whose print has finished and only waits for collection and QC. */
  printedOrderIds: Set<string>;
}

// ---------- Jakarta time ----------

export const jakartaKey = (ms: number): string => new Date(ms + WIB).toISOString().slice(0, 10);
export const jakartaDayStart = (ms: number): number => Date.parse(`${jakartaKey(ms)}T00:00:00+07:00`);
const hourOf = (ms: number): number => (((ms + WIB) % DAY) + DAY) % DAY / HOUR;

/** The next moment a person is around to collect a print (now, if inside 08:00–21:00 WIB). */
export function nextCollect(ms: number): number {
  const h = hourOf(ms);
  if (h >= COLLECT_FROM_H && h < COLLECT_TO_H) return ms;
  const start = jakartaDayStart(ms);
  return h < COLLECT_FROM_H ? start + COLLECT_FROM_H * HOUR : start + DAY + COLLECT_FROM_H * HOUR;
}

const fmt = (opts: Intl.DateTimeFormatOptions, locale: Locale = "en") =>
  new Intl.DateTimeFormat(dateLocale(locale), { timeZone: "Asia/Jakarta", ...opts });
const TIME = fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WEEKDAY = fmt({ weekday: "short" });
const DATE = fmt({ day: "numeric" });
const MONTH = fmt({ month: "short" });

/** "14:30" in WIB (24 h with a colon in both languages, like the collection window on the page). */
export const fmtTime = (ms: number): string => TIME.format(ms);
/** "3 h", "2 d 4 h", "45 min". */
export function fmtSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}
/** Whole Jakarta days from today to the deadline day: 0 = today, -2 = two days late. */
export const daysUntil = (dueAt: number, now: number): number => Math.round((jakartaDayStart(dueAt) - jakartaDayStart(now)) / DAY);

/** Dates and deadline words in the visitor's language: English "Thu 15 Oct", Indonesian "Kam 15 Okt". */
export interface Fmt {
  t: T;
  /** "Thu 15 Oct" in WIB. */
  day: (ms: number) => string;
  /** "Thu" in WIB. */
  weekday: (ms: number) => string;
  /** "Oct" in WIB. */
  month: (ms: number) => string;
  /** "Today 14:30", "Fri 16 Oct 08:00". */
  when: (ms: number, now: number) => string;
  /** "today", "tomorrow", "in 4 d", "7 d late". */
  dueIn: (dueAt: number | null, now: number) => string;
}

export function formatters(locale: Locale = "en", t: T = EN): Fmt {
  const dayLabel = fmt({ weekday: "short", day: "numeric", month: "short" }, locale);
  const weekday = fmt({ weekday: "short" }, locale);
  const month = fmt({ month: "short" }, locale);
  const day = (ms: number) => dayLabel.format(ms).replace(",", "");
  return {
    t,
    day,
    weekday: (ms) => weekday.format(ms),
    month: (ms) => month.format(ms),
    when: (ms, now) => {
      const d = jakartaKey(ms);
      const label = d === jakartaKey(now) ? t("Today") : d === jakartaKey(now + DAY) ? t("Tomorrow") : day(ms);
      return `${label} ${fmtTime(ms)}`;
    },
    dueIn: (dueAt, now) => {
      if (dueAt === null) return t("no valid deadline");
      if (dueAt < now) return t("{n} d late", { n: Math.max(1, -daysUntil(dueAt, now)) });
      const d = daysUntil(dueAt, now);
      return d === 0 ? t("today") : d === 1 ? t("tomorrow") : t("in {n} d", { n: d });
    },
  };
}

const EN_FMT = formatters();
/** "Thu 15 Oct" in WIB. */
export const fmtDay = EN_FMT.day;
/** "Today 14:30", "Fri 16 Oct 08:00". */
export const fmtWhen = EN_FMT.when;
/** "today", "tomorrow", "in 4 d", "7 d late". */
export const dueIn = EN_FMT.dueIn;
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------- printers ----------

function lane(p: Printer, now: number, end: number): Lane {
  const reason = notReadyReason(p, now);
  const s = p.snapshot;
  const base = {
    id: p.id, name: p.name, reason, why: notReadyMsg(p, now), percent: null as number | null, finishAt: null as number | null, finishKnown: false,
    orderId: p.currentOrderId, jobName: s?.jobName ?? null, lastSeen: p.lastSeen,
  };
  const segs: Segment[] = [];
  const add = (kind: SegmentKind, from: number, to: number, label?: Msg, shortLabel = label, orderId?: string) => {
    if (to > from) segs.push({ kind, from, to: Math.min(to, end), text: en(label), short: en(shortLabel), label, shortLabel, orderId });
  };
  const m = (key: string, vars?: Msg["vars"]): Msg => ({ key, vars });
  /** After a print ends the part sits on the bed until a person collects it. */
  const afterPrint = (finish: number) => {
    const collect = nextCollect(finish);
    add("wait", finish, collect, m("Collect at 08:00"), m("Bed"));
    add("free", collect, end);
    return collect;
  };
  let status: PrinterStatus;
  let freeFrom: number | null = null;

  if (reason?.startsWith("offline")) {
    status = "offline";
    add("offline", now, end, m("Offline"));
  } else if (s && PRINTING.includes(s.state)) {
    status = "printing";
    base.percent = Math.round(s.percent);
    base.finishKnown = s.remainingMin != null;
    const reported = Date.parse(s.at);
    const finish = base.finishKnown && Number.isFinite(reported)
      ? Math.max(now, reported + (s.remainingMin as number) * 60_000)
      : now + HOUR;
    base.finishAt = finish;
    const pct = base.percent;
    add("busy", now, finish, p.currentOrderId ? m("{id} · {pct}%", { id: p.currentOrderId, pct }) : m("{pct}%", { pct }), m("{pct}%", { pct }), p.currentOrderId);
    freeFrom = afterPrint(finish);
  } else if (s?.state === "PAUSE") {
    status = "paused";
    base.percent = Math.round(s.percent);
    const finish = now + (s.remainingMin ?? 60) * 60_000;
    base.finishAt = finish;
    add("paused", now, finish, p.currentOrderId ? m("Paused · {id}", { id: p.currentOrderId }) : m("Paused"), m("Paused"), p.currentOrderId);
    freeFrom = afterPrint(finish);
  } else if (p.currentOrderId) {
    // Linked to an order but not printing yet: not free for other work, and we do not know when it starts.
    status = "held";
    add("held", now, end, m("Held · {id}", { id: p.currentOrderId }), m("Held"), p.currentOrderId);
  } else if (p.bedOccupiedBy) {
    status = "bed_full";
    const collect = nextCollect(now);
    add("wait", now, collect, m("Collect at 08:00"), m("Bed"));
    add("free", collect, end);
    freeFrom = collect;
  } else if (reason) {
    status = "check";
    add("held", now, end, m("Check printer"), m("Check"));
  } else {
    status = "ready";
    add("free", now, end);
    freeFrom = now;
  }
  const freeHours = round1(segs.filter((x) => x.kind === "free").reduce((a, x) => a + (x.to - x.from), 0) / HOUR);
  return { ...base, status, freeFrom: freeFrom !== null && freeFrom < end ? freeFrom : null, freeHours, segments: segs };
}

// ---------- orders ----------

function deadlineItem(o: Order, quote: Quote | undefined, printed: boolean, lanes: Lane[], now: number): DeadlineItem {
  const due = deadlineEnd(o);
  const dueAt = Number.isFinite(due) ? due : null;
  const etaHours = quote ? quote.etaHours : null;
  const startBy = dueAt !== null && etaHours !== null ? dueAt - etaHours * HOUR : null;
  const onPrinter = lanes.find((l) => l.orderId === o.id);
  const planned = o.status !== "CREATED" && quote !== undefined;
  const partner = planned && quote.source === "partner";
  const needsPrinter = planned && quote.source === "own" && !printed;
  let state: DeadlineState;
  if (dueAt !== null && now > dueAt) state = "overdue";
  else if (printed) state = "printed";
  else if (!planned || dueAt === null) state = "no_plan";
  else if (o.status === "IN_PRODUCTION") {
    // Already started: the ETA from now would be too pessimistic. Use the printer's own estimate when there is one.
    if (onPrinter?.finishAt != null && onPrinter.finishAt > dueAt) state = "at_risk";
    else state = dueAt - now < TIGHT_MS ? "tight" : "on_track";
  } else if (startBy !== null && now > startBy) state = "at_risk";
  else state = startBy !== null && startBy - now < TIGHT_MS ? "tight" : "on_track";
  return {
    orderId: o.id, product: o.product, real: o.label === "real", status: o.status, quantity: o.quantity, deadline: o.deadline,
    dueAt, etaHours, startBy, state, needsPrinter, partner, printerId: onPrinter?.id,
  };
}

const byDue = (a: DeadlineItem, b: DeadlineItem) =>
  (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.orderId.localeCompare(b.orderId);

// ---------- the board ----------

export function buildCapacity(input: CapacityInput): Capacity {
  const { now } = input;
  const windowStart = jakartaDayStart(now);
  const windowEnd = windowStart + WINDOW_DAYS * DAY;
  const lanes = input.printers.map((p) => lane(p, now, windowEnd));

  const deadlines = input.orders
    .filter((o) => OPEN.includes(o.status))
    .map((o) => deadlineItem(o, input.chosenQuotes[o.id], input.printedOrderIds.has(o.id), lanes, now))
    .sort(byDue);

  // Cut every block into one piece per day. Label it once: in full on the first piece wide enough, else a short
  // label on its widest piece, else not at all (the tooltip and the printer line still say what it is).
  const cells: Record<string, Cell[]>[] = Array.from({ length: WINDOW_DAYS }, () => Object.fromEntries(lanes.map((l) => [l.id, []])));
  for (const l of lanes) {
    for (const s of l.segments) {
      const pieces: Cell[] = [];
      for (let i = 0; i < WINDOW_DAYS; i++) {
        const start = windowStart + i * DAY;
        const from = Math.max(s.from, start);
        const to = Math.min(s.to, start + DAY);
        if (to <= from) continue;
        const cell: Cell = { kind: s.kind, from, to, orderId: s.orderId, left: ((from - start) / DAY) * 100, width: ((to - from) / DAY) * 100, text: "" };
        pieces.push(cell);
        cells[i][l.id].push(cell);
      }
      const full = pieces.find((p) => p.width >= LABEL_FULL_PCT);
      const widest = pieces.reduce<Cell | undefined>((w, p) => (!w || p.width > w.width ? p : w), undefined);
      if (full) Object.assign(full, { text: s.text, label: s.label });
      else if (widest && widest.width >= LABEL_SHORT_PCT) Object.assign(widest, { text: s.short, label: s.shortLabel });
    }
  }

  const days: Day[] = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const start = windowStart + i * DAY;
    const end = start + DAY;
    let free = 0;
    let busy = 0;
    for (const l of lanes) {
      for (const c of cells[i][l.id]) {
        if (c.kind === "free") free += c.to - c.from;
        else if (c.kind !== "offline") busy += c.to - c.from;
      }
    }
    const due = deadlines.filter((d) => d.dueAt !== null && (i === 0 ? d.dueAt < end : d.dueAt >= start && d.dueAt < end));
    return {
      key: jakartaKey(start), start, weekday: WEEKDAY.format(start), date: DATE.format(start), month: MONTH.format(start),
      isToday: i === 0, nowPct: i === 0 ? ((now - start) / DAY) * 100 : null, freeHours: round1(free / HOUR), cells: cells[i], due,
      load: {
        free: round1(free / HOUR),
        booked: round1(busy / HOUR),
        unavailable: round1(Math.max(0, lanes.length * DAY - free - busy) / HOUR),
      },
    };
  });

  const booked = (real: boolean) => deadlines
    .filter((d) => d.real === real && d.needsPrinter && d.etaHours !== null
      && (d.status === "IN_PRODUCTION" || (d.startBy !== null && d.startBy < windowEnd)))
    .reduce((a, d) => a + (d.etaHours as number), 0);
  const online = lanes.filter((l) => l.status !== "offline");

  return {
    now, windowStart, windowEnd, days, lanes, deadlines,
    dueLater: deadlines.filter((d) => d.dueAt === null || d.dueAt >= windowEnd).length,
    stats: {
      printers: lanes.length,
      online: online.length,
      printingNow: lanes.filter((l) => l.status === "printing" || l.status === "paused").length,
      bookedHoursReal: booked(true),
      bookedHoursSimulated: booked(false),
      nextReal: deadlines.find((d) => d.real) ?? null,
      openReal: deadlines.filter((d) => d.real).length,
      openSimulated: deadlines.filter((d) => !d.real).length,
      freeHoursWeek: round1(lanes.reduce((a, l) => a + l.freeHours, 0)),
    },
    rules: {
      total: lanes.length,
      online: online.length,
      emptyBed: input.printers.filter((p, i) => lanes[i].status !== "offline" && !p.bedOccupiedBy).length,
      idle: lanes.filter((l) => l.status === "ready" || l.status === "bed_full").length,
      ready: lanes.filter((l) => l.reason === null).length,
    },
  };
}

/** Live capacity from the store. Read-only. */
export function capacity(now = Date.now()): Capacity {
  const orders = store.listOrders();
  const chosenQuotes: Record<string, Quote | undefined> = {};
  const printedOrderIds = new Set<string>();
  for (const o of orders) {
    if (!OPEN.includes(o.status)) continue;
    if (o.chosenQuoteId) chosenQuotes[o.id] = store.getQuote(o.chosenQuoteId);
    if (o.status === "IN_PRODUCTION" && printFinished(o.id)) printedOrderIds.add(o.id);
  }
  return buildCapacity({ now, printers: store.listPrinters(), orders, chosenQuotes, printedOrderIds });
}
