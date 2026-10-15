// Tests only: build small ZIP archives and Bambu Studio style .gcode.3mf files in memory (no real files committed).
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipFile {
  name: string;
  data: string | Uint8Array;
  /** Store without compression (Bambu stores its PNGs). */
  stored?: boolean;
  /** Overwrite header fields to build broken or hostile archives. */
  flags?: number;
  declaredSize?: number;
}

export function makeZip(files: ZipFile[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : Buffer.from(f.data);
    const body = f.stored ? raw : deflateRawSync(raw);
    const name = Buffer.from(f.name, "utf8");
    const size = f.declaredSize ?? raw.length;
    const flags = (f.flags ?? 0) | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(f.stored ? 0 : 8, 8); local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(f.stored ? 0 : 8, 10); central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

export interface FakePlate {
  index: number;
  prediction?: number;
  weight?: number;
  filaments: { id: number; type: string; color: string; usedG: number }[];
  /** false: the summary is there but no G-code (a project saved after slicing). */
  gcode?: boolean;
}

/** A Bambu Studio "Export plate sliced file" archive, small enough for a test. */
export function fake3mf(opts: {
  plates: FakePlate[]; projectColours?: string[]; projectTypes?: string[]; modelId?: string | null; printerModel?: string; nozzle?: string;
}): Uint8Array {
  const colours = opts.projectColours ?? ["#FFFFFF"];
  const types = opts.projectTypes ?? colours.map(() => "PLA");
  const plates = opts.plates.map((p) => `  <plate>
    <metadata key="index" value="${p.index}"/>
${opts.modelId === null ? "" : `    <metadata key="printer_model_id" value="${opts.modelId ?? "N2S"}"/>\n`}    <metadata key="nozzle_diameters" value="${opts.nozzle ?? "0.4"}"/>
    <metadata key="prediction" value="${p.prediction ?? 1644}"/>
    <metadata key="weight" value="${p.weight ?? 9.82}"/>
    <object identify_id="415" name="part &amp; lid.stl" skipped="false" />
${p.filaments.map((f) => `    <filament id="${f.id}" tray_info_idx="GFA00" type="${f.type}" color="${f.color}" used_m="1.00" used_g="${f.usedG}" />`).join("\n")}
  </plate>`).join("\n");
  const slice = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header><header_item key="X-BBL-Client-Type" value="slicer"/><header_item key="X-BBL-Client-Version" value="02.08.02.61"/></header>
${plates}
</config>`;
  const project = JSON.stringify({
    printer_model: opts.printerModel ?? "Bambu Lab A1", nozzle_diameter: [opts.nozzle ?? "0.4"], filament_colour: colours, filament_type: types,
  });
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "Metadata/plate_1.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), stored: true },
    { name: "Metadata/project_settings.config", data: project },
    { name: "Metadata/slice_info.config", data: slice },
  ];
  for (const p of opts.plates) {
    files.push({ name: `Metadata/plate_${p.index}.json`, data: JSON.stringify({ bed_type: "textured_plate", filament_ids: p.filaments.map((f) => f.id - 1) }) });
    if (p.gcode !== false) {
      files.push({ name: `Metadata/plate_${p.index}.gcode`, data: "; HEADER_BLOCK_START\n; total estimated time: 27m 24s\nG28\n".repeat(50) });
      files.push({ name: `Metadata/plate_${p.index}.gcode.md5`, data: "620EC56B9F0055C8F150E761B9B84051" });
    }
  }
  return makeZip(files);
}
