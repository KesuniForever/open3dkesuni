import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { authPacket, frameReader, grabFrame } from "./camera.mjs";

const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 6, 7), Buffer.from([0xff, 0xd9])]);
const header = (size) => {
  const h = Buffer.alloc(16);
  h.writeUInt32LE(size, 0);
  h.writeUInt32LE(1, 8);
  return h;
};

/** A camera on port 6000 that sends `chunks` after the login, then whatever `after` does. */
function fakeCamera(chunks, after) {
  const calls = { options: null, written: [], destroyed: false };
  const connect = (options, onConnect) => {
    calls.options = options;
    const s = new EventEmitter();
    s.write = (b) => {
      calls.written.push(Buffer.from(b));
      setImmediate(() => { for (const c of chunks) s.emit("data", c); after?.(s); });
    };
    s.destroy = () => { calls.destroyed = true; };
    setImmediate(onConnect);
    return s;
  };
  return { connect, calls };
}

describe("camera login packet", () => {
  it("is 80 bytes: size 0x40, type 0x3000, then bblp and the access code, NUL padded", () => {
    const b = authPacket("12345678");
    expect(b.length).toBe(80);
    expect(b.readUInt32LE(0)).toBe(0x40);
    expect(b.readUInt32LE(4)).toBe(0x3000);
    expect(b.readUInt32LE(8)).toBe(0);
    expect(b.subarray(16, 20).toString("ascii")).toBe("bblp");
    expect(b[20]).toBe(0);
    expect(b.subarray(48, 56).toString("ascii")).toBe("12345678");
    expect(b[56]).toBe(0);
  });
});

describe("frameReader", () => {
  it("joins a frame split over many chunks, header included", () => {
    const img = jpeg(37_152);
    const all = Buffer.concat([header(img.length), img, header(10)]);
    const r = frameReader();
    let out = null;
    for (let i = 0; i < all.length && !out; i += 1000) out = r.push(all.subarray(i, i + 1000));
    expect(out.jpeg.equals(img)).toBe(true);
  });
  it("refuses a frame that is not a JPEG or makes no sense", () => {
    expect(frameReader().push(Buffer.concat([header(8), Buffer.alloc(8)]))).toEqual({ error: "the frame is not a JPEG" });
    expect(frameReader().push(header(50 * 1024 * 1024))).toEqual({ error: "bad frame size 52428800" });
  });
});

describe("grabFrame", () => {
  it("logs in over TLS on port 6000, reads ONE frame and closes", async () => {
    const img = jpeg(4_000);
    const cam = fakeCamera([header(img.length), img.subarray(0, 100), img.subarray(100)]);
    const got = await grabFrame("192.0.2.10", "12345678", { connect: cam.connect });
    expect(got.equals(img)).toBe(true);
    expect(cam.calls.options).toEqual({ host: "192.0.2.10", port: 6000, rejectUnauthorized: false });
    expect(cam.calls.written).toHaveLength(1);
    expect(cam.calls.written[0].length).toBe(80);
    expect(cam.calls.destroyed).toBe(true);
  });
  it("a closed connection (wrong access code) and a silent camera are errors", async () => {
    const closed = fakeCamera([], (s) => s.emit("end"));
    await expect(grabFrame("192.0.2.10", "bad", { connect: closed.connect })).rejects.toThrow(/wrong access code/);
    const silent = fakeCamera([]);
    await expect(grabFrame("192.0.2.10", "12345678", { connect: silent.connect, timeoutMs: 30 })).rejects.toThrow(/no camera frame/);
    expect(silent.calls.destroyed).toBe(true);
  });
});
