// Bambu's official A1 message tables (HMS and device errors), in English and Indonesian ->
// src/lib/printer/bambu-errors.json, which the app reads server-side (src/lib/printer/errors.ts).
//   node scripts/fetch-bambu-errors.mjs              download from e.bambulab.com (public, no login)
//   node scripts/fetch-bambu-errors.mjs --from DIR   use DIR/hms-a1-en.json and DIR/hms-a1-id.json saved earlier
// d=039 is the A1's serial prefix (Bambu Studio N2S.json). Empty texts are dropped. Read-only: no printer is contacted.
// A device error that IS in the table but with an empty text is one of Bambu's internal codes: Bambu Studio hides it
// (DevHMSQuery is_internal_error). Those are kept apart as "internal"; bambu.ts INTERNAL_PRINT_ERRORS must list the same
// codes (a test compares them).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "lib", "printer", "bambu-errors.json");
const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : null;

async function table(lang) {
  if (from) return JSON.parse(readFileSync(join(from, `hms-a1-${lang}.json`), "utf8"));
  const res = await fetch(`https://e.bambulab.com/query.php?lang=${lang}&d=039`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`e.bambulab.com answered ${res.status} for ${lang}`);
  return res.json();
}

function compact(json, lang) {
  const pick = (rows) => Object.fromEntries((rows ?? []).filter((r) => r.intro && /^[0-9A-F]+$/i.test(r.ecode)).map((r) => [r.ecode.toUpperCase(), r.intro.trim()]));
  return { hms: pick(json.data?.device_hms?.[lang]), err: pick(json.data?.device_error?.[lang]) };
}

/** Device errors listed with an empty text (English table): internal codes, never shown to a person. */
const internal = (json) => (json.data?.device_error?.en ?? [])
  .filter((r) => /^[0-9A-F]{8}$/i.test(r.ecode ?? "") && !String(r.intro ?? "").trim()).map((r) => r.ecode.toUpperCase()).sort();

const [en, id] = await Promise.all([table("en"), table("id")]);
const out = { ver: String(en.ver ?? ""), en: compact(en, "en"), id: compact(id, "id"), internal: internal(en) };
if (Object.keys(out.en.hms).length < 100) throw new Error("The English table looks empty; nothing written");
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${OUT}: ${Object.keys(out.en.hms).length} HMS + ${Object.keys(out.en.err).length} errors (en), `
  + `${out.internal.length} internal codes (${out.internal.join(", ")}), version ${out.ver}`);
