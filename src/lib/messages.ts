// Short updates for the customer on their order page (/c/<token>), written by the Chief (AI) or a person. A message
// has an English text and may have an Indonesian one (textId); the page shows the customer's language, English when
// there is no Indonesian. The Chief always writes both; every guard below checks each text.
// The customer's note is untrusted input to the LLM, so a prompt injection could try to make the Chief post
// something harmful. The guards are code, not prompt: no links, wallet addresses, phone numbers or emails,
// no repeat of the last message, and the agent may write at most 20 times per order: once per 10 minutes, or after
// 2 minutes when the order moved on since its last message (its status or the escrow's: "payment arrived" right after
// "price ready"). The agent may name no amount but the order's real price (the price by weight, the chosen or the
// owner-approved quote, in rupiah or USDC), and never free, discount or refund words (English or Indonesian): it cannot
// change a price or settle money, so it must not promise either.
// People pass the same content filters but no rate limit: the page is open to anyone with the link, money
// only moves through escrow (a link or address there would look like payment instructions), and a phone
// number pasted by mistake would be public. Kesuni talks to customers directly on WhatsApp anyway.
import * as store from "./store";
import type { Fail } from "./actions";
import { idrPerUsdc } from "./costing";
import { quoteIdr } from "./owner-rules";
import { microToUsdc } from "./policy";
import { messageText } from "./text";
import type { CustomerMessage, Order } from "./types";
import type { Locale } from "../i18n/core";

export const MESSAGE_MAX_CHARS = 500;
export const AGENT_MESSAGE_GAP_MS = 10 * 60_000;
/** The shortest gap between two agent messages when the order moved on in between. */
export const AGENT_MESSAGE_NEW_STAGE_GAP_MS = 2 * 60_000;
export const AGENT_MESSAGES_PER_ORDER = 20;

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });

const TLD = "com|net|org|id|io|co|me|ly|app|dev|xyz|info|biz|link|site|online|shop|store|top|club|gg|to|ai|sh|cc|tv|" +
  "us|uk|ru|cn|my|sg|tk|ml|ga|cf|gq|fun|live|click|page|cloud|tech|pro|vip|win|bet|cash|finance|wallet|crypto|eth";
const LINK = new RegExp(`https?:|://|\\bwww\\.|\\b[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(${TLD})\\b`, "i");
const WALLET = /0x[0-9a-f]{40}/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
/** Words that promise a price change or money back, in English and Indonesian: only people decide those. */
const MONEY_PROMISE =
  /\b(free|gratis|discount\w*|diskon|potongan|promo|cashback|refund\w*|pengembalian|dikembalikan|kembalikan|uang\s+kembali|cuma-cuma|percuma|tanpa\s+biaya)\b/i;

/** A run of 9+ digits (spaces, dots, dashes and brackets allowed between them). Prices, dates and order ids are skipped. */
function hasPhone(text: string): boolean {
  const t = text
    .replace(/rp\s?\d[\d.,]*/gi, " ")                                    // Rp1.200.000
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/g, " ") // 2026-10-20, 20/10/2026
    .replace(/\b[A-Z]{2,}-\d+/g, " ");                                    // ORD-001, JOB-001
  return (t.match(/\+?\d[\d ().-]*\d/g) ?? []).some((m) => m.replace(/\D/g, "").length >= 9);
}

/** Why this text may not go on a customer's page, or [] when it may. */
export function messageContentReasons(text: string): string[] {
  const r: string[] = [];
  if (!text) r.push("Message is empty");
  if (text.length > MESSAGE_MAX_CHARS) r.push(`Message is longer than ${MESSAGE_MAX_CHARS} characters`);
  if (LINK.test(text)) r.push("No links or web addresses in customer messages");
  if (WALLET.test(text)) r.push("No wallet addresses in customer messages: payment only goes through escrow");
  if (EMAIL.test(text)) r.push("No email addresses in customer messages");
  if (hasPhone(text)) r.push("No phone numbers in customer messages");
  return r;
}

// ---------- amounts in the Chief's messages ----------

const MULT: Record<string, number> = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6 };
const IDR_PREFIX = /\b(?:rp|idr)\.?\s*:?\s*$/i;

/**
 * A number as people write it. Two kinds of marks ("1.234.567,89", "1,000.50"): the last is the decimal mark, the
 * others group thousands. One kind, repeated ("1.234.567"): thousands. Once with 3 digits after it: thousands in rupiah
 * ("450.000"); in USDC as the text's reader takes it: in English only after a comma ("1,000"; "28.125" is a decimal), in
 * Indonesian only after a dot ("28.125" is twenty-eight thousand; "28,125" a decimal). Else a decimal ("1,5", "15.15",
 * "99000,00"). NaN when it is no number people write ("1.23.4"): the guard refuses what it cannot read.
 */
function readNumber(raw: string, currency: "idr" | "usdc", lang: Locale = "en"): number {
  const s = raw.replace(/[.,]+$/, "");
  const marks = s.replace(/\d/g, "");
  if (!marks) return Number(s);
  const dec = marks.at(-1)!;
  const grouped = (int: string) => /^\d{1,3}([.,]\d{3})+$/.test(int);
  if (new Set(marks).size === 2) {
    const i = s.lastIndexOf(dec);
    const int = s.slice(0, i);
    return grouped(int) && !int.includes(dec) ? Number(`${int.replace(/[.,]/g, "")}.${s.slice(i + 1)}`) : NaN;
  }
  if (marks.length > 1) return grouped(s) ? Number(s.replace(/[.,]/g, "")) : NaN;
  const thousands = grouped(s) && (currency === "idr" || dec === (lang === "id" ? "." : ","));
  return Number(thousands ? s.replace(dec, "") : s.replace(",", "."));
}

/** Rupiah as written: "Rp450.000", "Rp 99.000,00", "450 ribu", "Rp1,5 juta", "450k". NaN: not readable. */
const readIdr = (raw: string, mult?: string): number => readNumber(raw, "idr") * (mult ? MULT[mult.toLowerCase()] : 1);

/**
 * Every rupiah and USDC (or US$, USD, dollar) amount in a text, read in the text's language. An amount it cannot read
 * is NaN, which no price matches. Numbers without a currency (quantities, grams, dates) are not amounts.
 */
export function amountsIn(text: string, lang: Locale = "en"): { idr: number[]; usdc: number[] } {
  const idr: number[] = [];
  const usdc: number[] = [];
  // A number starts and ends with a digit: "Rp450.000, 5 USD" is two amounts, not "450.000, 5".
  for (const m of text.matchAll(/\b(?:rp|idr)\.?\s*:?\s*(\d(?:[\d.,]*\d)?)(?:\s*(rb|ribu|k|jt|juta)\b)?/gi)) idr.push(readIdr(m[1], m[2]));
  // "450 ribu", "450.000 rupiah", "450k" without "Rp" in front.
  for (const m of text.matchAll(/(?<![\w.,])(\d(?:[\d.,]*\d)?)(?:\s*(ribu|rb|juta|jt|rupiah|idr)|(k))\b/gi)) {
    if (IDR_PREFIX.test(text.slice(0, m.index))) continue; // counted above
    const unit = m[2] ?? m[3];
    idr.push(readIdr(m[1], /^(rupiah|idr)$/i.test(unit) ? undefined : unit));
  }
  const usd = /(\d(?:[\d.,]*\d)?)\s*(?:test\s*)?(?:usdc?|dollars?|dolar)\b|\busdc?\s*:?\s*(\d(?:[\d.,]*\d)?)|(?:\bus)?\$\s*(\d(?:[\d.,]*\d)?)/gi;
  for (const m of text.matchAll(usd)) usdc.push(readNumber(m[1] ?? m[2] ?? m[3], "usdc", lang));
  return { idr, usdc };
}

/** The amounts the Chief may name: the order's real price per unit and in total, in rupiah and USDC. */
export function allowedAmounts(o: Order): { idr: number[]; usdc: number[] } {
  const idr = new Set<number>();
  const usdc = new Set<number>();
  if (o.gramPricing) {
    idr.add(o.gramPricing.unitPriceIdr);
    idr.add(o.gramPricing.totalIdr);
  }
  for (const id of [o.chosenQuoteId, o.ownerApproval?.quoteId]) {
    const q = id ? store.getQuote(id) : undefined;
    if (!q || q.orderId !== o.id) continue;
    usdc.add(Number(microToUsdc(q.priceMicro)));
    // In rupiah as the pages show it: the agreed rupiah of a price by weight, else at the app's or the order's rate.
    for (const total of new Set([quoteIdr(o, q), quoteIdr(o, q, o.rateIdrPerUsdc ?? idrPerUsdc())])) {
      idr.add(total);
      if (o.quantity > 1) idr.add(Math.round(total / o.quantity));
    }
  }
  return { idr: [...idr], usdc: [...usdc] };
}

const UNREADABLE = "an amount written in a way code cannot check";
const rp = (n: number) => (Number.isFinite(n) ? `Rp${Math.round(n).toLocaleString("id-ID")}` : UNREADABLE);
/** USDC as the text's reader writes it: "28.125 USDC" in English, "28,125 USDC" in Indonesian. */
const usdcText = (u: number, lang: Locale) =>
  (Number.isFinite(u) ? `${lang === "id" ? u.toLocaleString("id-ID", { maximumFractionDigits: 6 }) : u} USDC` : UNREADABLE);

/** Why the Chief may not post these amounts or words on this order's page, or []. lang: the text's language. */
export function agentMoneyReasons(text: string, o: Order, lang: Locale = "en"): string[] {
  const r: string[] = [];
  const word = MONEY_PROMISE.exec(text)?.[0];
  if (word) r.push(`The Chief may not write "${word}": price changes, discounts and refunds are for people`);
  const found = amountsIn(text, lang);
  const ok = allowedAmounts(o);
  const badIdr = found.idr.filter((n) => !ok.idr.some((a) => Math.abs(a - n) < 1));
  const badUsdc = found.usdc.filter((n) => !ok.usdc.some((a) => Math.abs(a - n) < 0.01));
  if (badIdr.length || badUsdc.length) {
    const inLang = (u: number) => usdcText(u, lang);
    const allowed = [...ok.idr.map(rp), ...ok.usdc.map(inLang)];
    const bad = [...new Set([...badIdr.map(rp), ...badUsdc.map(inLang)])];
    r.push(allowed.length
      ? `Amounts must be the order's price (${allowed.join(", ")}); not ${bad.join(", ")}`
      : "This order has no price yet: name no amount");
  }
  return r;
}

/** The order's status and escrow state now: the Chief may write again sooner once it changed. */
export function orderStage(o: Order): string {
  return `${o.status}/${store.getEscrow(o.id)?.state ?? "none"}`;
}

/** A guard's reason about the Indonesian text (src/i18n/id/lib.ts translates it with the reason inside). */
export const inIndonesian = (reason: string): string => `In the Indonesian text: ${reason}`;

/** The message in English, and optionally in Indonesian. A plain string is English only. */
export type MessageTexts = string | { text: unknown; textId?: unknown };
const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Post a message on the customer's page. The agent tool and the operator API both come through here. */
export function postCustomerMessage(
  orderId: string, texts: MessageTexts, by: "agent" | "human", now: Date = new Date(),
): { ok: true; message: CustomerMessage } | (Fail & { retryAfter?: string }) {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (by !== "agent" && by !== "human") return fail(400, 'by must be "agent" or "human"');
  const text = clean(typeof texts === "string" ? texts : texts?.text);
  const textId = typeof texts === "string" ? "" : clean(texts?.textId);
  // Every guard on each text, the amounts read as its reader reads them: the customer reads one of them.
  const check = (x: string, lang: Locale) => [...messageContentReasons(x), ...(by === "agent" ? agentMoneyReasons(x, order, lang) : [])];
  const reasons = check(text, "en");
  if (textId) reasons.push(...check(textId, "id").map(inIndonesian));
  else if (by === "agent") reasons.push("Write the message in Indonesian too (textId)");
  if (by === "agent" && textId && textId === text) reasons.push("textId must be the message in Indonesian, not the English text again");
  if (reasons.length) return fail(422, "Message refused", reasons);
  const all = store.listMessages(orderId);
  const last = all.at(-1);
  // No repeat as the customer reads it, in English or in Indonesian (where a message without textId shows its English).
  const next = { text, textId };
  if (last && messageText(next, "en") === messageText(last, "en")) return fail(422, "Message refused", ["Same text as the last message"]);
  if (last && messageText(next, "id") === messageText(last, "id")) {
    return fail(422, "Message refused", [textId ? inIndonesian("Same text as the last message") : "Same text as the last message"]);
  }
  const stage = orderStage(order);
  if (by === "agent") {
    const mine = all.filter((m) => m.by === "agent");
    if (mine.length >= AGENT_MESSAGES_PER_ORDER) {
      return fail(429, "Message refused", [`The Chief has already written ${AGENT_MESSAGES_PER_ORDER} messages on this order; a person writes from now on`]);
    }
    const last = mine.at(-1);
    const moved = Boolean(last?.stage) && last!.stage !== stage;
    const gap = moved ? AGENT_MESSAGE_NEW_STAGE_GAP_MS : AGENT_MESSAGE_GAP_MS;
    if (last && now.getTime() - Date.parse(last.at) < gap) {
      const retryAfter = new Date(Date.parse(last.at) + gap).toISOString();
      return {
        ...fail(429, "Message refused", [moved
          ? "The Chief may write at most one message per order every 2 minutes"
          : `The Chief may write at most one message per order every 10 minutes, unless the order moved on (now ${stage}); you are not woken for a retry`]),
        retryAfter,
      };
    }
  }
  const message: CustomerMessage = {
    id: store.nextMessageId(), orderId, text, ...(textId ? { textId } : {}), by, at: now.toISOString(), ...(by === "agent" ? { stage } : {}),
  };
  store.addMessage(message);
  // Agent calls are logged by callTool; log people here so the decision log shows both.
  if (by === "human") {
    store.addLog({ orderId, actor: "human", by: "person", tool: "message_customer", input: { text, ...(textId ? { textId } : {}) }, ok: true,
      output: { messageId: message.id }, at: message.at });
  }
  return { ok: true, message };
}
