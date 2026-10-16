import { NextResponse } from "next/server";
import { customerCreateOrder } from "@/lib/customer";
import { clientIp, fail, failWith, str } from "@/lib/http";
import { wakeChief } from "@/lib/agent/chief";
import { addCustomerDesign, customerDesignContentProblem, newOrderWake, weighingNow, type CustomerDesign } from "@/lib/auto-weigh";
import { MAX_CUSTOMER_DESIGN_BYTES } from "@/lib/file-rules";
import { inviteValid } from "@/lib/invite";
import { mediaType, readFormCapped, readJsonCapped } from "@/lib/request-body";
import {
  BUSY_READING, CROSS_SITE, DESIGN_TOO_BIG, DESIGNS_PER_IP_PER_HOUR, HOUR, TOO_MANY_DESIGNS, TOO_MANY_TRIES, TRIES_PER_IP_PER_HOUR,
  crossSite, designTries, readingDesign, recentFor, take, tries,
} from "@/lib/customer-limits";

// At most this many orders per network address per hour, and this many in total: the invite link is shared, every
// order wakes Claude, and the total stops someone with many addresses from flooding the real numbers.
const ORDERS_PER_IP_PER_HOUR = 5;
const ORDERS_PER_HOUR = 20;
// Tries and designs count too, with the same numbers as "Add your design" on the order page (src/lib/customer-limits.ts).
/** Room for the order's text fields next to the design in one multipart body. */
const FORM_SLACK = 64 * 1024;
/** An order without a design: a few text fields. */
const JSON_MAX = 64 * 1024;
const g = globalThis as unknown as { __kesuniOrderIps?: Map<string, number[]>; __kesuniOrderTimes?: number[] };
const byIp = (g.__kesuniOrderIps ??= new Map<string, number[]>());
const all = (g.__kesuniOrderTimes ??= []);

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
const TOO_BIG = () => fail(413, DESIGN_TOO_BIG);

/** The order fields, and with multipart the customer's design (one file in "design"), never more than the limits. */
async function readBody(req: Request): Promise<Body> {
  if (mediaType(req) !== "multipart/form-data") {
    const b = await readJsonCapped(req, JSON_MAX);
    if (b === "too-large") return { error: fail(413, "The order is too long") };
    return b ? { fields: b, design: null } : { error: UNREADABLE() };
  }
  const form = await readFormCapped(req, MAX_CUSTOMER_DESIGN_BYTES + FORM_SLACK);
  if (form === "too-large") return { error: TOO_BIG() };
  if (!form) return { error: UNREADABLE() };
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
}

// A customer places an order. Only people with the invite link (CUSTOMER_INVITE_CODE) can.
// JSON body: { invite, name, product, quantity, deadline: "YYYY-MM-DD", budgetIdr, note, material?: "PLA" | "PETG",
//        colors?: [{ type, color: "#RRGGBB" }] (loaded in the studio right now: GET /api/studio/colors) }
// Or multipart/form-data with the same fields (colors as JSON text), header x-invite (the code, URI-encoded) and
// "design": the customer's own model (STL or OBJ, one piece, at most 25 MB). It is checked, stored with the order and
// weighed automatically by the studio's slicer for the price (src/lib/auto-weigh.ts); nothing prints.
// Before a byte of a design is read: another site, the invite, this address's tries and orders this hour, the size it
// declares and how many designs are being received now. Nothing is stored until every check passed.
export async function POST(req: Request) {
  const ip = clientIp(req);
  const now = Date.now();
  if (!take(tries, ip, now, TRIES_PER_IP_PER_HOUR)) return fail(429, TOO_MANY_TRIES);
  if (mediaType(req) === "multipart/form-data") {
    if (crossSite(req)) return fail(403, CROSS_SITE);
    if (!inviteValid(headerInvite(req))) return fail(404, "This order link is not valid");
    if (!take(designTries, ip, now, DESIGNS_PER_IP_PER_HOUR)) return fail(429, TOO_MANY_DESIGNS);
  }
  if (ordersFull(ip, now)) return fail(429, "Too many orders in one hour. Try again later or contact Kesuni.");
  if (mediaType(req) !== "multipart/form-data") return place(req, ip);
  // A few designs at a time: each is held whole in memory until it is checked, measured and stored.
  const res = await readingDesign(() => place(req, ip));
  return res === "busy" ? fail(503, BUSY_READING) : res;
}

/** Read the order (and its design), check it, create it, store the design and wake the Chief. */
async function place(req: Request, ip: string): Promise<Response> {
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
  // While the studio's slicer weighs the design, its grams wake the Chief (src/lib/auto-weigh.ts): no run to only wait.
  if (!weighingNow(stored)) wakeChief(r.order.id, newOrderWake(stored));
  return NextResponse.json({ link: `/c/${r.order.customerToken}`, ...(stored ? { design: { stored: stored.stored, weighing: Boolean(stored.weighing?.ok) } } : {}) }, { status: 201 });
}
