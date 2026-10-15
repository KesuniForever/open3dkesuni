import { describe, expect, it } from "vitest";
import { readJson } from "./http";

const post = (type: string | null, body = '{"action":"release"}') =>
  new Request("http://x", { method: "POST", body, headers: type ? { "content-type": type } : {} });

describe("readJson", () => {
  it("reads a JSON body sent as application/json", async () => {
    expect(await readJson(post("application/json"))).toEqual({ action: "release" });
    expect(await readJson(post("Application/JSON; charset=utf-8"))).toEqual({ action: "release" });
  });

  it("ignores the same text sent the way a cross-site HTML form can send it", async () => {
    expect(await readJson(post("text/plain"))).toBeNull();
    expect(await readJson(post("application/x-www-form-urlencoded"))).toBeNull();
    expect(await readJson(new Request("http://x", { method: "POST", body: '{"action":"release"}' }))).toBeNull();
  });
});
