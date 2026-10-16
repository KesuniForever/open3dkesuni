import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearProfileCache, flattenProfile } from "./slicer-profiles.mjs";

// Bambu Studio's system profiles inherit from parents and include templates; its command line resolves neither, so the
// bridge flattens them: parent < include templates < the file's own keys.
let dir;
const put = (kind, file, obj) => { mkdirSync(join(dir, kind), { recursive: true }); writeFileSync(join(dir, kind, `${file}.json`), JSON.stringify(obj)); };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kesuni-profiles-")); clearProfileCache(); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("flattenProfile", () => {
  it("merges the chain and the templates, drops inherits/include, and applies the job's overrides last", () => {
    put("process", "fdm_process_common", { name: "fdm_process_common", instantiation: "false", wall_loops: "2", layer_height: "0.2", sparse_infill_density: "15%" });
    put("process", "single 0.20", { name: "fdm_process_single_0.20", inherits: "fdm_process_common", instantiation: "false", layer_height: "0.2", top_shell_layers: "5" });
    put("process", "A1 speeds", { name: "A1 speeds", instantiation: "false", outer_wall_speed: "200", wall_loops: "3" });
    // The file name differs from the preset name: found by scanning the folder.
    put("process", "standard", { name: "0.20mm Standard @BBL A1", inherits: "fdm_process_single_0.20", include: ["A1 speeds"], instantiation: "true", wall_loops: "2" });
    expect(flattenProfile(dir, "process", "0.20mm Standard @BBL A1", { sparse_infill_density: "20%" })).toEqual({
      name: "0.20mm Standard @BBL A1", from: "system", type: "process", instantiation: "true",
      wall_loops: "2", layer_height: "0.2", top_shell_layers: "5", outer_wall_speed: "200", sparse_infill_density: "20%",
    });
  });

  it("refuses a loop, a missing parent, a preset that is not printable, and an unknown kind", () => {
    put("filament", "a", { name: "a", inherits: "b", instantiation: "true" });
    put("filament", "b", { name: "b", inherits: "a", instantiation: "false" });
    put("filament", "c", { name: "c", inherits: "nowhere", instantiation: "true" });
    put("filament", "base", { name: "base", instantiation: "false" });
    expect(() => flattenProfile(dir, "filament", "a")).toThrow("inherits loop at a");
    expect(() => flattenProfile(dir, "filament", "c")).toThrow("profile not found: nowhere");
    expect(() => flattenProfile(dir, "filament", "base")).toThrow("base is not a printable preset");
    expect(() => flattenProfile(dir, "gcode", "a")).toThrow("bad kind gcode");
  });
});
