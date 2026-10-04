// One-time Circle setup for Arc testnet. Run: node scripts/circle-setup.mjs
// 1. Generates and registers an entity secret (if .env.local has none).
// 2. Creates the wallet set (if .env.local has no CIRCLE_WALLET_SET_ID).
// Secrets are written to .env.local and the recovery file is kept outside the repo.
// Nothing secret is ever printed.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const RECOVERY_DIR = join(homedir(), ".kesuni3d");
const RECOVERY_PATH = join(RECOVERY_DIR, "circle-recovery-testnet.dat");
const WALLET_SET_NAME = "kesuni3d-testnet";

function fail(msg) {
  console.error(`x ${msg}`);
  process.exit(1);
}

function parseEnv(source) {
  const out = new Map();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out.set(line.slice(0, eq).trim(), value);
  }
  return out;
}

function upsert(source, key, value) {
  // [ \t] not \s: \s would swallow line breaks and glue the key onto the previous line.
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, "m");
  return pattern.test(source)
    ? source.replace(pattern, `${key}=${value}`)
    : `${source.replace(/\s*$/, "")}\n${key}=${value}\n`;
}

let envSource;
try {
  envSource = (await readFile(ENV_PATH, "utf8")).replace(/\r\n?/g, "\n");
} catch {
  fail("No .env.local found. Copy .env.example to .env.local first.");
}
const env = parseEnv(envSource);
const apiKey = env.get("CIRCLE_API_KEY");
if (!apiKey) fail("CIRCLE_API_KEY is empty in .env.local. Paste your Circle testnet API key there first.");
if (!apiKey.startsWith("TEST_API_KEY:")) {
  fail("CIRCLE_API_KEY is not a testnet key (should start with TEST_API_KEY:). Refusing to continue.");
}

let entitySecret = env.get("CIRCLE_ENTITY_SECRET");
if (!entitySecret) {
  entitySecret = randomBytes(32).toString("hex");
  console.log("> Registering a new entity secret with Circle...");
  await mkdir(RECOVERY_DIR, { recursive: true });
  // The SDK also writes its own copy of the recovery file; point it outside the repo.
  const res = await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: RECOVERY_DIR });
  const recovery = res.data?.recoveryFile;
  if (!recovery) fail("Circle did not return a recovery file. Nothing was saved.");
  await mkdir(RECOVERY_DIR, { recursive: true });
  await writeFile(RECOVERY_PATH, recovery, { encoding: "utf8", mode: 0o600 });
  envSource = upsert(envSource, "CIRCLE_ENTITY_SECRET", entitySecret);
  await writeFile(ENV_PATH, envSource, "utf8");
  console.log(`ok Entity secret registered and saved to .env.local`);
  console.log(`ok Recovery file saved to ${RECOVERY_PATH} (back this up somewhere safe)`);
} else if (!/^[0-9a-f]{64}$/.test(entitySecret)) {
  fail("CIRCLE_ENTITY_SECRET in .env.local is not 64 lowercase hex characters.");
} else {
  console.log("ok Entity secret already set, skipping registration");
}

if (!env.get("CIRCLE_WALLET_SET_ID")) {
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  console.log(`> Creating wallet set "${WALLET_SET_NAME}"...`);
  const res = await client.createWalletSet({ name: WALLET_SET_NAME });
  const id = res.data?.walletSet?.id;
  if (!id) fail("Circle returned no wallet set id.");
  envSource = upsert(envSource, "CIRCLE_WALLET_SET_ID", id);
  await writeFile(ENV_PATH, envSource, "utf8");
  console.log(`ok Wallet set created: ${id}`);
} else {
  console.log("ok Wallet set already set, skipping");
}

console.log("Done.");
