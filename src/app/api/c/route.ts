import { NextResponse } from "next/server";
import { customerCreateOrder } from "@/lib/customer";
import { clientIp, fail, failWith, str } from "@/lib/http";
import { wakeChief } from "@/lib/agent/chief";
import { addCustomerDesign, customerDesignContentProblem, newOrderWake, type CustomerDesign } from "@/lib/auto-weigh";
import { MAX_CUSTOMER_DESIGN_BYTES } from "@/lib/file-rules";
import { inviteValid } from "@/lib/invite";
import { mediaType, readCapped, readJsonCapped } from "@/lib/request-body";

// At most this many orders per network address per hour, and this many in total: the invite link is shared, every
// order wakes Claude, and the total stops someone with many addresses from flooding the real numbers.
const ORDERS_PER_IP_PER_HOUR = 5;
const ORDERS_PER_HOUR = 20;
// Every try counts here, refused ones too (wrong code, bad file, missing field), before the body is read.
const TRIES_PER_IP_PER_HOUR = 30;
const DESIGNS_PER_IP_PER_HOUR = 10;
/** Designs read at the same time: each one is held in memory while it is checked (up to 25 MB). */
const DESIGNS_AT_ONCE = 2;
const HOUR = 3_600_000;
/** Room for the order's text fields next to the design in one multipart body. */
const FORM_SLACK = 64 * 1024;
/** An order without a design: a few text fields. */
const JSON_MAX = 64 * 1024;
const g = globalThis as unknown as {
  __kesuniOrderIps?: Map<string, number[]>; __kesuniOrderTimes?: number[]; __kesuniOrderTries?: Map<string, number[]>;
  __kesuniDesignTries?: Map<string, number[]>; __kesuniDesignsReading?: { n: number };
};
const byIp = (g.__kesuniOrderIps ??= new Map<string, number[]>());
const all = (g.__kesuniOrderTimes ??= []);
const tries = (g.__kesuniOrderTries ??= new Map<string, number[]>());
const designTries = (g.__kesuniDesignTries ??= new Map<string, number[]>());
const reading = (g.__kesuniDesignsReading ??= { n: 0 });

/** This address's times in the last hour (addresses with none are dropped, so the map does not grow forever). */
function recentFor(map: Map<string, number[]>, ip: string, now: number): number[] {
  if (map.size > 2000) for (const [k, v] of map) if (!v.some((t) => now - t < HOUR)) map.delete(k);
  return (map.get(ip) ?? []).filter((t) => now - t < HOUR);
}

/** Counts one try for this address; false when it already used up `max` this hour. */
function take(map: Map<string, number[]>, ip: string, now: number, max: number): boolean {
  const recent = recentFor(map, ip, now);
  if (recent.length >= max) return false;
  map.set(ip, [...recent, now]);
  return true;
}

/** True when this address, or everyone together, placed the most orders allowed this hour. */
function ordersFull(ip: string, now: number): boolean {
  while (all.length && now - all[0] >= HOUR) all.shift();
  return recentFor(byIp, ip, now).length >= ORDERS_PER_IP_PER_HOUR || all.length >= ORDERS_PER_HOUR;
}

/** The invite code the order form sends in a header with a design, so it is checked before the body is read. */
function headerInvite(req: Request): string {
  try {
    return decodeURIComponent(req.headers.get("x-invite") ?? "");
  } catch {
    return "";
  }
}

type Design = { filename: string; bytes: Uint8Array };
type Body = { fields: Record<string, unknown>; design: Design | null } | { error: Response };

const UNREADABLE = () => fail(400, "Your order could not be read. Please try again.");
const TOO_BIG = () => fail(413, "Your design is larger than 25 MB. Send it on WhatsApp instead.");

/** The order fields, and with multipart the customer's design (one file in "design"), never more than the limits. */
async function readBody(req: Request): Promise<Body> {
  if (mediaType(req) !== "multipart/form-data") {
    const b = await readJsonCapped(req, JSON_MAX);
    if (b === "too-large") return { error: fail(413, "The order is too long") };
    return b ? { fields: b, design: null } : { error: UNREADABLE() };
  }
  // A few designs at a time: each is read whole into memory to check it.
  if (reading.n >= DESIGNS_AT_ONCE) return { error: fail(503, "Kesuni is receiving other designs right now. Try again in a minute.") };
  reading.n++;
  try {
    const bytes = await readCapped(req, MAX_CUSTOMER_DESIGN_BYTES + FORM_SLACK);
    if (bytes === "too-large") return { error: TOO_BIG() };
    let form: FormData;
    try {
      form = await new Response(bytes as BodyInit, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
    } catch {
      return { error: UNREADABLE() };
    }
    const text = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
    let colors: unknown = [];
    try {
      colors = text("colors") ? JSON.parse(text("colors")) : [];
    } catch {
      colors = "not a list"; // refused by the colour check ("Colours must be a list")
    }
    const file = form.get("design");
    return {
      fields: {
        invite: text("invite"), name: text("name"), product: text("product"), quantity: Number(text("quantity")), deadline: text("deadline"),
        budgetIdr: Number(text("budgetIdr")), note: text("note"), material: text("material") || undefined, colors,
      },
      design: file instanceof File && file.size > 0 ? { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null,
    };
  } finally {
    reading.n--;
  }
}

// A customer places an order. Only people with the invite link (CUSTOMER_INVITE_CODE) can.
// JSON body: { invite, name, product, quantity, deadline: "YYYY-MM-DD", budgetIdr, note, material?: "PLA" | "PETG",
//        colors?: [{ type, color: "#RRGGBB" }] (loaded in the studio right now: GET /api/studio/colors) }
// Or multipart/form-data with the same fields (colors as JSON text), header x-invite (the code, URI-encoded) and
// "design": the customer's own model (STL or OBJ, one piece, at most 25 MB). It is checked, stored with the order and
// weighed automatically by the studio's slicer for the price (src/lib/auto-weigh.ts); nothing prints.
// Before a byte of a design is read: another site, the invite, this address's tries and orders this hour, the size it
// declares and how many designs are being read now. Nothing is stored until every check passed.
export async function POST(req: Request) {
  const ip = clientIp(req);
  const now = Date.now();
  if (!take(tries, ip, now, TRIES_PER_IP_PER_HOUR)) return fail(429, "Too many tries in one hour. Try again later or contact Kesuni.");
  if (mediaType(req) === "multipart/form-data") {
    // A plain form on another site can post multipart without a CORS check: only this site's own pages may.
    if (req.headers.get("sec-fetch-site") === "cross-site") return fail(403, "Blocked: this request came from another site.");
    if (!inviteValid(headerInvite(req))) return fail(404, "This order link is not valid");
    if (!take(designTries, ip, now, DESIGNS_PER_IP_PER_HOUR)) return fail(429, "Too many designs sent in one hour. Try again later or contact Kesuni.");
  }
  if (ordersFull(ip, now)) return fail(429, "Too many orders in one hour. Try again later or contact Kesuni.");
  const body = await readBody(req);
  if ("error" in body) return body.error;
  const b = body.fields;
  if (!inviteValid(b.invite)) return fail(404, "This order link is not valid");
  // The design is checked before the order exists: a refused file creates nothing.
  const design = body.design;
  const problem = design ? customerDesignContentProblem(design.filename, design.bytes) : null;
  if (problem) return fail(400, "Your design cannot be used", [problem]);
  // Again right before the order exists: others may have arrived while this one was read. No await from here to the count.
  const at = Date.now();
  if (ordersFull(ip, at)) return fail(429, "Too many orders in one hour. Try again later or contact Kesuni.");
  const r = customerCreateOrder({
    name: str(b.name), product: str(b.product), quantity: Number(b.quantity), deadline: str(b.deadline),
    budgetIdr: Number(b.budgetIdr), note: str(b.note), material: b.material, colors: b.colors,
  });
  if (!r.ok) return failWith(r);
  byIp.set(ip, [...recentFor(byIp, ip, at), at]);
  all.push(at);
  const stored: CustomerDesign | null = design ? await addCustomerDesign(r.order.id, design) : null;
  wakeChief(r.order.id, newOrderWake(stored));
  return NextResponse.json({ link: `/c/${r.order.customerToken}`, ...(stored ? { design: { stored: stored.stored, weighing: Boolean(stored.weighing?.ok) } } : {}) }, { status: 201 });
}
