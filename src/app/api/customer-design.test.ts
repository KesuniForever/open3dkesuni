import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import * as store from "@/lib/store";
import { setFileStore, type FileStore } from "@/lib/files";
import { ingestReport } from "@/lib/printer/actions";
import { mergeReport } from "@/lib/printer/bambu";
import { resetSlicerSeen } from "@/lib/slicing";
import { fake3mf } from "@/lib/threemf.test-helper";
import { CUSTOMER_UPLOAD_BY } from "@/lib/file-rules";
import { POST as createOrder } from "./c/route";
import { GET as customerView } from "./c/[token]/route";
import { GET as customerFile } from "./c/[token]/files/[fileId]/route";
import { GET as queue } from "./slicer/queue/route";
import { POST as queueItem } from "./slicer/queue/[id]/route";
import { POST as result } from "./slicer/jobs/[id]/result/route";

// The customer sends their own design with the order (one multipart request): checked, stored, weighed by the studio's
// slicer and priced by the Chief without anyone at Kesuni touching the order first. Nothing here prints.
const wake = vi.hoisted(() => vi.fn<(orderId: string, trigger: string) => boolean>(() => true));
vi.mock("@/lib/agent/chief", async (orig) => ({ ...(await orig<typeof import("@/lib/agent/chief")>()), wakeChief: wake }));

const INVITE = "kesuni-pilot-2026";
const TOKEN = "bridge-token-123";
const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const STL = new TextEncoder().encode("solid clip\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid clip\n");
const SLICED = fake3mf({ projectColours: ["#FEC600"], plates: [{ index: 1, weight: 12.5, prediction: 1500, filaments: [{ id: 1, type: "PLA", color: "#FEC600", usedG: 12.5 }] }] });
const bridge = { authorization: `Bearer ${TOKEN}` };
const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
let ip = 0;

/**
 * The order form's multipart request (the invite also in x-invite, as the form sends it), from a new network address
 * each time (the hourly limits are per address).
 */
async function send(fields: Record<string, string>, design?: { name: string; bytes: Uint8Array }, headers: Record<string, string> = {}) {
  const form = new FormData();
  const all = { invite: INVITE, name: "Aini", product: "Clip", quantity: "2", deadline: "2026-10-30", budgetIdr: "300000", note: "", colors: "[]", ...fields };
  for (const [k, v] of Object.entries(all)) form.set(k, v);
  if (design) form.set("design", new File([design.bytes as BlobPart], design.name));
  // A real browser sends the body's size: build it the way fetch would.
  const probe = new Request("http://x/api/c", { method: "POST", body: form });
  const bytes = new Uint8Array(await probe.arrayBuffer());
  return createOrder(new Request("http://x/api/c", {
    method: "POST", body: bytes as BodyInit,
    headers: {
      "content-type": probe.headers.get("content-type")!, "content-length": String(bytes.byteLength), "x-invite": encodeURIComponent(INVITE),
      "x-forwarded-for": `203.0.113.${++ip}`, ...headers,
    },
  }));
}
/** A multipart request whose body never ends until `release` (a slow phone upload), or a raw body. */
function multipart(body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request("http://x/api/c", {
    method: "POST", body, duplex: "half",
    headers: { "content-type": "multipart/form-data; boundary=x", "x-invite": INVITE, "x-forwarded-for": `198.51.100.${++ip}`, ...headers },
  } as RequestInit);
}
const orders = () => store.listOrders().filter((o) => o.label === "real");

beforeEach(() => {
  store.resetDb();
  mem.clear();
  resetSlicerSeen();
  setFileStore(files);
  wake.mockClear();
  process.env.CUSTOMER_INVITE_CODE = INVITE;
  process.env.PRINTER_BRIDGE_TOKEN = TOKEN;
  ingestReport("a1", mergeReport(undefined, { print: {
    gcode_state: "IDLE", sdcard: true, nozzle_diameter: "0.4",
    ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }] }] },
  } }, new Date().toISOString())!, []);
});
afterEach(() => { delete process.env.PRINTER_BRIDGE_TOKEN; });
afterAll(() => {
  setFileStore(undefined);
  delete process.env.CUSTOMER_INVITE_CODE;
});

describe("POST /api/c with the customer's design", () => {
  it("creates the order, stores the design and weighs it; the slice result sets the grams and wakes the Chief to price", async () => {
    await queue(new Request("http://x/api/slicer/queue", { headers: bridge })); // the studio PC's slicer is there
    const res = await send({}, { name: "Clip.stl", bytes: STL });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ link: expect.stringMatching(/^\/c\/[\w-]{24}$/), design: { stored: true, weighing: true } });
    const [o] = orders();
    expect(store.listAttachments(o.id)).toEqual([expect.objectContaining({ kind: "design", filename: "Clip.stl", uploadedBy: CUSTOMER_UPLOAD_BY })]);
    expect(wake).toHaveBeenCalledWith(o.id, expect.stringMatching(/weighing it automatically: wait for slicerGrams/));

    // The studio PC weighs it.
    const { slices } = await (await queue(new Request("http://x/api/slicer/queue", { headers: bridge }))).json();
    expect(slices).toEqual([expect.objectContaining({ orderId: o.id, sourceName: "Clip.stl", material: "PLA", quality: "standard", supports: "auto" })]);
    const id = slices[0].id as string;
    const ctx = { params: Promise.resolve({ id }) };
    await queueItem(new Request(`http://x/api/slicer/queue/${id}`, { method: "POST", headers: { ...bridge, "content-type": "application/json" }, body: JSON.stringify({ state: "slicing" }) }), ctx);
    const done = await result(new Request(`http://x/api/slicer/jobs/${id}/result`, {
      method: "POST", body: SLICED as BodyInit, headers: { ...bridge, "content-type": "model/3mf", "x-file-md5": md5(SLICED) },
    }), ctx);
    expect(done.status).toBe(201);
    expect(store.getOrder(o.id)!.slicerGrams).toMatchObject({ gramsPerUnit: 12.5, by: "slicer" });
    expect(wake).toHaveBeenLastCalledWith(o.id, "The studio's slicer weighed the customer's design: 12.5 g per unit, single colour (slicerGrams). Price it by weight and continue.");

    // The customer sees the grams per piece, never the file.
    const token = body.link.slice(3);
    const view = await (await customerView(new Request("http://x"), { params: Promise.resolve({ token }) })).json();
    expect(view.design).toEqual({ state: "weighed", gramsPerPiece: 12.5 });
    const text = JSON.stringify(view);
    for (const a of store.listAttachments(o.id)) {
      expect(text).not.toContain(a.id);
      expect(text).not.toContain(a.filename);
      expect(text).not.toContain(a.storageKey);
    }
  });

  it("checks the invite before anything is stored, and the header's before the body is read", async () => {
    const res = await send({ invite: "wrong" }, { name: "Clip.stl", bytes: STL });
    expect(res.status).toBe(404);
    // A wrong code in the header: 404 at once, even for a body that says it is far too big (it is never read).
    const unread = new ReadableStream<Uint8Array>({ pull() { throw new Error("the body was read"); } });
    expect((await createOrder(multipart(unread, { "x-invite": "wrong", "content-length": String(60 * 1024 * 1024) }))).status).toBe(404);
    expect((await send({}, { name: "Clip.stl", bytes: STL }, { "x-invite": "" })).status).toBe(404);
    // Same number of characters as the code, one of them accented (more bytes): 404, not an error.
    const accented = `${INVITE.slice(0, -1)}é`;
    expect((await send({}, { name: "Clip.stl", bytes: STL }, { "x-invite": encodeURIComponent(accented) })).status).toBe(404);
    expect((await send({ invite: accented }, { name: "Clip.stl", bytes: STL })).status).toBe(404);
    const json = await createOrder(new Request("http://x/api/c", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.201" },
      body: JSON.stringify({ invite: accented, name: "A", product: "B", quantity: 1, deadline: "2026-10-30", budgetIdr: 50000 }),
    }));
    expect(json.status).toBe(404);
    expect(orders()).toEqual([]);
    expect(mem.size).toBe(0);
    expect(store.listSliceJobs()).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
  });

  it("refuses a file that is not what it says, and then creates no order", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(300).fill(7)]);
    const res = await send({}, { name: "Clip.stl", bytes: png });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Your design cannot be used", reasons: ["This STL file is broken or empty. Export it again and send it."] });
    // A 3MF brings its own printer settings and G-code: customers send an STL or OBJ.
    const project = await send({}, { name: "plate.3mf", bytes: SLICED });
    expect((await project.json()).reasons).toEqual(["Export your model as an STL or OBJ. Send a 3MF project on WhatsApp."]);
    expect(orders()).toEqual([]);
    expect(mem.size).toBe(0);
  });

  it("refuses a body over 25 MB by the size it gives, or while it arrives when it gives none; a broken form is not a wrong link", async () => {
    expect((await createOrder(multipart("x", { "content-length": String(26 * 1024 * 1024) }))).status).toBe(413);
    // No size given (sent in chunks): counted as it arrives, and refused once it passes the limit.
    const big = new Uint8Array(25 * 1024 * 1024 + 70 * 1024);
    const chunked = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < big.length; i += 1 << 20) c.enqueue(big.subarray(i, i + (1 << 20))); c.close(); } });
    const unsized = await createOrder(multipart(chunked));
    expect(unsized.status).toBe(413);
    expect((await unsized.json()).error).toBe("Your design is larger than 25 MB. Send it on WhatsApp instead.");
    const broken = await createOrder(multipart("--x\r\nnot a form"));
    expect(broken.status).toBe(400);
    expect((await broken.json()).error).toBe("Your order could not be read. Please try again.");
    const crossSite = await send({}, { name: "Clip.stl", bytes: STL }, { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(orders()).toEqual([]);
  });

  it("counts every try per address, refused ones too, before reading the body", async () => {
    const from = { "x-forwarded-for": "192.0.2.10" };
    for (let i = 0; i < 10; i++) expect((await send({ invite: "wrong" }, { name: "Clip.stl", bytes: STL }, from)).status).toBe(404);
    const designs = await send({}, { name: "Clip.stl", bytes: STL }, from);
    expect(designs.status).toBe(429);
    expect((await designs.json()).error).toBe("Too many designs sent in one hour. Try again later or contact Kesuni.");
    const json = () => createOrder(new Request("http://x/api/c", {
      method: "POST", headers: { "content-type": "application/json", ...from }, body: JSON.stringify({ invite: "wrong" }),
    }));
    for (let i = 0; i < 19; i++) expect((await json()).status).toBe(404); // 30 tries in all
    expect((await json()).status).toBe(429);
    expect((await send({}, { name: "Clip.stl", bytes: STL })).status).toBe(201); // another address is not affected
  });

  it("reads at most two designs at the same time; the next one is asked to try again", async () => {
    let release!: () => void;
    const open = new Promise<void>((r) => { release = r; });
    const slow = () => multipart(new ReadableStream<Uint8Array>({ async pull(c) { await open; c.close(); } }));
    const first = createOrder(slow());
    const second = createOrder(slow());
    const third = await send({}, { name: "Clip.stl", bytes: STL });
    expect(third.status).toBe(503);
    expect((await third.json()).error).toBe("Kesuni is receiving other designs right now. Try again in a minute.");
    release();
    expect((await first).status).toBe(400); // an empty form
    expect((await second).status).toBe(400);
    expect((await send({}, { name: "Clip.stl", bytes: STL })).status).toBe(201);
  });

  it("a disk error while storing the design still answers with the order link, once, and the Chief asks for the grams", async () => {
    setFileStore({ ...files, async put() { throw new Error("EACCES: permission denied"); } });
    const res = await send({}, { name: "Clip.stl", bytes: STL });
    expect(res.status).toBe(201);
    expect((await res.json()).design).toEqual({ stored: false, weighing: false });
    expect(orders()).toHaveLength(1);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(orders()[0].id, expect.stringMatching(/ask the operator/));
  });

  it("no printer reports or the slicer is quiet: the order is still created and a person weighs it", async () => {
    // The slicer never asked for work in this test.
    const res = await send({}, { name: "Clip.stl", bytes: STL });
    expect(res.status).toBe(201);
    expect((await res.json()).design).toEqual({ stored: true, weighing: false });
    const [o] = orders();
    expect(store.listAttachments(o.id)).toHaveLength(1);
    expect(store.listSliceJobs()).toEqual([]);
    expect(wake).toHaveBeenCalledWith(o.id, expect.stringMatching(/automatic weighing could not start .*ask the operator/));
  });

  it("without a design, multipart and JSON orders work as before", async () => {
    const res = await send({ material: "PLA", colors: JSON.stringify([{ type: "PLA", color: "#FEC600" }]) });
    expect(res.status).toBe(201);
    expect((await res.json()).design).toBeUndefined();
    expect(orders()[0]).toMatchObject({ material: "PLA", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }], quantity: 2, budgetIdr: 300_000 });
    expect(wake).toHaveBeenCalledWith(orders()[0].id, expect.stringMatching(/^A customer just placed this order through the order form\. Prepare it/));
    const json = await createOrder(new Request("http://x/api/c", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.200" },
      body: JSON.stringify({ invite: INVITE, name: "A", product: "B", quantity: 1, deadline: "2026-10-30", budgetIdr: 50000 }),
    }));
    expect(json.status).toBe(201);
    const badColours = await send({ colors: "not json" });
    expect((await badColours.json()).reasons).toEqual(["Colours must be a list"]);
  });

  it("the customer's design is never served back on their order link", async () => {
    await queue(new Request("http://x/api/slicer/queue", { headers: bridge }));
    const body = await (await send({}, { name: "Clip.stl", bytes: STL })).json();
    const [o] = orders();
    const token = body.link.slice(3);
    const [design] = store.listAttachments(o.id);
    const res = await customerFile(new Request("http://x"), { params: Promise.resolve({ token, fileId: design.id }) });
    expect(res.status).toBe(404);
    const view = await (await customerView(new Request("http://x"), { params: Promise.resolve({ token }) })).json();
    expect(view.design).toEqual({ state: "weighing" });
    expect(JSON.stringify(view)).not.toContain(design.id);
  });
});
