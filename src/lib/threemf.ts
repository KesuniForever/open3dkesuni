// Bambu Studio .3mf files: what a sliced file ("Export plate sliced file" -> *.gcode.3mf) will print. Read in memory
// with a small ZIP reader (central directory + node:zlib inflateRaw): no dependency, nothing written to disk, and only
// the small metadata files are ever unpacked, never the G-code. A file counts as sliced only when
// Metadata/plate_<N>.gcode exists: a project saved after slicing still has time and weight in slice_info.config but
// no G-code, and cannot be printed. Server only (node:zlib).
// Files come from customers, so every step is bounded: the XML is read with indexOf scans (no backtracking regex on
// the whole text), metadata files and the total unpacked per archive are capped, and plates are 1..64.
import { inflateRawSync } from "node:zlib";
import type { ThreeMfFilament, ThreeMfInfo, ThreeMfPlate } from "./types";

export const MAX_3MF_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 2000;
/** One metadata file unpacked (project_settings.config is about 100 KB). */
const MAX_META_BYTES = 8 * 1024 * 1024;
/** slice_info.config: a few KB per plate in real files. */
const MAX_SLICE_INFO_BYTES = 2 * 1024 * 1024;
/** Everything parse3mf unpacks from one archive together. */
const MAX_TOTAL_META_BYTES = 32 * 1024 * 1024;
/** Plate numbers Bambu Studio uses (and buildMqttPayload accepts). */
const MAX_PLATE = 64;
/** Declared sizes beyond these are a broken or hostile archive. */
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_RATIO = 1000;

export interface ZipEntry {
  name: string;
  method: number;          // 0 stored, 8 deflate
  compressedSize: number;
  size: number;
  offset: number;          // local header offset
  flags: number;
}

const SIG_EOCD = 0x06054b50, SIG_CD = 0x02014b50, SIG_LOCAL = 0x04034b50;

/** The archive's table of contents. Throws an Error (English reason) for anything it will not read. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length > MAX_3MF_BYTES) throw new Error("The file is larger than 200 MB");
  if (buf.length < 22) throw new Error("Not a ZIP archive");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive");
  const disk = buf.readUInt16LE(eocd + 4), total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0) throw new Error("Split ZIP archives are not supported");
  if (total === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  if (total > MAX_ENTRIES) throw new Error(`More than ${MAX_ENTRIES} files in the archive`);
  if (cdOffset + cdSize > eocd) throw new Error("Broken ZIP archive");
  const out: ZipEntry[] = [];
  const names = new Set<string>();
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== SIG_CD) throw new Error("Broken ZIP archive");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1");
    if (!name || name.includes("\0") || /(^|[\\/])\.\.([\\/]|$)/.test(name) || /^([\\/]|[A-Za-z]:)/.test(name)) {
      throw new Error("Unsafe file name in the archive");
    }
    if (size > MAX_ENTRY_BYTES || compressedSize > buf.length || offset >= buf.length) throw new Error("Oversized entry in the archive");
    // Two entries with one name: we and the printer's own unzip could read different ones.
    if (names.has(name)) throw new Error("The archive holds two files with the same name");
    names.add(name);
    if (compressedSize > 0 && size / compressedSize > MAX_RATIO && size > 1024 * 1024) throw new Error("Suspicious compression ratio (zip bomb)");
    out.push({ name, method, compressedSize, size, offset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Unpack one entry (metadata only). Throws when it is encrypted, too large or broken. */
export function readEntry(bytes: Uint8Array, e: ZipEntry, maxBytes = MAX_META_BYTES): Buffer {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (e.flags & 0x1) throw new Error("Encrypted entries are not supported");
  if (e.size > maxBytes) throw new Error(`${e.name} is too large to read`);
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== SIG_LOCAL) throw new Error("Broken ZIP archive");
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  if (start + e.compressedSize > buf.length) throw new Error("Broken ZIP archive");
  const data = buf.subarray(start, start + e.compressedSize);
  let out: Buffer;
  if (e.method === 0) out = Buffer.from(data);
  else if (e.method === 8) out = inflateRawSync(data, { maxOutputLength: Math.max(1, e.size) });
  else throw new Error(`Unsupported compression in ${e.name}`);
  if (out.length !== e.size) throw new Error(`Broken entry ${e.name}`);
  return out;
}

// ---------- slice_info.config (XML, written by Bambu Studio) ----------

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, k: string) =>
  k[0] === "#" ? String.fromCodePoint(k[1].toLowerCase() === "x" ? Number.parseInt(k.slice(2), 16) : Number(k.slice(1))) : ENTITY[k.toLowerCase()] ?? m);

const NAME_CHAR = /[\w:.-]/;
const SPACE = /\s/;

/** key="value" pairs of one tag, read left to right in one pass (anything else is skipped). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < tag.length) {
    if (!NAME_CHAR.test(tag[i])) { i++; continue; }
    const start = i;
    while (i < tag.length && NAME_CHAR.test(tag[i])) i++;
    const name = tag.slice(start, i);
    while (i < tag.length && SPACE.test(tag[i])) i++;
    if (tag[i] !== "=") continue;
    i++;
    while (i < tag.length && SPACE.test(tag[i])) i++;
    if (tag[i] !== "\"") continue;
    const end = tag.indexOf("\"", i + 1);
    if (end < 0) break;
    out[name] = decode(tag.slice(i + 1, end));
    i = end + 1;
  }
  return out;
}

/** The attribute text of every <name ...> or <name .../> tag in xml (indexOf scans: linear, whatever the input). */
function tags(xml: string, name: string): string[] {
  const out: string[] = [];
  const open = `<${name}`;
  for (let at = xml.indexOf(open); at >= 0;) {
    const after = xml[at + open.length];
    if (after === undefined || !(SPACE.test(after) || after === "/" || after === ">")) {
      at = xml.indexOf(open, at + open.length);
      continue;
    }
    const close = xml.indexOf(">", at);
    if (close < 0) break;
    out.push(xml.slice(at + open.length, xml[close - 1] === "/" ? close - 1 : close));
    // Go on after this tag's ">": never scan the same text twice.
    at = xml.indexOf(open, close + 1);
  }
  return out;
}

/** The text between <name> and </name>, for each block (unclosed blocks are dropped). */
function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const open = `<${name}>`;
  const close = `</${name}>`;
  for (let at = xml.indexOf(open); at >= 0;) {
    const end = xml.indexOf(close, at + open.length);
    if (end < 0) break;
    out.push(xml.slice(at + open.length, end));
    at = xml.indexOf(open, end + close.length);
  }
  return out;
}

const numOrNull = (v: string | undefined): number | null => {
  const n = v === undefined || v.trim() === "" ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
const hex = (v: unknown): string => {
  const m = typeof v === "string" ? /^#?([0-9a-fA-F]{6})/.exec(v.trim()) : null;
  return m ? `#${m[1].toUpperCase()}` : "#000000";
};

interface SlicePlate { meta: Record<string, string>; filaments: ThreeMfFilament[]; objects: number }

function parseSliceInfo(xml: string): { plates: SlicePlate[]; version?: string } {
  const version = tags(xml, "header_item").map(attrs).find((a) => a.key === "X-BBL-Client-Version")?.value;
  const plates: SlicePlate[] = [];
  for (const body of blocks(xml, "plate")) {
    if (plates.length >= MAX_PLATE) break;
    const meta: Record<string, string> = {};
    for (const t of tags(body, "metadata")) {
      const a = attrs(t);
      if (a.key) meta[a.key] = a.value ?? "";
    }
    const filaments: ThreeMfFilament[] = [];
    for (const t of tags(body, "filament")) {
      const a = attrs(t);
      const id = Number(a.id);
      if (!Number.isInteger(id) || id < 1 || id > 64 || filaments.length >= 64) continue;
      filaments.push({ id, type: (a.type ?? "").trim() || "PLA", color: hex(a.color), usedG: numOrNull(a.used_g), usedM: numOrNull(a.used_m), infoIdx: a.tray_info_idx || null });
    }
    plates.push({ meta, filaments, objects: tags(body, "object").length });
  }
  return { plates, version };
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : undefined) : typeof v === "string" ? v : undefined);
const nozzleText = (v: string | undefined) => (v === undefined || !Number.isFinite(Number(v)) ? undefined : String(Number(v)));

/**
 * What a .3mf holds: plates that can be printed (with G-code), their time and weight, the filaments each uses, the
 * printer model and nozzle. Never throws: a file it cannot read comes back with sliced: false and error set.
 */
export function parse3mf(bytes: Uint8Array): ThreeMfInfo {
  try {
    const entries = zipEntries(bytes);
    const byName = new Map(entries.map((e) => [e.name, e]));
    let unpacked = 0;
    const text = (name: string, max = MAX_META_BYTES) => {
      const e = byName.get(name);
      if (!e) return undefined;
      if (unpacked + e.size > MAX_TOTAL_META_BYTES) throw new Error("The file's metadata is too large");
      unpacked += e.size;
      return readEntry(bytes, e, max).toString("utf8");
    };
    const json = (name: string): Record<string, unknown> | undefined => {
      try { const t = text(name); return t ? (JSON.parse(t) as Record<string, unknown>) : undefined; } catch { return undefined; }
    };
    const project = json("Metadata/project_settings.config") ?? {};
    const colours = Array.isArray(project.filament_colour) ? project.filament_colour.slice(0, 64) : [];
    const types = Array.isArray(project.filament_type) ? project.filament_type.slice(0, 64) : [];
    const projectFilaments = colours.map((c, i) => ({ type: typeof types[i] === "string" ? (types[i] as string) : "PLA", color: hex(c) }));
    const gcodePlates = new Set(entries.map((e) => /^Metadata\/plate_(\d{1,2})\.gcode$/.exec(e.name)?.[1]).filter(Boolean).map(Number)
      .filter((n) => n >= 1 && n <= MAX_PLATE));
    const slice = parseSliceInfo(text("Metadata/slice_info.config", MAX_SLICE_INFO_BYTES) ?? "");
    const projectNozzle = nozzleText(first(project.nozzle_diameter));

    const plates: ThreeMfPlate[] = [];
    const seen = new Set<number>();
    for (const sp of slice.plates) {
      const index = Number(sp.meta.index);
      if (!Number.isInteger(index) || !gcodePlates.has(index) || seen.has(index)) continue;
      seen.add(index);
      const plateJson = json(`Metadata/plate_${index}.json`);
      plates.push({
        index, predictionSec: numOrNull(sp.meta.prediction), weightG: numOrNull(sp.meta.weight), filaments: sp.filaments,
        bedType: typeof plateJson?.bed_type === "string" ? plateJson.bed_type : null,
        nozzle: nozzleText(sp.meta.nozzle_diameters?.split(/[ ,]/)[0]) ?? projectNozzle ?? null, objects: sp.objects,
      });
    }
    // G-code without a summary (very old files): the plate still prints; its filaments come from plate_N.json.
    for (const index of [...gcodePlates].sort((a, b) => a - b)) {
      if (seen.has(index)) continue;
      const plateJson = json(`Metadata/plate_${index}.json`);
      const ids = Array.isArray(plateJson?.filament_ids) ? plateJson.filament_ids.filter((i): i is number => Number.isInteger(i)) : [];
      plates.push({
        index, predictionSec: null, weightG: null, bedType: typeof plateJson?.bed_type === "string" ? plateJson.bed_type : null,
        filaments: ids.filter((i) => i >= 0 && i < 64).map((i) => ({ id: i + 1, type: projectFilaments[i]?.type ?? "PLA", color: projectFilaments[i]?.color ?? "#000000", usedG: null })),
        nozzle: projectNozzle ?? null,
      });
    }
    plates.sort((a, b) => a.index - b.index);
    const modelId = slice.plates.map((p) => p.meta.printer_model_id).find(Boolean);
    return {
      sliced: plates.length > 0, plates,
      printerModel: typeof project.printer_model === "string" ? project.printer_model : undefined,
      printerModelId: modelId || undefined,
      nozzle: plates[0]?.nozzle ?? projectNozzle,
      projectFilaments: projectFilaments.length ? projectFilaments : undefined,
      slicerVersion: slice.version,
    };
  } catch (e) {
    return { sliced: false, plates: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** The plate's MD5 that Bambu Studio stores next to the G-code (uppercase hex), if any. */
export function plateMd5(bytes: Uint8Array, plate: number): string | null {
  try {
    const e = zipEntries(bytes).find((x) => x.name === `Metadata/plate_${plate}.gcode.md5`);
    const v = e ? readEntry(bytes, e, 64).toString("utf8").trim() : "";
    return /^[0-9A-Fa-f]{32}$/.test(v) ? v.toUpperCase() : null;
  } catch {
    return null;
  }
}
