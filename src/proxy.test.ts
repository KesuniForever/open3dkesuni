import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { host: "localhost:3000", ...headers } });
const post = (path: string, headers: Record<string, string> = {}) => req(path, headers, "POST");
const tunnel = { host: "kesuni.trycloudflare.com", "cf-connecting-ip": "1.2.3.4" };
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";
// Browsers send Basic credentials as UTF-8.
const basic = (pw: string) => `Basic ${Buffer.from(`operator:${pw}`, "utf8").toString("base64")}`;

afterEach(() => { delete process.env.OPERATOR_PASSWORD; delete process.env.RAILWAY_PROJECT_ID; });

describe("proxy", () => {
  it("leaves local requests alone", () => {
    expect(passes(proxy(req("/api/reset")))).toBe(true);
    expect(passes(proxy(req("/orders/ORD-001", { host: "192.168.100.99:3000" })))).toBe(true);
  });

  it("keeps customer and bridge paths open on the public link", () => {
    for (const p of ["/c/abcdefabcdefabcdefabcdef", "/api/c/abcdefabcdefabcdefabcdef", "/api/c", "/request/code", "/api/printers/report"]) {
      expect(passes(proxy(req(p, tunnel)))).toBe(true);
    }
    expect(passes(proxy(post("/api/printers/report", tunnel)))).toBe(true);
  });

  it("closes operator pages on the public link when no password is set", () => {
    expect(proxy(req("/", tunnel)).status).toBe(403);
    expect(proxy(req("/api/orders/ORD-001/escrow", tunnel)).status).toBe(403);
    expect(proxy(req("/api/files/F-1234", tunnel)).status).toBe(403);
  });

  it("asks for the operator password on the public link", () => {
    process.env.OPERATOR_PASSWORD = "correct horse";
    expect(proxy(req("/api/reset", tunnel)).status).toBe(401);
    expect(proxy(req("/api/reset", { ...tunnel, authorization: basic("wrong") })).status).toBe(401);
    expect(proxy(req("/api/reset", { ...tunnel, authorization: basic("correct horse ") })).status).toBe(401);
    expect(proxy(req("/api/reset", { ...tunnel, authorization: `Basic ${btoa("correct horse")}` })).status).toBe(401);
    expect(passes(proxy(req("/api/reset", { ...tunnel, authorization: basic("correct horse") })))).toBe(true);
  });

  it("accepts a non-ASCII password the way browsers send it (UTF-8)", () => {
    process.env.OPERATOR_PASSWORD = "pässwort-月";
    expect(passes(proxy(req("/orders", { ...tunnel, authorization: basic("pässwort-月") })))).toBe(true);
    expect(proxy(req("/orders", { ...tunnel, authorization: basic("passwort-月") })).status).toBe(401);
  });

  it("on Railway a request claiming a local host still needs the password", () => {
    process.env.RAILWAY_PROJECT_ID = "p-1";
    expect(proxy(req("/api/reset")).status).toBe(403);
    process.env.OPERATOR_PASSWORD = "correct horse";
    expect(proxy(req("/orders/ORD-001", { host: "192.168.100.99:3000" })).status).toBe(401);
    expect(passes(proxy(req("/c/abcdefabcdefabcdefabcdef")))).toBe(true);
  });

  it("a tunnel request claiming a local host is still treated as remote", () => {
    expect(proxy(req("/api/reset", { "cf-connecting-ip": "1.2.3.4" })).status).toBe(403);
  });
});

describe("proxy: writes from other sites", () => {
  it("blocks a cross-site form post even with the saved operator password", () => {
    process.env.OPERATOR_PASSWORD = "correct horse";
    const login = { ...tunnel, authorization: basic("correct horse") };
    const r = proxy(post("/api/orders/ORD-001/escrow", { ...login, "sec-fetch-site": "cross-site", origin: "https://evil.example" }));
    expect(r.status).toBe(403);
    expect(proxy(post("/api/heartbeat", { ...login, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect(passes(proxy(post("/api/orders/ORD-001/escrow", { ...login, "sec-fetch-site": "same-origin", origin: "https://kesuni.trycloudflare.com" })))).toBe(true);
  });

  it("blocks cross-site writes on this computer and the home network too", () => {
    expect(proxy(post("/api/reset", { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    // Plain http on the home network: no Sec-Fetch-Site, so the Origin host decides.
    const lan = { host: "192.168.100.99:3000" };
    expect(proxy(post("/api/reset", { ...lan, origin: "http://evil.example" })).status).toBe(403);
    expect(proxy(post("/api/reset", { ...lan, origin: "null" })).status).toBe(403);
    expect(passes(proxy(post("/api/reset", { ...lan, origin: "http://192.168.100.99:3000" })))).toBe(true);
    expect(passes(proxy(post("/api/reset", { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" })))).toBe(true);
  });

  it("matches the Origin against the forwarded host behind a proxy", () => {
    const h = { host: "10.0.0.5:3000", "x-forwarded-host": "kesuni.example.com" };
    expect(passes(proxy(post("/api/orders", { ...h, origin: "https://kesuni.example.com" })))).toBe(true);
    expect(proxy(post("/api/orders", { ...h, origin: "https://other.example.com" })).status).toBe(403);
  });

  it("lets reads and scripts without an Origin through (they still need the password on the public link)", () => {
    expect(passes(proxy(req("/orders/ORD-001", { "sec-fetch-site": "cross-site" })))).toBe(true);
    expect(passes(proxy(post("/api/orders")))).toBe(true);
    expect(proxy(post("/api/admin/import-db", tunnel)).status).toBe(403);
  });
});

describe("proxy: printing from the website", () => {
  it("opens only the bridge's own routes (they check the bearer token) and the customers' colour list", () => {
    expect(passes(proxy(req("/api/studio/colors", tunnel)))).toBe(true);
    expect(passes(proxy(req("/api/printers/queue", tunnel)))).toBe(true);
    expect(passes(proxy(post("/api/printers/queue/PC-1-abc", tunnel)))).toBe(true);
    expect(passes(proxy(req("/api/print-jobs/PJ-1-abc/file", tunnel)))).toBe(true);
    expect(passes(proxy(post("/api/printers/a1/camera", tunnel)))).toBe(true);
  });

  it("keeps controls, print jobs and the camera picture behind the operator password", () => {
    expect(proxy(req("/api/printers/a1/camera", tunnel)).status).toBe(403);
    expect(proxy(post("/api/printers/a1/command", tunnel)).status).toBe(403);
    expect(proxy(post("/api/print-jobs", tunnel)).status).toBe(403);
    expect(proxy(req("/api/print-jobs", tunnel)).status).toBe(403);
    expect(proxy(post("/api/print-jobs/PJ-1-abc", tunnel)).status).toBe(403);
    expect(proxy(req("/api/printers/queue/extra/path", tunnel)).status).toBe(403);
  });

  it("printer controls, print starts and the camera: only this computer skips the password, not the studio Wi-Fi", () => {
    const lan = { host: "192.168.100.99:3000" };
    for (const r of [post("/api/printers/a1/command"), post("/api/print-jobs"), post("/api/print-jobs/PJ-1-abc"), req("/api/printers/a1/camera")]) {
      expect(passes(proxy(r)), r.url).toBe(true);
    }
    // Reading pages and lists from the studio Wi-Fi stays open; controlling the printers does not.
    expect(passes(proxy(req("/machines", lan)))).toBe(true);
    expect(passes(proxy(req("/api/print-jobs", lan)))).toBe(true);
    expect(proxy(post("/api/printers/a1/command", lan)).status).toBe(403);
    process.env.OPERATOR_PASSWORD = "correct horse";
    expect(proxy(post("/api/printers/a1/command", lan)).status).toBe(401);
    expect(proxy(post("/api/print-jobs", lan)).status).toBe(401);
    expect(proxy(req("/api/printers/a1/camera", lan)).status).toBe(401);
    expect(passes(proxy(post("/api/printers/a1/command", { ...lan, authorization: basic("correct horse") })))).toBe(true);
    // The bridge still posts camera frames with its own token.
    expect(passes(proxy(post("/api/printers/a1/camera", lan)))).toBe(true);
  });
});
