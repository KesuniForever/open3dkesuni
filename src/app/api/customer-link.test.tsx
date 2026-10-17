import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import * as store from "@/lib/store";
import { addAttachment, setFileStore, type FileStore } from "@/lib/files";
import { proxy } from "@/proxy";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/core";
import type { Order } from "@/lib/types";
import { POST as newLink } from "./orders/[id]/customer-link/route";
import { GET as operatorOrder } from "./orders/[id]/route";
import { GET as customerOrder, POST as customerAct } from "./c/[token]/route";
import { GET as customerFile } from "./c/[token]/files/[fileId]/route";
import { GET as customerDesign, POST as addDesign } from "./c/[token]/design/route";
import { CUSTOMER_UPLOAD_BY } from "@/lib/file-rules";
import { replaceCustomerToken } from "@/lib/actions";
import { OrderNotFound } from "@/app/c/[token]/CustomerView";

// The not-found view's EN | ID switch reads the app router, which no test mounts.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
// GET /api/c/<token> waits on Circle while a payment is under way: `during` runs in that wait.
const circle = vi.hoisted(() => ({ during: undefined as (() => void) | undefined }));
vi.mock("@/lib/customer", async (orig) => {
  const real = await orig<typeof import("@/lib/customer")>();
  return { ...real, refreshPayment: async (orderId: string) => { circle.during?.(); await real.refreshPayment(orderId); } };
});
// A stored design wakes the Chief: never a real one here.
vi.mock("@/lib/agent/chief", async (orig) => ({ ...(await orig<typeof import("@/lib/agent/chief")>()), wakeChief: () => false }));

// POST /api/orders/:id/customer-link: the operator makes a new customer link and every customer route stops answering
// the old one at once (the order page, its photos and its design, Accept / Reject, the review).
const OLD = "oldoldoldoldoldoldoldold";
const order = (id: string, extra: Partial<Order> = {}): Order => ({
  id, jobId: `JOB-${id}`, product: "Lamp", quantity: 1, deadline: "2026-10-30", designVersion: "v1", mandateMicro: 50_000_000,
  status: "EVIDENCE_SUBMITTED", label: "real", customerName: "Aini", customerToken: OLD, ...extra,
});
const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });
const post = (id: string, body: unknown, type = "application/json") =>
  newLink(new Request(`http://x/api/orders/${id}/customer-link`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": type } }), idCtx(id));
const view = (token: string) => customerOrder(new Request(`http://x/api/c/${token}`), tokenCtx(token));
const act = (token: string, body: unknown) =>
  customerAct(new Request(`http://x/api/c/${token}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": "198.18.0.9" } }), tokenCtx(token));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(300).fill(7)]);
const STL = new TextEncoder().encode("solid clip\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 30 0 0\n   vertex 0 12.5 4\n  endloop\n endfacet\nendsolid clip\n");

/** A body that arrives only once the route reads it, and a new customer link is made just before (a slow phone). */
const renewedWhileSent = (bytes: Uint8Array, orderId: string) => new ReadableStream<Uint8Array>({
  pull(c) {
    expect(replaceCustomerToken(orderId, { by: "Khelda" }).ok).toBe(true);
    c.enqueue(bytes);
    c.close();
  },
}, { highWaterMark: 0 });

beforeEach(() => {
  store.resetDb();
  mem.clear();
  setFileStore(files);
  circle.during = undefined;
  store.saveOrder(order("ORD-070"));
});
afterAll(() => setFileStore(undefined));

describe("POST /api/orders/:id/customer-link", () => {
  it("is an operator route: on the public link it needs the operator password, and a post from another site is blocked", () => {
    const tunnel = { host: "kesuni.trycloudflare.com", "cf-connecting-ip": "1.2.3.4" };
    const req = (headers: Record<string, string>) =>
      new NextRequest("http://localhost:3000/api/orders/ORD-070/customer-link", { method: "POST", headers: { host: "localhost:3000", ...headers } });
    const before = process.env.OPERATOR_PASSWORD;
    try {
      delete process.env.OPERATOR_PASSWORD;
      expect(proxy(req(tunnel)).status).toBe(403); // no password set: closed on the public link
      process.env.OPERATOR_PASSWORD = "correct horse";
      expect(proxy(req(tunnel)).status).toBe(401);
      const auth = `Basic ${Buffer.from("operator:correct horse", "utf8").toString("base64")}`;
      expect(proxy(req({ ...tunnel, authorization: auth })).headers.get("x-middleware-next")).toBe("1");
      expect(proxy(req({ ...tunnel, authorization: auth, "sec-fetch-site": "cross-site" })).status).toBe(403);
      // On this computer, from another site: blocked too (the browser re-sends nothing here, but a form could post).
      expect(proxy(req({ "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    } finally {
      if (before === undefined) delete process.env.OPERATOR_PASSWORD;
      else process.env.OPERATOR_PASSWORD = before;
    }
  });

  it("200 with the new link; the operator page then shows it; the old token is never in the answer", async () => {
    const res = await post("ORD-070", { by: "Khelda" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(OLD);
    const { customerLink } = JSON.parse(text) as { customerLink: string };
    const token = store.getOrder("ORD-070")!.customerToken!;
    expect(customerLink).toBe(`/c/${token}`);
    expect(token).not.toBe(OLD);
    const page = await (await operatorOrder(new Request("http://x"), idCtx("ORD-070"))).json();
    expect(page.customerLink).toBe(customerLink);
  });

  it("400 without a JSON body or a name; 404 for no order; nothing changes", async () => {
    expect((await post("ORD-070", { by: "Khelda" }, "text/plain")).status).toBe(400);
    expect((await post("ORD-070", {})).status).toBe(400);
    expect((await post("ORD-070", { by: "Chief" })).status).toBe(400);
    const missing = await post("ORD-404", { by: "Khelda" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "Order not found" });
    expect(store.getOrder("ORD-070")!.customerToken).toBe(OLD);
  });
});

describe("after a new link, the old one stops working everywhere", () => {
  it("the order page, its photos, its design, Accept / Reject and the review: 404 on the old link, the new one works", async () => {
    const photo = await addAttachment("ORD-070", { kind: "qc_photo", filename: "qc.png", bytes: PNG, uploadedBy: "Khelda" });
    expect((await addAttachment("ORD-070", { kind: "design", filename: "clip.stl", bytes: STL, uploadedBy: CUSTOMER_UPLOAD_BY })).ok).toBe(true);
    if (!photo.ok) throw new Error(photo.error);
    const photoOf = (token: string) => customerFile(new Request("http://x"), { params: Promise.resolve({ token, fileId: photo.attachment.id }) });
    const designOf = (token: string) => customerDesign(new Request("http://x", { headers: { "x-forwarded-for": "198.18.0.8" } }), tokenCtx(token));
    // Before: the old link works.
    expect((await view(OLD)).status).toBe(200);
    expect((await photoOf(OLD)).status).toBe(200);
    expect((await designOf(OLD)).status).toBe(200);

    const { customerLink } = await (await post("ORD-070", { by: "Khelda" })).json();
    const token = customerLink.slice("/c/".length);

    expect((await view(OLD)).status).toBe(404);
    expect((await photoOf(OLD)).status).toBe(404);
    expect((await designOf(OLD)).status).toBe(404);
    for (const body of [
      { action: "reject", by: "Someone", note: "no" }, { action: "accept", by: "Someone", note: "", checked: true },
      { action: "review", quality: 1, communication: 1, value: 1, text: "bad", by: "Someone" }, { action: "pay", agree: true, by: "Someone" },
    ]) {
      expect((await act(OLD, body)).status, body.action).toBe(404);
    }
    expect(store.getOrder("ORD-070")!.status).toBe("EVIDENCE_SUBMITTED");
    expect(store.getAcceptance("ORD-070")).toBeUndefined();

    const fresh = await view(token);
    expect(fresh.status).toBe(200);
    const v = await fresh.json();
    expect(v.order.id).toBe("ORD-070");
    // The photo links on the order page carry the new token.
    expect(JSON.stringify(v)).not.toContain(OLD);
    expect((await photoOf(token)).status).toBe(200);
    expect((await designOf(token)).status).toBe(200);
  });

  it("the old link's order page shows the not-found view, which says the link may have been replaced", () => {
    const render = (locale: Locale) => renderToStaticMarkup(
      <LocaleProvider locale={locale}><OrderNotFound whatsapp="6281234567890" /></LocaleProvider>,
    ).replace(/&#x27;/g, "'");
    const en = render("en");
    expect(en).toContain("We can't find this order. The link may be cut off or replaced by a new one, or the order was cancelled.");
    expect(en).toContain('href="/customer?tab=orders"');
    expect(en).toContain("Chat Kesuni on WhatsApp");
    // The chat starts with a fixed line, never the dead link: a link seen in a video is no proof of who asks.
    expect(en).toContain(`href="https://wa.me/6281234567890?text=${encodeURIComponent("My order link does not work.")}"`);
    const id = render("id");
    expect(id).toContain("Pesanan ini tidak ditemukan. Mungkin link-nya terpotong atau sudah diganti link baru, atau pesanan sudah dibatalkan.");
    expect(id).toContain(`?text=${encodeURIComponent("Link pesanan saya tidak bisa dibuka.")}"`);
  });

  it("a new link made while the order page waits on Circle: 404, like the old link (not a crash)", async () => {
    circle.during = () => { expect(replaceCustomerToken("ORD-070", { by: "Khelda" }).ok).toBe(true); };
    const res = await view(OLD);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Order not found" });
  });

  it("a new link made while a Reject or Accept is still arriving: 404, nothing decided", async () => {
    for (const body of [{ action: "reject", by: "Someone", note: "no" }, { action: "accept", by: "Someone", note: "", checked: true }]) {
      store.saveOrder(order("ORD-070"));
      const res = await customerAct(new Request(`http://x/api/c/${OLD}`, {
        method: "POST", body: renewedWhileSent(new TextEncoder().encode(JSON.stringify(body)), "ORD-070"), duplex: "half",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.18.0.10" },
      } as RequestInit), tokenCtx(OLD));
      expect(res.status, body.action).toBe(404);
      expect(store.getOrder("ORD-070")!.customerToken).not.toBe(OLD);
      expect(store.getOrder("ORD-070")!.status).toBe("EVIDENCE_SUBMITTED");
      expect(store.getAcceptance("ORD-070")).toBeUndefined();
    }
  });

  it("a new link made while \"Add your design\" is still arriving: 404, nothing stored", async () => {
    store.saveOrder(order("ORD-070", { status: "CREATED" })); // nothing priced yet: a design can still come
    const form = new FormData();
    form.set("design", new File([STL as BlobPart], "clip.stl"));
    const probe = new Request("http://x", { method: "POST", body: form });
    const bytes = new Uint8Array(await probe.arrayBuffer());
    const res = await addDesign(new Request(`http://x/api/c/${OLD}/design`, {
      method: "POST", body: renewedWhileSent(bytes, "ORD-070"), duplex: "half",
      headers: { "content-type": probe.headers.get("content-type")!, "x-forwarded-for": "198.18.0.11" },
    } as RequestInit), tokenCtx(OLD));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Order not found" });
    expect(store.listAttachments("ORD-070")).toEqual([]);
  });
});
