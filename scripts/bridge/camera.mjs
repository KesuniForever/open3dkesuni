// One still frame from a Bambu A1 camera: TLS on port 6000, an 80-byte login, then JPEG frames of about 35 KB each
// (protocol spec §6, checked read-only on our printers: first frame after 2-3 s, then one every 2-2.5 s).
// Read-only: the only thing written to the printer is the login. The bridge connects, takes ONE frame and closes;
// it never keeps a stream open, so nothing is watched when nobody asked for it.
import tls from "node:tls";

/** The app keeps at most 2 MB per frame; a bigger "frame" means we are out of step with the stream. */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** The login packet: u32le 0x40, 0x3000, 0, 0, then "bblp" and the access code, each in 32 NUL-padded bytes. */
export function authPacket(code, user = "bblp") {
  const b = Buffer.alloc(80);
  b.writeUInt32LE(0x40, 0);
  b.writeUInt32LE(0x3000, 4);
  b.write(user, 16, 32, "ascii");
  b.write(String(code), 48, 32, "ascii");
  return b;
}

/**
 * Feeds TLS chunks in, gives the first whole JPEG out. Each frame is a 16-byte header (u32le payload size, then three
 * u32 we ignore) and the payload, which may arrive split over many chunks.
 * push() returns { jpeg } once a frame is complete, { error } when the stream makes no sense, else null.
 */
export function frameReader() {
  let buf = Buffer.alloc(0);
  let need = -1;
  return {
    push(chunk) {
      buf = Buffer.concat([buf, chunk]);
      if (need < 0) {
        if (buf.length < 16) return null;
        need = buf.readUInt32LE(0);
        buf = buf.subarray(16);
        if (need < 4 || need > MAX_FRAME_BYTES) return { error: `bad frame size ${need}` };
      }
      if (buf.length < need) return null;
      const jpeg = Buffer.from(buf.subarray(0, need));
      if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return { error: "the frame is not a JPEG" };
      return { jpeg };
    },
  };
}

/**
 * Connect, log in, read one JPEG, close. Rejects on timeout, a closed connection (often a wrong access code) or a bad
 * frame. `connect` is only replaced in tests.
 */
export function grabFrame(ip, code, { timeoutMs = 10_000, connect = tls.connect } = {}) {
  return new Promise((resolve, reject) => {
    const reader = frameReader();
    let settled = false;
    // Bambu printers use a self-signed certificate on the LAN, so it cannot be verified.
    const socket = connect({ host: ip, port: 6000, rejectUnauthorized: false }, () => socket.write(authPacket(code)));
    const finish = (err, jpeg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(jpeg);
    };
    const timer = setTimeout(() => finish(new Error(`no camera frame within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    socket.on("data", (chunk) => {
      const r = reader.push(chunk);
      if (r?.error) finish(new Error(r.error));
      else if (r?.jpeg) finish(null, r.jpeg);
    });
    socket.on("error", (e) => finish(e));
    socket.on("end", () => finish(new Error("the camera closed the connection (wrong access code?)")));
    socket.on("close", () => finish(new Error("the camera closed the connection")));
  });
}
