import { NextResponse } from "next/server";
import { orderForToken } from "@/lib/customer";
import { readAttachment } from "@/lib/files";
import { clientIp, fail } from "@/lib/http";
import { wakeChief } from "@/lib/agent/chief";
import {
  addCustomerDesign, customerDesignClosed, customerDesignContentProblem, customerDesignFile, newOrderWake, weighingNow,
} from "@/lib/auto-weigh";
import { MAX_CUSTOMER_DESIGN_BYTES } from "@/lib/file-rules";
import { mediaType, readFormCapped } from "@/lib/request-body";
import {
  BUSY_READING, CROSS_SITE, DESIGN_TOO_BIG, DESIGNS_PER_IP_PER_HOUR, TOO_MANY_DESIGNS, TOO_MANY_TRIES, TRIES_PER_IP_PER_HOUR, crossSite,
  designTries, readingDesign, take, tries,
} from "@/lib/customer-limits";

type Ctx = { params: Promise<{ token: string }> };

/** Downloads of the design per network address per hour: a phone needs one (it is kept for an hour), a few reloads more. */
const DOWNLOADS_PER_IP_PER_HOUR = 30;
/** Room for the multipart headers around the one file. */
const FORM_SLACK = 16 * 1024;
const g = globalThis as unknown as { __kesuniDesignDownloads?: Map<string, number[]>; __kesuniDesignAdding?: Set<string> };
const downloads = (g.__kesuniDesignDownloads ??= new Map<string, number[]>());
/** Orders whose design is being stored right now: a second upload for the same order waits for the first. */
const adding = (g.__kesuniDesignAdding ??= new Set<string>());

const UNREADABLE = "Your design could not be read. Please try again.";

/** "Clip (v2).stl" stays; anything outside plain letters, digits and . _ - ( ) and spaces becomes "_" (a safe header). */
const headerName = (name: string) => name.replace(/[^A-Za-z0-9._\-() ]/g, "_").slice(-120) || "design.stl";

// The customer's own design, so their order page can draw it in 3D (the preview is drawn in their browser).
// Safe to serve: it is only ever the file the customer sent themselves (the order form or "Add your design": uploadedBy
// CUSTOMER_UPLOAD_BY, kind design, an STL or OBJ of at most 25 MB; src/lib/auto-weigh.ts customerDesignFile), on this
// order, behind this order's own unguessable link: they get back exactly what they uploaded. Never a sliced file (the
// studio's slicer stores those under its own name, as .gcode.3mf) and never a file a person at Kesuni added.
// /api/c/<token>/files still refuses every design. As a download (octet-stream, nosniff): the browser never runs it.
export async function GET(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const order = orderForToken(token);
  const a = order ? customerDesignFile(order.id) : undefined;
  if (!order || !a) return fail(404, "File not found");
  if (!take(downloads, clientIp(req), Date.now(), DOWNLOADS_PER_IP_PER_HOUR)) return fail(429, TOO_MANY_TRIES);
  const found = await readAttachment(a.id).catch(() => undefined);
  if (!found || found.bytes.byteLength > MAX_CUSTOMER_DESIGN_BYTES) return fail(404, "File not found");
  return new Response(new Blob([found.bytes as BlobPart]), {
    headers: {
      "content-type": "application/octet-stream", "content-length": String(found.bytes.byteLength),
      "content-disposition": `attachment; filename="${headerName(a.filename)}"`, "x-content-type-options": "nosniff",
      // The design never changes (one per order): kept in this browser only, for an hour.
      "cache-control": "private, max-age=3600",
    },
  });
}

// "Add your design": the customer sends their model later, from their order page (multipart, one file in "design":
// STL or OBJ, one piece, at most 25 MB). Only while Kesuni has nothing to price with (CREATED, no quote, no grams and
// no design a person at Kesuni added) and only one design of their own per order. Then as a design sent with the
// order: checked, stored, weighed by the studio's slicer for the price (nothing prints), and the Chief is woken.
// Before a byte is read: this address's tries, another site, the link, the order's state, this address's designs this
// hour and how many designs are being received now (the same numbers as the order form: src/lib/customer-limits.ts).
export async function POST(req: Request, ctx: Ctx) {
  const ip = clientIp(req);
  const now = Date.now();
  if (!take(tries, ip, now, TRIES_PER_IP_PER_HOUR)) return fail(429, TOO_MANY_TRIES);
  if (crossSite(req)) return fail(403, CROSS_SITE);
  const { token } = await ctx.params;
  const order = orderForToken(token);
  if (!order) return fail(404, "Order not found");
  const closed = customerDesignClosed(order);
  if (closed) return fail(409, closed);
  if (mediaType(req) !== "multipart/form-data") return fail(400, UNREADABLE);
  if (!take(designTries, ip, now, DESIGNS_PER_IP_PER_HOUR)) return fail(429, TOO_MANY_DESIGNS);
  // The slot is held until the file is stored (it is measured then): the design stays in memory until that point.
  const res = await readingDesign(() => receive(req, token, order.id));
  return res === "busy" ? fail(503, BUSY_READING) : res;
}

/** Read, check and store the design of this order (found by this link), then wake the Chief. */
async function receive(req: Request, token: string, orderId: string): Promise<Response> {
  const form = await readFormCapped(req, MAX_CUSTOMER_DESIGN_BYTES + FORM_SLACK);
  if (form === "too-large") return fail(413, DESIGN_TOO_BIG);
  const file = form?.get("design");
  if (!(file instanceof File) || file.size === 0) return fail(400, UNREADABLE);
  const design = { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  const problem = customerDesignContentProblem(design.filename, design.bytes);
  if (problem) return fail(400, "Your design cannot be used", [problem]);
  // Again right before it is stored, by the link: Kesuni may have priced the order, or made a new customer link
  // (replaceCustomerToken), while the file arrived. No await from here to the lock.
  const current = orderForToken(token);
  if (current?.id !== orderId) return fail(404, "Order not found");
  const stillClosed = customerDesignClosed(current);
  if (stillClosed) return fail(409, stillClosed);
  if (adding.has(orderId)) return fail(409, "Your design is still being received. Wait a moment, then reload the page.");
  adding.add(orderId);
  try {
    const stored = await addCustomerDesign(orderId, design);
    if (!stored.stored) return fail(500, "The design could not be stored", ["Saving the file failed on the studio PC"]);
    // While the studio's slicer weighs it, its grams wake the Chief (src/lib/auto-weigh.ts): no run to only wait.
    if (!weighingNow(stored)) wakeChief(orderId, newOrderWake(stored, "later"));
    return NextResponse.json({ ok: true, design: { stored: true, weighing: Boolean(stored.weighing?.ok) } }, { status: 201 });
  } finally {
    adding.delete(orderId);
  }
}
