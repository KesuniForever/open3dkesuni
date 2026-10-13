import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", ...headers } });
const tunnel = { host: "kesuni.trycloudflare.com", "cf-connecting-ip": "1.2.3.4" };
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

afterEach(() => { delete process.env.OPERATOR_PASSWORD; });

describe("proxy", () => {
  it("leaves local requests alone", () => {
    expect(passes(proxy(req("/api/reset")))).toBe(true);
    expect(passes(proxy(req("/orders/ORD-001", { host: "192.168.100.99:3000" })))).toBe(true);
  });

  it("keeps customer and bridge paths open on the public link", () => {
    for (const p of ["/c/abcdefabcdefabcdefabcdef", "/api/c/abcdefabcdefabcdefabcdef", "/api/c", "/pesan/code", "/api/printers/report"]) {
      expect(passes(proxy(req(p, tunnel)))).toBe(true);
    }
  });

  it("closes operator pages on the public link when no password is set", () => {
    expect(proxy(req("/", tunnel)).status).toBe(403);
    expect(proxy(req("/api/orders/ORD-001/escrow", tunnel)).status).toBe(403);
    expect(proxy(req("/api/files/F-1234", tunnel)).status).toBe(403);
  });

  it("asks for the operator password on the public link", () => {
    process.env.OPERATOR_PASSWORD = "correct horse";
    expect(proxy(req("/api/reset", tunnel)).status).toBe(401);
    const basic = (pw: string) => `Basic ${btoa(`operator:${pw}`)}`;
    expect(proxy(req("/api/reset", { ...tunnel, authorization: basic("wrong") })).status).toBe(401);
    expect(passes(proxy(req("/api/reset", { ...tunnel, authorization: basic("correct horse") })))).toBe(true);
  });

  it("a tunnel request claiming a local host is still treated as remote", () => {
    expect(proxy(req("/api/reset", { "cf-connecting-ip": "1.2.3.4" })).status).toBe(403);
  });
});
