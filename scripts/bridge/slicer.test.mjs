import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse3mf } from "../../src/lib/threemf.ts";
import { makeZip } from "../../src/lib/threemf.test-helper.ts";
import { FILAMENT_PRESET, MACHINE_PRESET, QUALITY } from "../../src/lib/slice-rules.ts";
import { clearProfileCache } from "./slicer-profiles.mjs";
import { CLI_ERRORS, cleanWorkRoot, planSlice, projectProblem, safeModelName, sliceArgs, sliceModel, slicerConfig } from "./slicer.mjs";

// No Bambu Studio here: a fake exe (spawn) plays its part, writing out/result.json and the .gcode.3mf like the real one
// (02.08.02.61: printer_model_id left empty, no stdout). scripts/bridge/slicer.mjs ran for real on the studio PC.
let root, profilesDir, workRoot;

/** Minimal system profiles: the A1 machine inherits a common file and includes a template, like the real ones. */
function writeProfiles(dir) {
  const put = (kind, file, obj) => { mkdirSync(join(dir, kind), { recursive: true }); writeFileSync(join(dir, kind, `${file}.json`), JSON.stringify(obj)); };
  put("machine", "fdm_machine_common", { name: "fdm_machine_common", instantiation: "false", printable_area: ["0x0", "200x0", "200x200", "0x200"], machine_start_gcode: "G28" });
  put("machine", "A1 start template", { name: "A1 start template", instantiation: "false", machine_start_gcode: ";===== machine: A1 =====" });
  put("machine", MACHINE_PRESET, { name: MACHINE_PRESET, inherits: "fdm_machine_common", include: ["A1 start template"], instantiation: "true", printable_area: ["0x0", "256x0", "256x256", "0x256"] });
  for (const q of Object.values(QUALITY)) put("process", q.preset, { name: q.preset, instantiation: "true", layer_height: q.layer, sparse_infill_density: "15%", enable_support: "0" });
  put("filament", "Bambu PLA Basic @base", { name: "Bambu PLA Basic @base", instantiation: "false", filament_density: ["1.26"], filament_type: ["PLA"] });
  put("filament", FILAMENT_PRESET.PLA, { name: FILAMENT_PRESET.PLA, inherits: "Bambu PLA Basic @base", instantiation: "true", filament_colour: ["#00AE42"] });
  put("filament", FILAMENT_PRESET.PETG, { name: FILAMENT_PRESET.PETG, instantiation: "true", filament_type: ["PETG"], filament_colour: ["#00AE42"] });
}

/** What Bambu Studio writes for this job: settings echo the flattened files it was given. */
function cliOutput(jobDir, { color, type, weight = 4.02, prediction = 1220, modelId = "", over = {} }) {
  const machine = existsSync(join(jobDir, "machine.json")) ? JSON.parse(readFileSync(join(jobDir, "machine.json"), "utf8")) : { name: MACHINE_PRESET };
  const proc = existsSync(join(jobDir, "process.json")) ? JSON.parse(readFileSync(join(jobDir, "process.json"), "utf8")) : { name: "0.20mm Standard @BBL A1", layer_height: "0.2" };
  const fil = JSON.parse(readFileSync(join(jobDir, "filament.json"), "utf8"));
  const project = {
    printer_model: "Bambu Lab A1", nozzle_diameter: ["0.4"], filament_colour: [color ?? fil.filament_colour[0]], filament_type: [type ?? (fil.name.includes("PETG") ? "PETG" : "PLA")],
    print_settings_id: proc.name, filament_settings_id: [fil.name], printer_settings_id: machine.name, sparse_infill_density: proc.sparse_infill_density,
    enable_support: proc.enable_support, layer_height: proc.layer_height, ...over,
  };
  const slice = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header><header_item key="X-BBL-Client-Version" value="02.08.02.61"/></header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="printer_model_id" value="${modelId}"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="prediction" value="${prediction}"/>
    <metadata key="weight" value="${weight}"/>
    <object identify_id="1" name="model.stl" skipped="false" />
    <filament id="1" tray_info_idx="${project.filament_type[0] === "PETG" ? "GFG00" : "GFA00"}" type="${project.filament_type[0]}" color="${project.filament_colour[0]}" used_m="1.3" used_g="${weight}" />
  </plate>
</config>`;
  return makeZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "Metadata/project_settings.config", data: JSON.stringify(project) },
    { name: "Metadata/slice_info.config", data: slice },
    { name: "Metadata/plate_1.json", data: JSON.stringify({ bed_type: "textured_plate", filament_ids: [0] }) },
    { name: "Metadata/plate_1.gcode", data: "; HEADER_BLOCK_START\nG28\n".repeat(20) },
    { name: "Metadata/plate_1.gcode.md5", data: "0123456789ABCDEF0123456789ABCDEF" },
  ]);
}

/**
 * A fake spawn. behave(args, opts) -> { rc, output?: (jobDir) => bytes, hang?: true, exitCode? }.
 * calls: every spawn with its args and options; kills: how many times kill() was called.
 */
function fakeSpawn(behave) {
  const calls = [];
  let kills = 0;
  const spawn = (exe, args, opts) => {
    calls.push({ exe, args, opts, files: readdirSync(opts.cwd) });
    const child = new EventEmitter();
    const b = behave(args, opts);
    child.kill = () => { kills++; setImmediate(() => child.emit("exit", null, "SIGTERM")); return true; };
    if (!b.hang) {
      setImmediate(() => {
        const out = join(opts.cwd, "out");
        if (b.rc !== undefined) writeFileSync(join(out, "result.json"), JSON.stringify({ return_code: b.rc, error_string: b.rc ? "x" : "Success." }));
        if (b.output) {
          const name = args[args.indexOf("--export-3mf") + 1];
          writeFileSync(join(out, name), b.output(opts.cwd));
          writeFileSync(join(out, "plate_1.gcode"), "G28\n");
        }
        child.emit("exit", b.exitCode ?? (b.rc ?? 0) >>> 0, null);
      });
    }
    return child;
  };
  return { spawn, calls, kills: () => kills };
}

const STL = Buffer.from("solid cube\nendsolid cube\n");
/** An unsliced A1 project as Bambu Studio saves it (only what the bridge reads before slicing). */
const project = (settings = {}) => makeZip([
  { name: "3D/3dmodel.model", data: "<model/>" },
  { name: "Metadata/project_settings.config", data: JSON.stringify({ printer_model: "Bambu Lab A1", printer_settings_id: MACHINE_PRESET, post_process: [], ...settings }) },
]);

const job = (over = {}) => ({
  exe: "C:/BambuStudio/bambu-studio.exe", exists: () => true, profilesDir, workRoot, bytes: STL, fileName: "Kubus Uji (v2).STL", mode: "mesh",
  material: "PLA", color: "#ffffff", quality: "standard", infillPct: 20, supports: "auto", ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kesuni-slicer-test-"));
  profilesDir = join(root, "BBL");
  workRoot = join(root, "work");
  writeProfiles(profilesDir);
  clearProfileCache();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("what the bridge asks Bambu Studio for", () => {
  it("cleans the file name: ASCII, no path, lowercase extension", () => {
    expect(safeModelName("Kubus Uji (v2).STL")).toBe("Kubus_Uji_v2.stl");
    expect(safeModelName("C:\\Users\\x\\..\\Désign é.obj")).toBe("Design_e.obj");
    expect(safeModelName("../../.stl")).toBe("model.stl");
    // Windows device names are never written as such (the write would go to the device).
    expect(safeModelName("nul.stl")).toBe("model_nul.stl");
    expect(safeModelName("COM1.obj")).toBe("model_COM1.obj");
    expect(safeModelName("con.backup.stl")).toBe("model_con.backup.stl");
    expect(safeModelName("console.stl")).toBe("console.stl");
  });

  it("checks the request: STL/OBJ meshes, PLA or PETG, #RRGGBB, a known quality, infill 0-100, supports auto/off", () => {
    expect(planSlice({ fileName: "a.stl", material: "pla", color: "#c12e1f", quality: "fine", infillPct: 15, supports: "off" })).toMatchObject({
      mode: "mesh", material: "PLA", filament: "Bambu PLA Basic @BBL A1", color: "#C12E1F", process: "0.16mm Optimal @BBL A1", layer: "0.16",
      processOverrides: { sparse_infill_density: "15%", enable_support: "0", support_type: "tree(auto)" }, filamentOverrides: { filament_colour: ["#C12E1F"] },
    });
    expect(() => planSlice({ fileName: "a.step", material: "PLA", color: "#000000" })).toThrow("STEP files cannot be sliced here: export an STL from the CAD program");
    expect(() => planSlice({ fileName: "a.3mf", material: "PLA", color: "#000000" })).toThrow("Only STL and OBJ files can be sliced here");
    expect(() => planSlice({ fileName: "a.stl", material: "ABS", color: "#000000" })).toThrow("Only PLA and PETG can be sliced here");
    expect(() => planSlice({ fileName: "a.stl", material: "PLA", color: "red" })).toThrow("The colour must be #RRGGBB");
    expect(() => planSlice({ fileName: "a.stl", material: "PLA", color: "#000000", infillPct: 120 })).toThrow("Infill must be 0-100 %");
    expect(() => planSlice({ fileName: "a.stl", material: "PLA", color: "#000000", supports: "always" })).toThrow("Supports must be auto or off");
    expect(planSlice({ fileName: "lamp.3mf", mode: "project", material: "PETG", color: "#FFFFFF" })).toMatchObject({ mode: "project", filament: "Bambu PETG Basic @BBL A1" });
  });

  it("an argument array from a fixed template: flags without values, the model by its relative name last", () => {
    const args = sliceArgs({ jobDir: "J", modelName: "cube.stl", exportName: "cube.gcode.3mf" });
    expect(args[args.indexOf("--min-save") + 1]).toBe("--datadir");
    expect(args).toEqual(expect.arrayContaining(["--slice", "0", "--arrange", "1", "--orient", "0", "--curr-bed-type", "Textured PEI Plate", "--export-3mf", "cube.gcode.3mf"]));
    expect(args.at(-1)).toBe("cube.stl");
    expect(args[args.indexOf("--load-settings") + 1]).toBe(`${join("J", "machine.json")};${join("J", "process.json")}`);
    const project = sliceArgs({ jobDir: "J", modelName: "lamp.3mf", exportName: "lamp.gcode.3mf", mode: "project" });
    expect(project).not.toContain("--load-settings");
    expect(project).not.toContain("--arrange");
    expect(project).toEqual(expect.arrayContaining(["--slice", "--min-save", "--load-filaments", "--export-3mf"]));
  });

  it("finds Bambu Studio and its A1 profiles, or says why slicing is off (never a path)", () => {
    const on = slicerConfig({}, () => true);
    expect(on).toMatchObject({ on: true, exe: "C:\\Program Files\\Bambu Studio\\bambu-studio.exe", note: "slicing with Bambu Studio" });
    expect(on.profilesDir).toBe(join("C:\\Program Files\\Bambu Studio", "resources", "profiles", "BBL"));
    expect(slicerConfig({ BAMBU_STUDIO_PATH: "D:/BS/bambu-studio.exe", BAMBU_PROFILES_DIR: "D:/p" }, () => true)).toMatchObject({ exe: "D:/BS/bambu-studio.exe", profilesDir: "D:/p" });
    expect(slicerConfig({}, () => false)).toMatchObject({ on: false, note: "slicing off: Bambu Studio was not found (set BAMBU_STUDIO_PATH)" });
    expect(slicerConfig({}, (p) => p.endsWith(".exe"))).toMatchObject({ on: false, note: "slicing off: the Bambu Studio A1 profiles were not found (set BAMBU_PROFILES_DIR)" });
    expect(slicerConfig({ BRIDGE_SLICER: "off" }, () => true)).toMatchObject({ on: false, note: "slicing off (BRIDGE_SLICER=off)" });
  });
});

describe("sliceModel", () => {
  it("slices in a fresh folder with flattened profiles, fills the A1 model id, checks the file and leaves nothing behind", async () => {
    const fake = fakeSpawn(() => ({ rc: 0, output: (dir) => cliOutput(dir, {}) }));
    const r = await sliceModel(job({ spawn: fake.spawn }));
    expect(r).toMatchObject({ ok: true, fileName: "Kubus_Uji_v2.gcode.3mf" });
    const info = parse3mf(r.bytes);
    expect(info).toMatchObject({ sliced: true, printerModelId: "N2S", plates: [{ weightG: 4.02, predictionSec: 1220, bedType: "textured_plate", filaments: [{ type: "PLA", color: "#FFFFFF", infoIdx: "GFA00" }] }] });
    const [call] = fake.calls;
    expect(call.exe).toBe("C:/BambuStudio/bambu-studio.exe");
    expect(call.opts).toMatchObject({ windowsHide: true, stdio: "ignore", shell: false });
    expect(call.opts.env.TEMP).toBe(join(call.opts.cwd, "tmp"));
    expect(call.opts.env.TMP).toBe(join(call.opts.cwd, "tmp"));
    expect(call.args.at(-1)).toBe("Kubus_Uji_v2.stl");
    expect(call.files.sort()).toEqual(["Kubus_Uji_v2.stl", "filament.json", "machine.json", "out", "process.json", "tmp"]);
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("the flattened profiles carry the A1 settings and the job's colour, infill and supports", async () => {
    let seen;
    const fake = fakeSpawn((_args, opts) => {
      seen = Object.fromEntries(["machine", "process", "filament"].map((k) => [k, JSON.parse(readFileSync(join(opts.cwd, `${k}.json`), "utf8"))]));
      return { rc: 0, output: (dir) => cliOutput(dir, {}) };
    });
    expect((await sliceModel(job({ spawn: fake.spawn, material: "PETG", color: "#1e90ff", quality: "fine", infillPct: 15, supports: "off" }))).ok).toBe(true);
    expect(seen.machine).toMatchObject({ name: MACHINE_PRESET, from: "system", type: "machine", printable_area: ["0x0", "256x0", "256x256", "0x256"], machine_start_gcode: ";===== machine: A1 =====" });
    expect(seen.machine.inherits).toBeUndefined();
    expect(seen.process).toMatchObject({ name: "0.16mm Optimal @BBL A1", layer_height: "0.16", sparse_infill_density: "15%", enable_support: "0", support_type: "tree(auto)" });
    expect(seen.filament).toMatchObject({ name: "Bambu PETG Basic @BBL A1", filament_colour: ["#1E90FF"] });
  });

  it("Bambu Studio's return codes become short English reasons (the exit code arrives unsigned)", async () => {
    const tooBig = fakeSpawn(() => ({ rc: -50 }));
    expect(await sliceModel(job({ spawn: tooBig.spawn }))).toEqual({ ok: false, code: -50, message: CLI_ERRORS[-50] });
    const noResult = fakeSpawn(() => ({ exitCode: 4294967290 }));
    expect(await sliceModel(job({ spawn: noResult.spawn }))).toEqual({ ok: false, code: -6, message: "The model file could not be read (broken, empty or not a supported 3D file)" });
    const odd = fakeSpawn(() => ({ rc: -77 }));
    expect(await sliceModel(job({ spawn: odd.spawn }))).toEqual({ ok: false, code: -77, message: "Slicing failed (code -77)" });
    const nothing = fakeSpawn(() => ({ rc: 0 }));
    expect(await sliceModel(job({ spawn: nothing.spawn }))).toMatchObject({ ok: false, message: "The slicer wrote no file" });
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("a slicer that runs too long is killed, and its folder is removed", async () => {
    const fake = fakeSpawn(() => ({ hang: true }));
    const r = await sliceModel(job({ spawn: fake.spawn, timeoutMs: 50 }));
    expect(r).toEqual({ ok: false, code: "timeout", message: "Slicing took longer than 1 min and was stopped" });
    expect(fake.kills()).toBe(1);
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("refuses a file that is not what was asked: nothing is uploaded", async () => {
    const wrongColour = fakeSpawn(() => ({ rc: 0, output: (dir) => cliOutput(dir, { color: "#00AE42" }) }));
    expect(await sliceModel(job({ spawn: wrongColour.spawn }))).toMatchObject({ ok: false, code: "bad-output", message: "The slicer output has the wrong filament or colour" });
    const noWeight = fakeSpawn(() => ({ rc: 0, output: (dir) => cliOutput(dir, { weight: 0 }) }));
    expect(await sliceModel(job({ spawn: noWeight.spawn }))).toMatchObject({ ok: false, message: "The slicer output has no weight or time" });
    const otherInfill = fakeSpawn(() => ({ rc: 0, output: (dir) => cliOutput(dir, { over: { sparse_infill_density: "15%" } }) }));
    expect(await sliceModel(job({ spawn: otherInfill.spawn }))).toMatchObject({ ok: false, message: "The slicer output has other settings than asked" });
    const otherPrinter = fakeSpawn(() => ({ rc: 0, output: (dir) => cliOutput(dir, { modelId: "C11" }) }));
    expect(await sliceModel(job({ spawn: otherPrinter.spawn }))).toMatchObject({ ok: false, message: "The slicer output is not for the Bambu Lab A1" });
    const garbage = fakeSpawn(() => ({ rc: 0, output: () => Buffer.from("not a zip") }));
    expect(await sliceModel(job({ spawn: garbage.spawn }))).toMatchObject({ ok: false, message: "The sliced file could not be read" });
    expect(readdirSync(workRoot)).toEqual([]);
  });

  it("never starts Bambu Studio for a request it refuses, an empty model, or when Bambu Studio is missing", async () => {
    const fake = fakeSpawn(() => ({ rc: 0 }));
    expect(await sliceModel(job({ spawn: fake.spawn, fileName: "part.step" }))).toMatchObject({ ok: false, code: "bad-request" });
    expect(await sliceModel(job({ spawn: fake.spawn, material: "ABS" }))).toMatchObject({ ok: false, code: "bad-request" });
    expect(await sliceModel(job({ spawn: fake.spawn, bytes: Buffer.alloc(0) }))).toMatchObject({ ok: false, message: "The model file is empty or larger than 50 MB" });
    expect(await sliceModel(job({ spawn: fake.spawn, exists: () => false }))).toEqual({ ok: false, code: "no-slicer", message: "Bambu Studio was not found on the studio PC" });
    expect(await sliceModel(job({ spawn: fake.spawn, profilesDir: join(root, "nowhere") }))).toMatchObject({ ok: false, code: "no-profiles" });
    expect(fake.calls).toHaveLength(0);
    const broken = await sliceModel(job({ spawn: () => { throw new Error("spawn C:\\Users\\me\\x.exe ENOENT"); } }));
    expect(broken).toEqual({ ok: false, code: "spawn", message: "Bambu Studio could not be started" });
  });

  it("an unsliced A1 project keeps its own settings: only the filament is loaded", async () => {
    const fake = fakeSpawn(() => ({ rc: 0, output: (dir) => cliOutput(dir, {}) }));
    const r = await sliceModel(job({ spawn: fake.spawn, fileName: "Lamp.3mf", bytes: project(), mode: "project", material: "PLA", color: "#FFFFFF" }));
    expect(r).toMatchObject({ ok: true, fileName: "Lamp.gcode.3mf" });
    expect(fake.calls[0].files.sort()).toEqual(["Lamp.3mf", "filament.json", "out", "tmp"]);
    expect(fake.calls[0].args).not.toContain("--load-settings");
  });

  it("a customer's project never reaches Bambu Studio with a script, other printer settings, or a huge unpacked size", async () => {
    const fake = fakeSpawn(() => ({ rc: 0, output: (dir) => cliOutput(dir, {}) }));
    const ask = (bytes) => sliceModel(job({ spawn: fake.spawn, fileName: "Lamp.3mf", bytes, mode: "project", material: "PLA", color: "#FFFFFF" }));
    expect(await ask(project({ post_process: ["python.exe fix_gcode.py"] }))).toMatchObject({ ok: false, code: "bad-request", message: "The 3MF runs a post-processing script: slice it in Bambu Studio" });
    expect(await ask(project({ printer_settings_id: "Bambu Lab A1 0.4 nozzle - my start gcode" }))).toMatchObject({ ok: false, message: "The 3MF uses its own printer settings: slice it in Bambu Studio" });
    expect(await ask(STL)).toMatchObject({ ok: false, message: "The 3MF could not be read (broken, or a suspicious archive)" });
    expect(fake.calls).toHaveLength(0);
    expect(projectProblem(project())).toBeNull();
  });

  it("result.json says success but Bambu Studio crashed on exit: the file decides; a failure names the code", async () => {
    const crashOnExit = fakeSpawn(() => ({ rc: 0, exitCode: -1073741819, output: (dir) => cliOutput(dir, {}) }));
    expect(await sliceModel(job({ spawn: crashOnExit.spawn }))).toMatchObject({ ok: true });
    const noResult = fakeSpawn(() => ({ exitCode: 3 }));
    expect(await sliceModel(job({ spawn: noResult.spawn }))).toMatchObject({ ok: false, message: "Slicing failed (code 3)" });
  });

  it("old job folders left by a killed bridge are removed at start", () => {
    mkdirSync(join(workRoot, "slice-old1"), { recursive: true });
    mkdirSync(join(workRoot, "keep-me"), { recursive: true });
    expect(cleanWorkRoot(workRoot, Date.now() + 2 * 3600_000)).toBe(1);
    expect(readdirSync(workRoot)).toEqual(["keep-me"]);
  });
});
