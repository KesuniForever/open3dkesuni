// Production start (`npm start`, and the Docker image on Railway): checks where the data will live, then runs
// `next start` in this same process (so Railway's stop signal reaches Next.js directly). Arguments are passed on,
// e.g. `npm start -- -p 4000`. The port comes from PORT (Railway sets it), default 3000.
//
// On Railway (RAILWAY_* variables present) the SQLite database and the uploaded files must be on the volume:
// empty KESUNI_DB_PATH / KESUNI_FILES_DIR default to <volume>/kesuni.db and <volume>/files, and a missing volume or a
// path off the volume stops the start with a clear message, before any order can be written to a throwaway disk.
// Locally nothing changes. Rules and tests: src/lib/deploy.ts.
import { createRequire } from "node:module";
import { storagePlan } from "../src/lib/deploy.ts";

const plan = storagePlan(process.env, process.cwd());
for (const [name, value] of Object.entries(plan.defaults)) process.env[name] = value;
if (plan.onRailway) {
  console.log(`Open3DKesuni data: database ${plan.dbPath}, files ${plan.filesDir}${plan.volume ? ` (volume ${plan.volume})` : " (no volume)"}`);
}
if (plan.errors.length) {
  for (const e of plan.errors) console.error(`x ${e}`);
  console.error("x Not starting, so no order is written where a redeploy would erase it. See docs/DEPLOY-RAILWAY.md.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const bin = require.resolve("next/dist/bin/next");
process.argv = [process.argv[0], bin, "start", ...process.argv.slice(2)];
require(bin);
