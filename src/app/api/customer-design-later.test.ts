import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { addAttachment, setFileStore, type FileStore } from "@/lib/files";
import { ingestReport } from "@/lib/printer/actions";
import { mergeReport } from "@/lib/printer/bambu";
import { noteSlicerPoll, resetSlicerSeen, storeSliceResult, updateSliceItem } from "@/lib/slicing";
import { fake3mf, makeZip } from "@/lib/threemf.test-helper";
import { CUSTOMER_UPLOAD_BY } from "@/lib/file-rules";
import { customerCreateOrder, customerView as viewOf } from "@/lib/customer";
import { quoteByWeight, setSlicerGrams } from "@/lib/agreement";
import { addCustomerDesign } from "@/lib/auto-weigh";
import { GET as download, POST as addDesign } from "./c/[token]/design/route";
import { GET as orderFile } from "./c/[token]/files/[fileId]/route";
import { POST as createOrder } from "./c/route";

// "Add your design" on the customer's order page (POST /api/c/<token>/design) and the customer's own design back for
// the 3D view (GET). Same rules and limits as a design sent with the order form; nothing here prints.
const wake = vi.hoisted(() => vi.fn<(orderId: string, trigger: string) => boolean>(() => true));
vi.mock("@/lib/agent/chief", async (orig) => ({ ...(await orig<typeof import("@/lib/agent/chief")>()), wakeChief: wake }));

const INVITE = "kesuni-pilot-2026";
const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const STL = new TextEncoder().encode("solid clip\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 30 0 0\n   vertex 0 12.5 4\n  endloop\n endfacet\nendsolid clip\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(300).fill(7)]);
const PROJECT = makeZip([
  { name: "3D/3dmodel.model", data: "<model/>" },
  { name: "Metadata/project_settings.config", data: JSON.stringify({ printer_model: "Bambu Lab A1", nozzle_diameter: ["0.4"], filament_colour: ["#FFFFFF"], filament_type: ["PLA"] }) },
]);
const SLICED = fake3mf({ projectColours: ["#FEC600"], plates: [{ index: 1, weight: 16.4, prediction: 1500, filaments: [{ id: 1, type: "PLA", color: "#FEC600", usedG: 16.4 }] }] });
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
let ip = 0;
const nextIp = () => `198.18.${Math.floor(++ip / 250)}.${ip % 250}`;

function order(extra: Partial<Parameters<typeof customerCreateOrder>[0]> = {}) {
  const r = customerCreateOrder({ name: "Aini", product: "Clip", quantity: 3, deadline: "2026-10-30", budgetIdr: 500_000, note: "", ...extra });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.order;
}
/** The multipart body the order page sends, and its content type. */
async function multipart(design?: { name: string; bytes: Uint8Array }) {
  const form = new FormData();
  if (design) form.set("design", new File([design.bytes as BlobPart], design.name));
  const probe = new Request("http://x", { method: "POST", body: form });
  return { bytes: new Uint8Array(await probe.arrayBuffer()), type: probe.headers.get("content-type")! };
}
/** "Add your design" from the order page, from a new network address each time unless one is given. */
async function upload(token: string, design?: { name: string; bytes: Uint8Array }, headers: Record<string, string> = {}) {
  const { bytes, type } = await multipart(design);
  return addDesign(new Request(`http://x/api/c/${token}/design`, {
    method: "POST", body: bytes as BodyInit,
    headers: { "content-type": type, "content-length": String(bytes.byteLength), "x-forwarded-for": nextIp(), ...headers },
  }), ctx(token));
}
/** A body that arrives only after `release()` (a slow phone); `started` once the route begins reading it. */
function slowBody(bytes: Uint8Array) {
  let release!: () => void;
  const open = new Promise<void>((r) => { release = r; });
  const state = { started: false };
  const body = new ReadableStream<Uint8Array>({ async pull(c) { state.started = true; await open; c.enqueue(bytes); c.close(); } });
  return { body, release, state };
}
const get = (token: string, from = nextIp()) => download(new Request(`http://x/api/c/${token}/design`, { headers: { "x-forwarded-for": from } }), ctx(token));
const mine = (orderId: string) => store.listAttachments(orderId).filter((a) => a.uploadedBy === CUSTOMER_UPLOAD_BY);

beforeEach(() => {
  store.resetDb();
  mem.clear();
  resetSlicerSeen();
  setFileStore(files);
  wake.mockClear();
  process.env.CUSTOMER_INVITE_CODE = INVITE;
  ingestReport("a1", mergeReport(undefined, { print: {
    gcode_state: "IDLE", sdcard: true, nozzle_diameter: "0.4",
    ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }] }] },
  } }, new Date().toISOString())!, []);
});
afterAll(() => {
  setFileStore(undefined);
  delete process.env.CUSTOMER_INVITE_CODE;
});

describe("POST /api/c/<token>/design: the customer adds their design later", () => {
  it("stores it as the customer's, measures it, weighs it and wakes the Chief, exactly like a design sent with the order", async () => {
    noteSlicerPoll();
    const o = order();
    expect(viewOf(o, o.customerToken!)).toMatchObject({ design: null, canAddDesign: true });
    const res = await upload(o.customerToken!, { name: "Clip (v2).stl", bytes: STL });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, design: { stored: true, weighing: true } });
    expect(mine(o.id)).toEqual([expect.objectContaining({ kind: "design", filename: "Clip (v2).stl", mesh: { sizeMm: [30, 12.5, 4], triangles: 1 } })]);
    expect(store.listSliceJobs({ orderId: o.id })).toEqual([expect.objectContaining({ actor: "system", state: "queued", sourceName: "Clip (v2).stl" })]);
    expect(store.listLog(o.id).map((e) => e.tool)).toEqual(["customer_design", "slice_request"]);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake.mock.calls[0]).toEqual([o.id, expect.stringMatching(
      /^The customer just added their own design to this order on their order page\. The studio's slicer is weighing it automatically: wait for slicerGrams .* do not ask the operator/)]);
    expect(viewOf(store.getOrder(o.id)!, o.customerToken!)).toMatchObject({
      design: { name: "Clip (v2).stl", sizeMm: [30, 12.5, 4], state: "weighing", estimate: null, priced: false }, canAddDesign: false,
    });
  });

  it("one design of the customer's own per order", async () => {
    const o = order();
    expect((await upload(o.customerToken!, { name: "Clip.stl", bytes: STL })).status).toBe(201);
    const again = await upload(o.customerToken!, { name: "Other.stl", bytes: STL });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("Your order already has your design. To change it, message Kesuni.");
    expect(store.listAttachments(o.id).map((a) => a.filename)).toEqual(["Clip.stl"]);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("Kesuni already has a design (a person added it, e.g. the 3MF from WhatsApp): no \"Add your design\", the file stays", async () => {
    const o = order();
    const person = await addAttachment(o.id, { kind: "design", filename: "From WhatsApp.3mf", bytes: PROJECT, uploadedBy: "Khelda" });
    expect(person.ok).toBe(true);
    // A photo for reference is not a design: the customer may still add theirs.
    const photo = order();
    expect((await addAttachment(photo.id, { kind: "reference", filename: "look.png", bytes: PNG, uploadedBy: "Khelda" })).ok).toBe(true);
    expect(viewOf(store.getOrder(photo.id)!, photo.customerToken!).canAddDesign).toBe(true);

    expect(viewOf(store.getOrder(o.id)!, o.customerToken!)).toMatchObject({ design: null, canAddDesign: false });
    const res = await upload(o.customerToken!, { name: "Clip.stl", bytes: STL });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Kesuni already has a design for this order. To change it, message Kesuni.");
    expect(store.listAttachments(o.id).map((a) => a.filename)).toEqual(["From WhatsApp.3mf"]);
    expect(store.listSliceJobs({ orderId: o.id })).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
  });

  it("only while Kesuni has nothing to price with: refused once a quote or grams exist, and in any other status", async () => {
    const quoted = order();
    expect(quoteByWeight(quoted.id, { gramsPerUnit: 10, source: "Bambu Studio", by: "human" }).ok).toBe(true);
    const planned = order();
    store.saveOrder({ ...store.getOrder(planned.id)!, status: "PLAN_CHOSEN" });
    for (const o of [quoted, planned]) {
      const res = await upload(o.customerToken!, { name: "Clip.stl", bytes: STL });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("Kesuni has already priced your order. To send a design now, message Kesuni.");
      expect(store.listAttachments(o.id)).toEqual([]);
      expect(viewOf(store.getOrder(o.id)!, o.customerToken!).canAddDesign).toBe(false);
    }
    // A person entered the grams already: they stay, so a weighing would change nothing.
    const weighed = order();
    expect(setSlicerGrams(weighed.id, { gramsPerUnit: 12, source: "Bambu Studio, plate 1", by: "Khelda" }).ok).toBe(true);
    const res = await upload(weighed.customerToken!, { name: "Clip.stl", bytes: STL });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Kesuni is already pricing your order. To send a design now, message Kesuni.");
    expect(store.listAttachments(weighed.id)).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
  });

  it("Kesuni prices the order while the file arrives: checked again before it is stored", async () => {
    const o = order();
    const { bytes, type } = await multipart({ name: "Clip.stl", bytes: STL });
    const slow = slowBody(bytes);
    const pending = addDesign(new Request("http://x", {
      method: "POST", body: slow.body, duplex: "half", headers: { "content-type": type, "x-forwarded-for": nextIp() },
    } as RequestInit), ctx(o.customerToken!));
    await vi.waitFor(() => expect(slow.state.started).toBe(true));
    expect(quoteByWeight(o.id, { gramsPerUnit: 10, source: "Bambu Studio", by: "human" }).ok).toBe(true);
    slow.release();
    expect((await pending).status).toBe(409);
    expect(store.listAttachments(o.id)).toEqual([]);
  });

  it("checks the link, the site, the body and the file before anything is stored", async () => {
    const o = order();
    const token = o.customerToken!;
    const json = (body: unknown) => addDesign(new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify(body),
    }), ctx(token));
    const cases: [Promise<Response>, number, string, string[]?][] = [
      [upload("nope-nope-nope-nope-nope", { name: "Clip.stl", bytes: STL }), 404, "Order not found"],
      [upload(token, { name: "Clip.stl", bytes: STL }, { "sec-fetch-site": "cross-site" }), 403, "Blocked: this request came from another site."],
      [json({ design: "solid x" }), 400, "Your design could not be read. Please try again."],
      [upload(token), 400, "Your design could not be read. Please try again."],
      [upload(token, { name: "Clip.stl", bytes: PNG }), 400, "Your design cannot be used", ["This STL file is broken or empty. Export it again and send it."]],
      [upload(token, { name: "plate.3mf", bytes: SLICED }), 400, "Your design cannot be used", ["Export your model as an STL or OBJ. Send a 3MF project on WhatsApp."]],
    ];
    for (const [res, status, error, reasons] of cases) {
      const r = await res;
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error, ...(reasons ? { reasons } : {}) });
    }
    // Too big by the size it gives (never read), or while it arrives when it gives none.
    const unread = new ReadableStream<Uint8Array>({ pull() { throw new Error("the body was read"); } });
    const said = await addDesign(new Request("http://x", {
      method: "POST", body: unread, duplex: "half",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(26 * 1024 * 1024), "x-forwarded-for": nextIp() },
    } as RequestInit), ctx(token));
    expect(said.status).toBe(413);
    const big = new Uint8Array(25 * 1024 * 1024 + 20 * 1024);
    const chunked = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < big.length; i += 1 << 20) c.enqueue(big.subarray(i, i + (1 << 20))); c.close(); } });
    const arrived = await addDesign(new Request("http://x", {
      method: "POST", body: chunked, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=x", "x-forwarded-for": nextIp() },
    } as RequestInit), ctx(token));
    expect(arrived.status).toBe(413);
    expect((await arrived.json()).error).toBe("Your design is larger than 25 MB. Send it on WhatsApp instead.");
    expect(store.listAttachments(o.id)).toEqual([]);
    expect(mem.size).toBe(0);
    expect(wake).not.toHaveBeenCalled();
  });

  it("counts tries and designs per address with the order form's numbers, before reading the body", async () => {
    const from = { "x-forwarded-for": "192.0.2.77" };
    // 10 refused designs on 10 orders from one address: the 11th design is refused before it is read, here and on the order form.
    for (let i = 0; i < 10; i++) expect((await upload(order().customerToken!, { name: "Clip.stl", bytes: PNG }, from)).status).toBe(400);
    const eleventh = await upload(order().customerToken!, { name: "Clip.stl", bytes: STL }, from);
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).error).toBe("Too many designs sent in one hour. Try again later or contact Kesuni.");
    const { bytes, type } = await multipart({ name: "Clip.stl", bytes: STL });
    const form = await createOrder(new Request("http://x/api/c", {
      method: "POST", body: bytes as BodyInit, headers: { "content-type": type, "x-invite": INVITE, ...from },
    }));
    expect(form.status).toBe(429);
    // Every try counts (30 an hour, both routes together): wrong links too.
    for (let i = 0; i < 17; i++) expect((await upload("nope-nope-nope-nope-nope", undefined, from)).status).toBe(404);
    expect((await upload(order().customerToken!, { name: "Clip.stl", bytes: STL }, from)).status).toBe(429);
    expect((await upload("nope-nope-nope-nope-nope", undefined, from)).status).toBe(429);
    // Another address is not affected.
    expect((await upload(order().customerToken!, { name: "Clip.stl", bytes: STL })).status).toBe(201);
  });

  it("reads at most two designs at once, together with the order form", async () => {
    const o = order();
    const { bytes, type } = await multipart({ name: "Clip.stl", bytes: STL });
    const a = slowBody(bytes), b = slowBody(bytes);
    const first = createOrder(new Request("http://x/api/c", {
      method: "POST", body: a.body, duplex: "half", headers: { "content-type": type, "x-invite": INVITE, "x-forwarded-for": nextIp() },
    } as RequestInit));
    const second = addDesign(new Request("http://x", {
      method: "POST", body: b.body, duplex: "half", headers: { "content-type": type, "x-forwarded-for": nextIp() },
    } as RequestInit), ctx(order().customerToken!));
    await vi.waitFor(() => expect(a.state.started && b.state.started).toBe(true));
    const third = await upload(o.customerToken!, { name: "Clip.stl", bytes: STL });
    expect(third.status).toBe(503);
    expect((await third.json()).error).toBe("Kesuni is receiving other designs right now. Try again in a minute.");
    a.release();
    b.release();
    expect((await first).status).toBe(404); // read, then refused: the form itself holds no invite code
    expect((await second).status).toBe(201);
    expect((await upload(o.customerToken!, { name: "Clip.stl", bytes: STL })).status).toBe(201);
  });

  it("a slot is held until the design is stored (it is measured then), on both routes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let storing = 0;
    setFileStore({ ...files, async put(k, b) { storing++; await gate; mem.set(k, b); } });
    // The order form with a design (every field, the invite in the header too), and "Add your design" on another order.
    const form = new FormData();
    const fields = { invite: INVITE, name: "Aini", product: "Clip", quantity: "2", deadline: "2026-10-30", budgetIdr: "300000", note: "", colors: "[]" };
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set("design", new File([STL as BlobPart], "Clip.stl"));
    const probe = new Request("http://x/api/c", { method: "POST", body: form });
    const first = createOrder(new Request("http://x/api/c", {
      method: "POST", body: new Uint8Array(await probe.arrayBuffer()) as BodyInit,
      headers: { "content-type": probe.headers.get("content-type")!, "x-invite": INVITE, "x-forwarded-for": nextIp() },
    }));
    const second = upload(order().customerToken!, { name: "Clip.stl", bytes: STL });
    await vi.waitFor(() => expect(storing).toBe(2));
    // Both arrived and were read: they are still being stored, so a third design waits.
    const later = order();
    const third = await upload(later.customerToken!, { name: "Clip.stl", bytes: STL });
    expect(third.status).toBe(503);
    expect(mine(later.id)).toEqual([]);
    release();
    expect((await first).status).toBe(201);
    expect((await second).status).toBe(201);
    expect((await upload(later.customerToken!, { name: "Clip.stl", bytes: STL })).status).toBe(201);
  });

  it("the same order twice at once: the second is refused while the first is stored", async () => {
    const o = order();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setFileStore({ ...files, async put(k, b) { await gate; mem.set(k, b); } });
    const first = upload(o.customerToken!, { name: "Clip.stl", bytes: STL });
    const busy = (globalThis as unknown as { __kesuniDesignAdding: Set<string> }).__kesuniDesignAdding;
    await vi.waitFor(() => expect(busy.has(o.id)).toBe(true));
    const second = await upload(o.customerToken!, { name: "Other.stl", bytes: STL });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Your design is still being received. Wait a moment, then reload the page.");
    release();
    expect((await first).status).toBe(201);
    expect(mine(o.id).map((a) => a.filename)).toEqual(["Clip.stl"]);
    expect(busy.has(o.id)).toBe(false);
  });

  it("a disk error: nothing stored, the Chief is not woken, and the customer can try again", async () => {
    const o = order();
    setFileStore({ ...files, async put() { throw new Error("EACCES: permission denied, open 'L:/kesuni/files/F-1.stl'"); } });
    const res = await upload(o.customerToken!, { name: "Clip.stl", bytes: STL });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "The design could not be stored", reasons: ["Saving the file failed on the studio PC"] });
    expect(store.listAttachments(o.id)).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
    expect(viewOf(store.getOrder(o.id)!, o.customerToken!).canAddDesign).toBe(true);
  });
});

describe("GET /api/c/<token>/design: the customer's own design back, for the 3D view", () => {
  it("exactly the file the customer sent, as a download kept in their browser only", async () => {
    const o = order();
    await addCustomerDesign(o.id, { filename: "Kunci «baru» (v2).stl", bytes: STL });
    const res = await get(o.customerToken!);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(STL);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "application/octet-stream", "content-length": String(STL.byteLength), "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600", "content-disposition": 'attachment; filename="Kunci _baru_ (v2).stl"',
    });
    // Another order's link, or a link that is no order: nothing.
    expect((await get(order().customerToken!)).status).toBe(404);
    expect((await get("nope-nope-nope-nope-nope")).status).toBe(404);
    expect((await get("../../etc")).status).toBe(404);
  });

  it("never a sliced file, never a file a person added, never a 3MF even under the customer's name", async () => {
    noteSlicerPoll();
    const person = order();
    await addAttachment(person.id, { kind: "design", filename: "Kesuni.stl", bytes: STL, uploadedBy: "Khelda" });
    expect((await get(person.customerToken!)).status).toBe(404);
    const project = order();
    await addAttachment(project.id, { kind: "design", filename: "plate.3mf", bytes: PROJECT, uploadedBy: CUSTOMER_UPLOAD_BY });
    expect((await get(project.customerToken!)).status).toBe(404);

    // After the automatic weighing the order holds the sliced .gcode.3mf too: still only the customer's STL comes back.
    const o = order();
    const d = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: STL });
    const job = d.weighing?.ok ? d.weighing.job : null;
    expect(job).not.toBeNull();
    updateSliceItem(job!.id, { state: "slicing" });
    const sliced = await storeSliceResult(job!.id, SLICED);
    expect(sliced.ok).toBe(true);
    expect(store.listAttachments(o.id)).toHaveLength(2);
    expect(new Uint8Array(await (await get(o.customerToken!)).arrayBuffer())).toEqual(STL);
    // The order's files route still refuses every design, the customer's included.
    for (const a of store.listAttachments(o.id)) {
      expect((await orderFile(new Request("http://x"), { params: Promise.resolve({ token: o.customerToken!, fileId: a.id }) })).status).toBe(404);
    }
  });

  it("at most 30 downloads per address per hour (a phone keeps it for an hour)", async () => {
    const o = order();
    await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: STL });
    for (let i = 0; i < 30; i++) expect((await get(o.customerToken!, "192.0.2.200")).status).toBe(200);
    expect((await get(o.customerToken!, "192.0.2.200")).status).toBe(429);
    expect((await get(o.customerToken!, "192.0.2.201")).status).toBe(200);
  });
});
