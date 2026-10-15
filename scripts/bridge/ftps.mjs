// Upload one sliced 3MF to the printer's microSD card: FTPS with implicit TLS on port 990, user bblp (protocol spec §5).
// basic-ftp reuses the control channel's TLS session for the data channel, which the printer requires.
// Printer quirks (seen read-only on our A1s): PWD answers without quotes, so pwd(), cd(), ensureDir() and
// uploadFromDir() are never used; files go to the SD root by absolute path, like Bambu Studio's LAN prints.
// Only STOR (write) and SIZE are sent here: nothing is listed, deleted or renamed, and SD-card browsing is not offered.
import { Readable } from "node:stream";
import { Client } from "basic-ftp";
import { SD_FILE_NAME } from "../../src/lib/printer/control.ts";

/**
 * Write `bytes` to /<name> on the SD card and check the size the printer reports. Throws on any failure.
 * About 170 KB/s over Wi-Fi, so the time limit grows with the file. `FtpClient` is only replaced in tests.
 */
export async function uploadToSd({ ip, code, name, bytes, onProgress, FtpClient = Client, timeoutMs }) {
  if (!SD_FILE_NAME.test(name)) throw new Error("the file name is not a safe SD-card name");
  const path = `/${name}`;
  const limit = timeoutMs ?? Math.max(120_000, Math.round((bytes.length / 50_000) * 1000) + 60_000);
  const client = new FtpClient(30_000);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; client.close(); }, limit);
  try {
    // Bambu printers use a self-signed certificate on the LAN, so it cannot be verified.
    await client.access({ host: ip, port: 990, user: "bblp", password: code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
    if (onProgress) client.trackProgress((info) => onProgress(info.bytes));
    await client.uploadFrom(Readable.from([Buffer.from(bytes)]), path);
    if (onProgress) client.trackProgress();
    const size = await client.size(path);
    if (size !== bytes.length) throw new Error(`the printer has ${size} bytes of ${bytes.length}`);
    return { path, size };
  } catch (e) {
    if (timedOut) throw new Error(`the upload took longer than ${Math.round(limit / 1000)} s`);
    throw e;
  } finally {
    clearTimeout(timer);
    client.close();
  }
}
