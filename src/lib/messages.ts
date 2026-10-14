// Short updates for the customer on their order page (/c/<token>), written by the Chief (AI) or a person.
// The customer's note is untrusted input to the LLM, so a prompt injection could try to make the Chief post
// something harmful. The guards are code, not prompt: no links, wallet addresses, phone numbers or emails,
// no repeat of the last message, and the agent may write at most once per 10 minutes and 20 times per order.
// People pass the same content filters but no rate limit: the page is open to anyone with the link, money
// only moves through escrow (a link or address there would look like payment instructions), and a phone
// number pasted by mistake would be public. Kesuni talks to customers directly on WhatsApp anyway.
import * as store from "./store";
import type { Fail } from "./actions";
import type { CustomerMessage } from "./types";

export const MESSAGE_MAX_CHARS = 500;
export const AGENT_MESSAGE_GAP_MS = 10 * 60_000;
export const AGENT_MESSAGES_PER_ORDER = 20;

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });

const TLD = "com|net|org|id|io|co|me|ly|app|dev|xyz|info|biz|link|site|online|shop|store|top|club|gg|to|ai|sh|cc|tv|" +
  "us|uk|ru|cn|my|sg|tk|ml|ga|cf|gq|fun|live|click|page|cloud|tech|pro|vip|win|bet|cash|finance|wallet|crypto|eth";
const LINK = new RegExp(`https?:|://|\\bwww\\.|\\b[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(${TLD})\\b`, "i");
const WALLET = /0x[0-9a-f]{40}/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

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

/** Post a message on the customer's page. The agent tool and the operator API both come through here. */
export function postCustomerMessage(
  orderId: string, rawText: string, by: "agent" | "human", now: Date = new Date(),
): { ok: true; message: CustomerMessage } | Fail {
  if (!store.getOrder(orderId)) return fail(404, "Order not found");
  if (by !== "agent" && by !== "human") return fail(400, 'by must be "agent" or "human"');
  const text = (typeof rawText === "string" ? rawText : "").trim();
  const reasons = messageContentReasons(text);
  if (reasons.length) return fail(422, "Message refused", reasons);
  const all = store.listMessages(orderId);
  if (all.at(-1)?.text === text) return fail(422, "Message refused", ["Same text as the last message"]);
  if (by === "agent") {
    const mine = all.filter((m) => m.by === "agent");
    if (mine.length >= AGENT_MESSAGES_PER_ORDER) {
      return fail(429, "Message refused", [`The Chief has already written ${AGENT_MESSAGES_PER_ORDER} messages on this order; a person writes from now on`]);
    }
    const last = mine.at(-1);
    if (last && now.getTime() - Date.parse(last.at) < AGENT_MESSAGE_GAP_MS) {
      return fail(429, "Message refused", ["The Chief may write at most one message per order every 10 minutes"]);
    }
  }
  const message: CustomerMessage = { id: store.nextMessageId(), orderId, text, by, at: now.toISOString() };
  store.addMessage(message);
  // Agent calls are logged by callTool; log people here so the decision log shows both.
  if (by === "human") store.addLog({ orderId, actor: "human", tool: "message_customer", input: { text }, ok: true, output: { messageId: message.id }, at: message.at });
  return { ok: true, message };
}
