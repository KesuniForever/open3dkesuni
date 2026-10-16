import { describe, expect, it } from "vitest";
import { mediaType, readCapped, readJsonCapped } from "./request-body";

// Bodies of the customer routes, which the proxy no longer buffers: never more than the limit is read.
const post = (body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request("http://x/api/c", { method: "POST", body, headers, duplex: "half" } as RequestInit);
/** A body sent in chunks with no size: counts how many chunks were pulled. */
function chunked(chunks: number, size: number) {
  const seen = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (seen.pulled === chunks) return c.close();
      seen.pulled++;
      c.enqueue(new Uint8Array(size).fill(7));
    },
  });
  return { stream, seen };
}

describe("reading a body with a limit", () => {
  it("refuses by the size it gives, without reading a byte", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() { throw new Error("the body was read"); } });
    expect(await readCapped(post(body, { "content-length": "1001" }), 1000)).toBe("too-large");
  });

  it("counts a body without a size as it arrives, and stops reading once it passes the limit", async () => {
    const { stream, seen } = chunked(100, 400);
    expect(await readCapped(post(stream), 1000)).toBe("too-large");
    expect(seen.pulled).toBeLessThan(10);
    const ok = chunked(3, 300);
    expect(await readCapped(post(ok.stream), 1000)).toEqual(new Uint8Array(900).fill(7));
    expect(await readCapped(post("x".repeat(1000)), 1000)).toHaveLength(1000); // exactly the limit is fine
    expect(await readCapped(new Request("http://x"), 10)).toEqual(new Uint8Array());
  });

  it("JSON: an object of application/json only; anything else is null, too long is said so", async () => {
    const json = (body: string, type = "application/json; charset=utf-8") => post(body, { "content-type": type });
    expect(await readJsonCapped(json('{"invite":"x"}'), 100)).toEqual({ invite: "x" });
    expect(await readJsonCapped(json('{"invite":"x"}', "text/plain"), 100)).toBeNull(); // a form on another site
    expect(await readJsonCapped(json("[1,2]"), 100)).toBeNull();
    expect(await readJsonCapped(json("not json"), 100)).toBeNull();
    expect(await readJsonCapped(json(`{"note":"${"x".repeat(200)}"}`), 100)).toBe("too-large");
    expect(mediaType(json("{}", "Multipart/Form-Data; boundary=x"))).toBe("multipart/form-data");
  });
});
