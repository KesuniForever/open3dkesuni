// Flattens a Bambu Studio system profile: resolves its "inherits" chain and its "include" templates inside the vendor
// folder (resources/profiles/BBL/<kind>/). Bambu Studio's command line (02.08) does NOT resolve them itself: a raw
// system profile "succeeds" with built-in defaults (200x200 bed, a plain G28 start G-code, density 0, Cool Plate), and
// that file would print wrongly. Merge order: parent < include templates < the file's own keys. Pure Node, no network.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KINDS = new Set(["machine", "process", "filament"]);
const indexCache = new Map(); // dir -> Map(name -> file)

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** The file of preset `name` in `dir`: "<name>.json" when its name matches, else a scan of the folder's "name" fields. */
function findFile(dir, name) {
  const direct = join(dir, `${name}.json`);
  if (existsSync(direct)) {
    try { if (readJson(direct).name === name) return direct; } catch { /* scan the folder */ }
  }
  let idx = indexCache.get(dir);
  if (!idx) {
    idx = new Map();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try { const j = readJson(join(dir, f)); if (typeof j.name === "string") idx.set(j.name, join(dir, f)); } catch { /* skip */ }
    }
    indexCache.set(dir, idx);
  }
  const hit = idx.get(name);
  if (!hit) throw new Error(`profile not found: ${name}`);
  return hit;
}

function resolve(dir, name, seen) {
  if (seen.has(name)) throw new Error(`inherits loop at ${name}`);
  if (seen.size > 16) throw new Error("inherits chain too deep");
  seen.add(name);
  const own = readJson(findFile(dir, name));
  const merged = own.inherits ? resolve(dir, own.inherits, seen) : {};
  for (const inc of Array.isArray(own.include) ? own.include : []) {
    for (const [k, v] of Object.entries(readJson(findFile(dir, inc)))) {
      if (k !== "name" && k !== "instantiation" && k !== "type" && k !== "from") merged[k] = v;
    }
  }
  for (const [k, v] of Object.entries(own)) merged[k] = v;
  return merged;
}

/**
 * One printable preset with everything it inherits, plus the job's overrides (string values, like the profiles).
 * @param {string} profilesDir  e.g. C:\Program Files\Bambu Studio\resources\profiles\BBL
 * @param {"machine"|"process"|"filament"} kind
 * @param {string} name         preset name, e.g. "Bambu Lab A1 0.4 nozzle"
 * @param {Record<string, string|string[]>} [overrides]
 */
export function flattenProfile(profilesDir, kind, name, overrides = {}) {
  if (!KINDS.has(kind)) throw new Error(`bad kind ${kind}`);
  const flat = resolve(join(profilesDir, kind), name, new Set());
  if (flat.instantiation !== "true") throw new Error(`${name} is not a printable preset`);
  delete flat.inherits;
  delete flat.include;
  flat.from = "system";
  flat.type = kind;
  flat.name = name;
  for (const [k, v] of Object.entries(overrides)) flat[k] = v;
  return flat;
}

/** Tests only: forget the folder scans. */
export const clearProfileCache = () => indexCache.clear();
