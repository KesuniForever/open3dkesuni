import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { chooseQuote, addEvidence } from "./actions";
import { addAttachment, setFileStore, type FileStore } from "./files";
import { GET as download } from "@/app/api/files/[id]/route";

const mem = new Map<string, Uint8Array>();
const fake: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; } };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const STL = new TextEncoder().encode("solid cube\nendsolid cube\n");
const ORDER = "ORD-001";

beforeEach(() => { store.resetDb(); mem.clear(); setFileStore(fake); });
afterAll(() => setFileStore(undefined));

describe("order attachments", () => {
  it("stores a design file under its id, never under the uploaded name", async () => {
    const r = await addAttachment(ORDER, { kind: "design", filename: "../../etc/clicker v2.stl", bytes: STL, uploadedBy: "Aini" });
    expect(r.ok).toBe(true);
    const a = r.ok ? r.attachment : undefined!;
    expect(a.filename).toBe("clicker v2.stl");
    expect(a.storageKey).toBe(`${a.id}.stl`);
    expect(store.listAttachments(ORDER)).toHaveLength(1);
  });

  it("refuses the wrong type, an empty file, and a fake image", async () => {
    expect((await addAttachment(ORDER, { kind: "design", filename: "virus.exe", bytes: STL, uploadedBy: "x" })).ok).toBe(false);
    expect((await addAttachment(ORDER, { kind: "design", filename: "a.stl", bytes: new Uint8Array(), uploadedBy: "x" })).ok).toBe(false);
    const fakePng = await addAttachment(ORDER, { kind: "reference", filename: "ref.png", bytes: STL, uploadedBy: "x" });
    expect(!fakePng.ok && fakePng.reasons).toContain("File content is not a real image");
  });

  it("a QC photo becomes photo evidence but never counts as the QC result", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "ok");
    addEvidence(ORDER, { kind: "log", note: "printing", label: "manual" });
    const r = await addAttachment(ORDER, { kind: "qc_photo", filename: "qc.png", bytes: PNG, uploadedBy: "Khelda" });
    expect(r.ok).toBe(true);
    const ev = store.listEvidence(ORDER);
    expect(ev.at(-1)).toMatchObject({ kind: "photo", attachmentId: r.ok ? r.attachment.id : "" });
    expect(ev.some((e) => e.kind === "qc")).toBe(false);
  });

  it("downloads the bytes with a safe content type", async () => {
    const r = await addAttachment(ORDER, { kind: "reference", filename: "ref.png", bytes: PNG, uploadedBy: "Aini" });
    const id = r.ok ? r.attachment.id : "";
    const res = await download(new Request("http://x"), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });
});
