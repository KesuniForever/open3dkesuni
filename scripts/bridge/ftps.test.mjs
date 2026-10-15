import { describe, expect, it } from "vitest";
import { uploadToSd } from "./ftps.mjs";

/** Records what the bridge asks of the FTP client; `size` is what the printer reports after the upload. */
function fakeFtp({ size, failUpload } = {}) {
  const log = [];
  class FakeClient {
    constructor(timeout) { log.push(["new", timeout]); }
    async access(o) { log.push(["access", { ...o }]); }
    trackProgress(fn) { log.push(["progress", Boolean(fn)]); if (fn) fn({ bytes: 3 }); }
    async uploadFrom(stream, path) {
      if (failUpload) throw new Error(failUpload);
      const parts = [];
      for await (const c of stream) parts.push(Buffer.from(c));
      log.push(["upload", path, Buffer.concat(parts).length]);
    }
    async size(path) { log.push(["size", path]); return size; }
    close() { log.push(["close"]); }
    // Must never be used: the printer's PWD answer breaks them.
    async pwd() { throw new Error("pwd used"); }
    async cd() { throw new Error("cd used"); }
    async ensureDir() { throw new Error("ensureDir used"); }
  }
  return { FakeClient, log };
}

describe("uploadToSd", () => {
  const bytes = Buffer.from("PK fake sliced file");
  const name = "ORD-012_p1_1792072000.gcode.3mf";

  it("uses implicit TLS on 990 as bblp, writes to the SD root by absolute path and checks the size", async () => {
    const { FakeClient, log } = fakeFtp({ size: bytes.length });
    const seen = [];
    expect(await uploadToSd({ ip: "192.0.2.10", code: "12345678", name, bytes, onProgress: (n) => seen.push(n), FtpClient: FakeClient }))
      .toEqual({ path: `/${name}`, size: bytes.length });
    expect(log).toContainEqual(["access", { host: "192.0.2.10", port: 990, user: "bblp", password: "12345678", secure: "implicit", secureOptions: { rejectUnauthorized: false } }]);
    expect(log).toContainEqual(["upload", `/${name}`, bytes.length]);
    expect(log).toContainEqual(["size", `/${name}`]);
    expect(log.at(-1)).toEqual(["close"]);
    expect(seen).toEqual([3]);
  });

  it("fails when the printer holds a different size, and on a failed upload", async () => {
    await expect(uploadToSd({ ip: "x", code: "c", name, bytes, FtpClient: fakeFtp({ size: 4 }).FakeClient }))
      .rejects.toThrow(`the printer has 4 bytes of ${bytes.length}`);
    const broken = fakeFtp({ failUpload: "550 write failed" });
    await expect(uploadToSd({ ip: "x", code: "c", name, bytes, FtpClient: broken.FakeClient })).rejects.toThrow("550 write failed");
    expect(broken.log.at(-1)).toEqual(["close"]);
  });

  it("never connects for an unsafe name", async () => {
    const { FakeClient, log } = fakeFtp({ size: 1 });
    for (const bad of ["../x.gcode.3mf", "cache/x.gcode.3mf", "a b.gcode.3mf", "x.3mf", "model/Benchy.gcode.3mf"]) {
      await expect(uploadToSd({ ip: "x", code: "c", name: bad, bytes, FtpClient: FakeClient })).rejects.toThrow("not a safe SD-card name");
    }
    expect(log).toEqual([]);
  });
});
