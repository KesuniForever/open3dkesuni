import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createSliceRunner, sliceUrl } from "./slice-runner.mjs";

// The studio PC's slice loop against a fake app: no Bambu Studio, no network. The slicer itself is tested in
// slicer.test.mjs (and ran for real on the studio PC).
const md5 = (b) => createHash("md5").update(b).digest("hex");
const MODEL = Buffer.from("solid cube\nendsolid cube\n");
const SLICED = Buffer.from("PK fake sliced file");
const item = (extra = {}) => ({
  type: "slice", id: "SJ-1-test", orderId: "ORD-012", mode: "mesh", sourceName: "Kubus Uji (v2).STL", size: MODEL.length, material: "PLA",
  color: "#FFFFFF", quality: "standard", infillPct: 20, supports: "auto", createdAt: "2026-10-16T01:00:00.000Z", expiresAt: "2026-10-16T01:15:00.000Z",
  sourceUrl: "/api/slicer/jobs/SJ-1-test/source", resultUrl: "/api/slicer/jobs/SJ-1-test/result", ...extra,
});

/** An app with a slice queue that lets each slice be taken once. results: uploads it received. */
function fakeApp({ base = "http://app.test", slices = [item()], model = MODEL, modelMd5, resultStatus = 201 } = {}) {
  const state = new Map(slices.map((s) => [s.id, "queued"]));
  const app = {
    base, calls: [], reports: [], results: [], state,
    async fetch(url, init = {}) {
      app.calls.push({ url, method: init.method ?? "GET", auth: init.headers?.authorization });
      if (!url.startsWith(base)) throw new Error(`unexpected host: ${url}`);
      if (init.headers?.authorization !== "Bearer tok") return new Response("no", { status: 401 });
      const path = url.slice(base.length);
      if (path === "/api/slicer/queue") return Response.json({ slices: slices.filter((s) => state.get(s.id) === "queued"), now: "x" });
      let m = /^\/api\/slicer\/queue\/([^/]+)$/.exec(path);
      if (m && init.method === "POST") {
        const id = decodeURIComponent(m[1]);
        const body = JSON.parse(init.body);
        app.reports.push({ id, body });
        const next = { queued: ["slicing", "failed"], slicing: ["failed"] }[state.get(id)] ?? [];
        if (!next.includes(body.state)) return Response.json({ error: "conflict" }, { status: 409 });
        state.set(id, body.state);
        return Response.json({ job: {} });
      }
      m = /^\/api\/slicer\/jobs\/([^/]+)\/source$/.exec(path);
      if (m) return new Response(model, { headers: { "content-length": String(model.length), "x-file-md5": modelMd5 ?? md5(model) } });
      m = /^\/api\/slicer\/jobs\/([^/]+)\/result$/.exec(path);
      if (m && init.method === "POST") {
        app.results.push({ id: m[1], bytes: Buffer.from(init.body), headers: init.headers });
        if (resultStatus === 201) state.set(m[1], "done");
        return Response.json({ error: "refused" }, { status: resultStatus });
      }
      return new Response("not found", { status: 404 });
    },
  };
  return app;
}

function setup({ app = fakeApp(), slice } = {}) {
  const logs = [];
  const asked = [];
  const runner = createSliceRunner({
    apps: [app.base], token: "tok", fetch: (u, i) => app.fetch(u, i), clock: { now: () => 0, sleep: async () => {} },
    log: (t) => logs.push(t), warn: (t) => logs.push(t),
    slice: async (req) => { asked.push(req); return slice ? slice(req) : { ok: true, bytes: SLICED, fileName: "Kubus_Uji_v2.gcode.3mf", ms: 650, info: { plates: [{ weightG: 4, predictionSec: 1200 }] } }; },
  });
  return { app, logs, asked, runner };
}

describe("the studio PC slices what the app asks", () => {
  it("takes the slice once, downloads and checks the model, slices it and uploads the file with its checksum", async () => {
    const s = setup();
    await s.runner.pollOnce();
    expect(s.app.reports).toEqual([{ id: "SJ-1-test", body: { state: "slicing" } }]);
    expect(s.asked).toEqual([{ bytes: MODEL, fileName: "Kubus Uji (v2).STL", mode: "mesh", material: "PLA", color: "#FFFFFF", quality: "standard", infillPct: 20, supports: "auto" }]);
    expect(s.app.results).toHaveLength(1);
    expect(s.app.results[0].bytes).toEqual(SLICED);
    expect(s.app.results[0].headers).toMatchObject({ "content-type": "model/3mf", "x-file-md5": md5(SLICED), "x-slice-ms": "650", authorization: "Bearer tok" });
    expect(s.logs.at(-1)).toBe("ok slice SJ-1-test: Kubus_Uji_v2.gcode.3mf 4 g, 20 min print, sliced in 0.7 s");
    // Nothing queued any more: the next poll does nothing.
    await s.runner.pollOnce();
    expect(s.asked).toHaveLength(1);
    expect(s.app.calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });

  it("reports the slicer's reason when slicing fails, and never uploads", async () => {
    const s = setup({ slice: () => ({ ok: false, message: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty" }) });
    await s.runner.pollOnce();
    expect(s.app.reports.at(-1)).toEqual({ id: "SJ-1-test", body: { state: "failed", error: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty", kind: "model" } });
    expect(s.app.results).toEqual([]);
  });

  it("a model changed on the way, or a slicer crash, fails the slice with a text that holds no local path", async () => {
    const changed = setup({ app: fakeApp({ modelMd5: "0".repeat(32) }) });
    await changed.runner.pollOnce();
    expect(changed.app.reports.at(-1).body).toEqual({ state: "failed", error: "The model changed on the way (checksum mismatch)", kind: "studio" });
    expect(changed.asked).toEqual([]);
    const crash = setup({ slice: () => { throw new Error("EPERM C:\\Users\\studio\\AppData\\Local\\Temp\\kesuni-slicer\\slice-1"); } });
    await crash.runner.pollOnce();
    expect(crash.app.reports.at(-1).body).toEqual({ state: "failed", error: "The slicer hit an error on the studio PC", kind: "studio" });
  });

  it("never follows a link to another host, and leaves a slice another studio PC took", async () => {
    const other = setup({ app: fakeApp({ slices: [item({ sourceUrl: "https://evil.example/api/slicer/jobs/SJ-1-test/source" })] }) });
    await other.runner.pollOnce();
    expect(other.app.reports.at(-1).body).toEqual({ state: "failed", error: "The slice has no download link from this app", kind: "studio" });
    expect(other.asked).toEqual([]);
    expect(sliceUrl("http://a", "/api/slicer/jobs/SJ-1/result", "result")).toBe("http://a/api/slicer/jobs/SJ-1/result");
    expect(sliceUrl("http://a", "/api/print-jobs/PJ-1/file", "source")).toBeNull();

    const app = fakeApp();
    app.state.set("SJ-1-test", "slicing"); // taken meanwhile; the queue answer was older
    const late = setup({ app: { ...app, fetch: (u, i) => (u.endsWith("/api/slicer/queue") ? Promise.resolve(Response.json({ slices: [item()] })) : app.fetch(u, i)) } });
    await late.runner.pollOnce();
    expect(late.asked).toEqual([]);
    expect(app.reports).toEqual([{ id: "SJ-1-test", body: { state: "slicing" } }]);
  });

  it("an app that refuses the sliced file has recorded why itself; another answer fails the slice", async () => {
    const refused = setup({ app: fakeApp({ resultStatus: 422 }) });
    await refused.runner.pollOnce();
    expect(refused.app.reports.map((r) => r.body.state)).toEqual(["slicing"]);
    expect(refused.logs.at(-1)).toMatch(/^x slice SJ-1-test: http:\/\/app\.test refused the sliced file \(422/);
    const broken = setup({ app: fakeApp({ resultStatus: 500 }) });
    await broken.runner.pollOnce();
    expect(broken.app.reports.at(-1).body).toEqual({ state: "failed", error: "The app did not take the sliced file (it answered 500)", kind: "studio" });
  });

  it("one slice at a time", async () => {
    let release;
    let calls = 0;
    const s = setup({
      app: fakeApp({ slices: [item(), item({ id: "SJ-2-test", sourceUrl: "/api/slicer/jobs/SJ-2-test/source", resultUrl: "/api/slicer/jobs/SJ-2-test/result" })] }),
      slice: () => (calls++ === 0 ? new Promise((r) => { release = () => r({ ok: false, message: "Slicing failed" }); }) : { ok: false, message: "Slicing failed" }),
    });
    const first = s.runner.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    await s.runner.pollOnce(); // while the first slices: nothing new is taken
    expect(s.app.reports.filter((r) => r.body.state === "slicing").map((r) => r.id)).toEqual(["SJ-1-test"]);
    release();
    await first;
    await s.runner.pollOnce();
    expect(s.app.reports.filter((r) => r.body.state === "slicing").map((r) => r.id)).toEqual(["SJ-1-test", "SJ-2-test"]);
  });
});
