// Slices ONE model on the studio PC with Bambu Studio's command line (02.08.02.61) into a printable A1 0.4 mm
// .gcode.3mf, single colour. Never talks to a printer and never touches the network. The model comes from a customer:
// it is untrusted input to the slicer.
//   - spawn with an argument array built from a fixed template (never a shell, never user text but the cleaned file
//     name), cwd = a fresh job folder, TEMP/TMP inside it (Bambu Studio leaves %TEMP%\bamboo_model folders behind)
//   - a private, empty --datadir: %APPDATA%\BambuStudio is never read or written
//   - flattened system profiles (the command line does not resolve "inherits"/"include" by itself)
//   - 10 min timeout and kill, 50 MB in and out, the job folder deleted afterwards whatever happened
//   - out/result.json is the only feedback (the exe is a GUI program: no stdout or stderr, ever)
//   - the output checked with the app's own parse3mf before upload, after printer_model_id is filled with "N2S"
// Never run the exe without --slice and --export-3mf: it then opens the full Bambu Studio window on the studio PC.
// Texts returned are English, short, and never hold a local path (only the cleaned file name).
// Spec: scratchpad slicer-spec.md (all flags here were run on the studio PC).
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import {
  A1, FILAMENT_PRESET, MACHINE_PRESET, MAX_SLICE_BYTES, MESH_EXTS, QUALITY, SLICE_TIMEOUT_MS, sliceOutputProblem,
} from "../../src/lib/slice-rules.ts";
import { parse3mf, readEntry, zipEntries } from "../../src/lib/threemf.ts";
import { flattenProfile } from "./slicer-profiles.mjs";
import { fillPrinterModelId } from "./zip-patch.mjs";

export const DEFAULT_EXE = "C:\\Program Files\\Bambu Studio\\bambu-studio.exe";
export const BED_TYPE = "Textured PEI Plate";

/** Bambu Studio's return codes seen on the studio PC (and the ones it defines that matter), as short English text. */
export const CLI_ERRORS = Object.freeze({
  [-1]: "The slicer could not start",
  [-2]: "The slicer did not accept its settings",
  [-3]: "A file the slicer needs was not found",
  [-5]: "A slicer profile could not be read",
  [-6]: "The model file could not be read (broken, empty or not a supported 3D file)",
  [-17]: "The quality preset does not fit the Bambu Lab A1",
  [-50]: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty",
  [-51]: "The slicer rejected the settings",
  [-100]: "Slicing failed",
});

const COLOR = /^#[0-9A-F]{6}$/;
const off = (v) => /^(off|0|false|no)$/i.test(String(v ?? "").trim());

/**
 * Where Bambu Studio is on this PC: BAMBU_STUDIO_PATH (default C:\Program Files\Bambu Studio\bambu-studio.exe) and
 * BAMBU_PROFILES_DIR (default <its folder>\resources\profiles\BBL). BRIDGE_SLICER=off turns slicing off. `note` is
 * printed at start and holds no path.
 */
export function slicerConfig(env, exists = existsSync) {
  const exe = env.BAMBU_STUDIO_PATH || DEFAULT_EXE;
  const profilesDir = env.BAMBU_PROFILES_DIR || join(dirname(exe), "resources", "profiles", "BBL");
  const workRoot = join(tmpdir(), "kesuni-slicer");
  if (off(env.BRIDGE_SLICER)) return { on: false, exe, profilesDir, workRoot, note: "slicing off (BRIDGE_SLICER=off)" };
  if (!exists(exe)) return { on: false, exe, profilesDir, workRoot, note: "slicing off: Bambu Studio was not found (set BAMBU_STUDIO_PATH)" };
  if (!exists(join(profilesDir, "machine", `${MACHINE_PRESET}.json`))) {
    return { on: false, exe, profilesDir, workRoot, note: "slicing off: the Bambu Studio A1 profiles were not found (set BAMBU_PROFILES_DIR)" };
  }
  return { on: true, exe, profilesDir, workRoot, note: "slicing with Bambu Studio" };
}

/** Job folders left behind (the bridge was killed mid-slice) and older than an hour are removed at start. */
export function cleanWorkRoot(workRoot, now = Date.now()) {
  let removed = 0;
  let names = [];
  try { names = readdirSync(workRoot); } catch { return 0; }
  for (const name of names.filter((n) => /^slice-[A-Za-z0-9]+$/.test(n))) {
    try {
      if (now - statSync(join(workRoot, name)).mtimeMs > 3600_000) { rmSync(join(workRoot, name), { recursive: true, force: true }); removed++; }
    } catch { /* in use or gone */ }
  }
  return removed;
}

/** Windows device names: "nul.stl" or "COM1.obj" would be written to the device, not to a file. */
const DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** "Jam Gadang (v2).STL" -> "Jam_Gadang_v2.stl": ASCII, never a path, never a device. The only local name the slicer or the 3MF sees. */
export function safeModelName(original) {
  const name = basename(String(original ?? "").replaceAll("\\", "/"));
  const m = /(\.[A-Za-z0-9]{1,8})$/.exec(name);
  const ext = m ? m[1].toLowerCase() : "";
  const base = (m ? name.slice(0, -m[1].length) : name).normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "").slice(0, 60);
  const safe = base || "model";
  return `${DEVICE_NAME.test(safe) ? `model_${safe}` : safe}${ext}`;
}

/** A project 3MF unpacked by Bambu Studio may hold at most this much (a 50 MB file must not fill the studio PC's disk). */
export const MAX_PROJECT_UNPACKED = 500 * 1024 * 1024;

/**
 * Why an unsliced 3MF project from a customer must not reach Bambu Studio, or null: too many entries or too large once
 * unpacked (zip bomb), a post-processing script, or printer settings other than the studio's A1 0.4 nozzle preset.
 */
export function projectProblem(bytes) {
  let entries;
  try {
    entries = zipEntries(bytes);
  } catch {
    return "The 3MF could not be read (broken, or a suspicious archive)";
  }
  if (entries.reduce((n, e) => n + e.size, 0) > MAX_PROJECT_UNPACKED) return "The 3MF unpacks to more than 500 MB";
  let ps;
  try {
    ps = JSON.parse(zipText(bytes, "Metadata/project_settings.config"));
  } catch {
    return "The 3MF has no readable Bambu Studio settings";
  }
  const post = [ps.post_process].flat().filter((x) => typeof x === "string" && x.trim());
  if (post.length) return "The 3MF runs a post-processing script: slice it in Bambu Studio";
  if (ps.printer_settings_id !== MACHINE_PRESET) return "The 3MF uses its own printer settings: slice it in Bambu Studio";
  return null;
}

/** Checks one request and returns exactly what to slice with. Throws an Error with a short English reason. */
export function planSlice(req) {
  const mode = req.mode === "project" ? "project" : "mesh";
  const ext = extname(safeModelName(req.fileName));
  if (mode === "mesh" && !MESH_EXTS.includes(ext)) {
    throw new Error(ext === ".step" || ext === ".stp" ? "STEP files cannot be sliced here: export an STL from the CAD program" : "Only STL and OBJ files can be sliced here");
  }
  if (mode === "project" && ext !== ".3mf") throw new Error("Only a Bambu Studio 3MF can be sliced with its own settings");
  const material = String(req.material ?? "").toUpperCase();
  const filament = FILAMENT_PRESET[material];
  if (!filament) throw new Error("Only PLA and PETG can be sliced here");
  const color = String(req.color ?? "").toUpperCase();
  if (!COLOR.test(color)) throw new Error("The colour must be #RRGGBB");
  const q = QUALITY[req.quality ?? "standard"];
  if (!q) throw new Error("Unknown quality");
  const infill = req.infillPct ?? 20;
  if (!Number.isInteger(infill) || infill < 0 || infill > 100) throw new Error("Infill must be 0-100 %");
  const supports = req.supports ?? "auto";
  if (supports !== "auto" && supports !== "off") throw new Error("Supports must be auto or off");
  return {
    mode, ext, material, filament, color, infill, supports, layer: q.layer, process: q.preset,
    processOverrides: { sparse_infill_density: `${infill}%`, enable_support: supports === "auto" ? "1" : "0", support_type: "tree(auto)" },
    filamentOverrides: { filament_colour: [color] },
  };
}

/**
 * The argument array (no shell). A mesh is arranged on the bed (required: an STL off the bed fails) and keeps the
 * designer's orientation; a project keeps its own machine, process and plates and only gets our filament.
 * Boolean flags (--min-save) take NO value: a value would be read as an input file.
 */
export function sliceArgs({ jobDir, modelName, exportName, mode = "mesh" }) {
  const common = ["--slice", "0", "--min-save", "--datadir", join(jobDir, "dd")];
  const mesh = mode === "mesh"
    ? ["--arrange", "1", "--orient", "0", "--curr-bed-type", BED_TYPE,
      "--load-settings", `${join(jobDir, "machine.json")};${join(jobDir, "process.json")}`]
    : ["--curr-bed-type", BED_TYPE];
  return [
    ...common, ...mesh,
    "--load-filaments", join(jobDir, "filament.json"),
    "--outputdir", join(jobDir, "out"),
    "--export-3mf", exportName, // written inside --outputdir (with plate_1.gcode and result.json: only the 3MF is used)
    modelName,                  // relative to cwd = jobDir: the 3MF's object name is only the file name
  ];
}

function run(spawn, exe, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let timedOut = false;
    let child;
    try {
      child = spawn(exe, args, { cwd, env, windowsHide: true, stdio: "ignore", shell: false });
    } catch (e) {
      resolve({ code: null, error: e });
      return;
    }
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, error: e }); });
    // Node reports the exit code unsigned on Windows (-6 arrives as 4294967290).
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code: code === null ? null : code | 0, signal, timedOut }); });
  });
}

export const zipText = (bytes, name) => {
  const e = zipEntries(bytes).find((x) => x.name === name);
  if (!e) throw new Error(`${name} is missing`);
  return readEntry(bytes, e).toString("utf8");
};

/** The output must be exactly what was asked, or nothing is uploaded. Returns a short English reason or null. */
export function checkOutput(bytes, plan) {
  const info = parse3mf(bytes);
  const shared = sliceOutputProblem(info, { mode: plan.mode, material: plan.material, color: plan.color });
  if (shared) return shared;
  if (info.printerModelId !== A1.modelId) return "The slicer output is not for the Bambu Lab A1";
  let ps;
  try {
    ps = JSON.parse(zipText(bytes, "Metadata/project_settings.config"));
  } catch {
    return "The slicer output has no readable settings";
  }
  if (ps.filament_settings_id?.[0] !== plan.filament) return "The slicer output used another filament profile";
  if (ps.printer_settings_id !== MACHINE_PRESET) return "The slicer output used other profiles";
  if (plan.mode === "mesh") {
    if (ps.print_settings_id !== plan.process) return "The slicer output used other profiles";
    if (ps.sparse_infill_density !== `${plan.infill}%` || ps.enable_support !== plan.processOverrides.enable_support || ps.layer_height !== plan.layer) {
      return "The slicer output has other settings than asked";
    }
  }
  return null;
}

/**
 * Slices one model. Returns { ok: true, bytes, fileName, info, ms } or { ok: false, message, code }.
 * @param {{ exe?: string, profilesDir: string, workRoot: string, bytes: Uint8Array, fileName: string,
 *   mode?: "mesh"|"project", material: "PLA"|"PETG", color: string, quality?: "draft"|"standard"|"fine", infillPct?: number,
 *   supports?: "auto"|"off", timeoutMs?: number, spawn?: Function, exists?: Function, now?: () => number }} o
 */
export async function sliceModel(o) {
  const now = o.now ?? Date.now;
  const t0 = now();
  let plan;
  try {
    plan = planSlice(o);
  } catch (e) {
    return { ok: false, message: e.message, code: "bad-request" };
  }
  const size = o.bytes?.length ?? 0;
  if (size === 0 || size > MAX_SLICE_BYTES) return { ok: false, message: "The model file is empty or larger than 50 MB", code: "bad-request" };
  if (plan.mode === "project") {
    const problem = projectProblem(o.bytes);
    if (problem) return { ok: false, message: problem, code: "bad-request" };
  }
  const exe = o.exe || DEFAULT_EXE;
  if (!(o.exists ?? existsSync)(exe)) return { ok: false, message: "Bambu Studio was not found on the studio PC", code: "no-slicer" };

  mkdirSync(o.workRoot, { recursive: true });
  const jobDir = mkdtempSync(join(o.workRoot, "slice-"));
  try {
    mkdirSync(join(jobDir, "out"));
    mkdirSync(join(jobDir, "tmp"));
    const modelName = safeModelName(o.fileName);
    writeFileSync(join(jobDir, modelName), o.bytes);
    const write = (name, obj) => writeFileSync(join(jobDir, name), JSON.stringify(obj));
    try {
      if (plan.mode === "mesh") {
        write("machine.json", flattenProfile(o.profilesDir, "machine", MACHINE_PRESET));
        write("process.json", flattenProfile(o.profilesDir, "process", plan.process, plan.processOverrides));
      }
      write("filament.json", flattenProfile(o.profilesDir, "filament", plan.filament, plan.filamentOverrides));
    } catch {
      return { ok: false, message: "The Bambu Studio profiles were not found on the studio PC", code: "no-profiles" };
    }
    const exportName = `${basename(modelName, plan.ext)}.gcode.3mf`;
    const args = sliceArgs({ jobDir, modelName, exportName, mode: plan.mode });
    const env = { ...process.env, TEMP: join(jobDir, "tmp"), TMP: join(jobDir, "tmp") };
    const r = await run(o.spawn ?? nodeSpawn, exe, args, { cwd: jobDir, env, timeoutMs: o.timeoutMs ?? SLICE_TIMEOUT_MS });
    if (r.error) return { ok: false, message: "Bambu Studio could not be started", code: "spawn" };
    if (r.timedOut) return { ok: false, message: `Slicing took longer than ${Math.round((o.timeoutMs ?? SLICE_TIMEOUT_MS) / 60_000) || 1} min and was stopped`, code: "timeout" };
    let result = null;
    try { result = JSON.parse(readFileSync(join(jobDir, "out", "result.json"), "utf8")); } catch { /* none written */ }
    // result.json is Bambu Studio's own verdict; it can crash on exit after a good slice, so a non-zero exit code with
    // return_code 0 lets the file decide (it is checked below like any other).
    const rc = typeof result?.return_code === "number" ? result.return_code : r.code;
    if (rc !== 0) return { ok: false, message: CLI_ERRORS[rc] ?? `Slicing failed (code ${rc})`, code: rc };
    const outFile = join(jobDir, "out", exportName);
    if (!existsSync(outFile)) return { ok: false, message: "The slicer wrote no file", code: "no-output" };
    if (statSync(outFile).size > MAX_SLICE_BYTES) return { ok: false, message: "The sliced file is larger than 50 MB", code: "too-large" };
    let bytes;
    try {
      bytes = fillPrinterModelId(readFileSync(outFile));
    } catch {
      return { ok: false, message: "The sliced file could not be read", code: "bad-output" };
    }
    const problem = checkOutput(bytes, plan);
    if (problem) return { ok: false, message: problem, code: "bad-output" };
    return { ok: true, bytes, fileName: exportName, info: parse3mf(bytes), ms: now() - t0 };
  } finally {
    // A killed slicer may hold its files a moment longer on Windows: retry, and never let the cleanup hide the result.
    try { rmSync(jobDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the next start of the bridge can clean it */ }
  }
}
