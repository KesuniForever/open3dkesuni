// Rewrites one entry of a ZIP (a .gcode.3mf) and copies every other entry's compressed bytes unchanged. Used to fill
// printer_model_id="N2S" (the A1) in Metadata/slice_info.config: Bambu Studio's command line (02.08, Windows) leaves it
// empty because the desktop install has no resources/profiles/BBL/machine_full/ folder. The G-code and its MD5 are
// untouched. No dependencies (node:zlib crc32 needs Node >= 22.2). Refuses ZIP64 and anything odd.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const SIG_EOCD = 0x06054b50, SIG_CD = 0x02014b50, SIG_LOCAL = 0x04034b50;

/** @param {Buffer} buf @param {string} name @param {(old: Buffer) => Buffer|string} transform */
export function replaceZipEntry(buf, name, transform) {
  let eocd = -1;
  for (let i = buf.length - 22, min = Math.max(0, buf.length - 65557); i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a ZIP file");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff || count > 2000) throw new Error("ZIP64 or too many entries");
  const locals = [], centrals = [];
  let p = cdOff, out = 0, hit = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CD) throw new Error("bad central directory");
    let flags = buf.readUInt16LE(p + 8);
    let method = buf.readUInt16LE(p + 10);
    let crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    if (csize === 0xffffffff || size === 0xffffffff || lho === 0xffffffff) throw new Error("ZIP64 entry");
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== SIG_LOCAL) throw new Error("bad local header");
    const nameBuf = buf.subarray(p + 46, p + 46 + nlen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw new Error("bad entry size");
    let data = buf.subarray(start, start + csize);
    if (nameBuf.toString("utf8") === name) {
      if (method !== 0 && method !== 8) throw new Error(`unsupported method ${method}`);
      const old = method === 8 ? inflateRawSync(data) : Buffer.from(data);
      const next = Buffer.from(transform(old));
      data = deflateRawSync(next);
      method = 8; crc = crc32(next) >>> 0; csize = data.length; size = next.length; hit++;
    }
    flags &= ~0x0008; // sizes live in the local header now: no data descriptor
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOCAL, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(buf.readUInt16LE(p + 12), 10); lh.writeUInt16LE(buf.readUInt16LE(p + 14), 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(csize, 18); lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nlen, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);
    const cd = Buffer.from(buf.subarray(p, p + 46 + nlen + xlen + clen));
    cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(csize, 20); cd.writeUInt32LE(size, 24); cd.writeUInt32LE(out, 42);
    centrals.push(cd);
    out += 30 + nlen + data.length;
    p += 46 + nlen + xlen + clen;
  }
  if (hit !== 1) throw new Error(`${name}: found ${hit} times`);
  const cdBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_EOCD, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(out, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, end]);
}

/** Sets printer_model_id on every plate of slice_info.config where it is empty. */
export function fillPrinterModelId(buf, modelId = "N2S") {
  return replaceZipEntry(buf, "Metadata/slice_info.config", (old) =>
    old.toString("utf8").replaceAll('<metadata key="printer_model_id" value=""/>', `<metadata key="printer_model_id" value="${modelId}"/>`));
}
