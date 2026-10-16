// Hosting rules for Railway: one long-running Node server (`next start`) with the SQLite database and the uploaded
// files on a persistent volume. Pure functions over an env object, shared by the start script and the admin routes.
// scripts/railway-start.mjs loads this file with Node's own type stripping, so keep it plain TypeScript
// (no enums, namespaces or parameter properties) that imports node: modules only.
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

export type Env = Record<string, string | undefined>;

const DB_FILE = "kesuni.db";
const FILES_DIR = "files";

/** Next.js cuts request bodies above this (experimental.proxyClientMaxBodySize in next.config.ts; a test keeps both equal). */
export const BODY_LIMIT_MB = 60;

/** Railway sets these on every deployment. */
export const onRailway = (env: Env): boolean =>
  Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);

const filled = (v: string | undefined): string => (v ?? "").trim();
const onVolume = (volume: string, p: string): boolean => {
  if (!path.posix.isAbsolute(p)) return false;
  const rel = path.posix.relative(volume, p);
  return rel !== "" && !rel.startsWith("..") && !path.posix.isAbsolute(rel);
};

export interface StoragePlan {
  onRailway: boolean;
  /** RAILWAY_VOLUME_MOUNT_PATH, set by Railway only when a volume is attached. */
  volume: string | null;
  dbPath: string;
  filesDir: string;
  /** Paths the start script fills in because they were left empty: on the volume. */
  defaults: Record<string, string>;
  /** Reasons not to start: the data would sit on a disk that every deploy wipes. */
  errors: string[];
}

/**
 * Where the database and the uploaded files live. Locally nothing changes (data/local/...). On Railway an empty
 * KESUNI_DB_PATH / KESUNI_FILES_DIR defaults to the volume, and a path off the volume refuses to start, so real orders
 * can never land on the container's throwaway disk. KESUNI_ALLOW_NO_VOLUME=1 overrides that (demo copies only).
 */
export function storagePlan(env: Env, cwd: string): StoragePlan {
  const railway = onRailway(env);
  const volume = filled(env.RAILWAY_VOLUME_MOUNT_PATH) || null;
  const defaults: Record<string, string> = {};
  if (volume && !filled(env.KESUNI_DB_PATH)) defaults.KESUNI_DB_PATH = path.posix.join(volume, DB_FILE);
  if (volume && !filled(env.KESUNI_FILES_DIR)) defaults.KESUNI_FILES_DIR = path.posix.join(volume, FILES_DIR);
  const dbPath = filled(env.KESUNI_DB_PATH) || defaults.KESUNI_DB_PATH || path.join(cwd, "data", "local", DB_FILE);
  const filesDir = filled(env.KESUNI_FILES_DIR) || defaults.KESUNI_FILES_DIR || path.join(cwd, "data", "local", FILES_DIR);

  const errors: string[] = [];
  if (railway && env.KESUNI_ALLOW_NO_VOLUME !== "1") {
    if (!volume) {
      errors.push("No volume is attached to this Railway service. Add one (mount path /data) so orders survive a redeploy.");
    } else {
      if (!onVolume(volume, dbPath)) errors.push(`KESUNI_DB_PATH (${dbPath}) is not on the volume ${volume}. Delete the variable or point it inside ${volume}.`);
      if (!onVolume(volume, filesDir)) errors.push(`KESUNI_FILES_DIR (${filesDir}) is not on the volume ${volume}. Delete the variable or point it inside ${volume}.`);
    }
  }
  return { onRailway: railway, volume, dbPath, filesDir, defaults, errors };
}

// ---------- environment variables (names only; values are never read out) ----------

export type Need = "required" | "recommended" | "optional" | "bridge-only" | "keep-unset";
export interface EnvVar { name: string; need: Need; what: string }

/** Every variable the app reads (grep process.env in src/). Bridge-only ones belong on the studio PC, not the server. */
export const ENV_VARS: EnvVar[] = [
  { name: "OPERATOR_PASSWORD", need: "required", what: "Password for operator pages on the public link (Basic auth)" },
  { name: "PRINTER_BRIDGE_TOKEN", need: "required", what: "Shared secret the studio PC's printer bridge sends" },
  { name: "CUSTOMER_INVITE_CODE", need: "required", what: "Code in the customer order link /request/<code>" },
  { name: "CIRCLE_API_KEY", need: "required", what: "Circle API key (TEST_API_KEY on Arc Testnet)" },
  { name: "CIRCLE_ENTITY_SECRET", need: "required", what: "Circle entity secret" },
  { name: "CIRCLE_WALLET_SET_ID", need: "required", what: "Circle wallet set" },
  { name: "KESUNI_PAYOUT_ADDRESS", need: "required", what: "Kesuni's payout wallet address" },
  { name: "ANTHROPIC_API_KEY", need: "recommended", what: "The Chief on Claude (costs money); without it the rules fallback runs" },
  { name: "KESUNI_DEMO_FUNDS_ADDRESS", need: "recommended", what: "Demo-funds wallet for test USDC top-ups (testnet only)" },
  { name: "CIRCLE_BLOCKCHAIN", need: "optional", what: "Default ARC-TESTNET" },
  { name: "KESUNI_HEARTBEAT_SECONDS", need: "optional", what: "Chief heartbeat interval; default 120, 0 = off" },
  { name: "KESUNI_DAILY_REVIEW_HOUR", need: "optional", what: "Jakarta hour for the daily review; default 21, off = never" },
  { name: "KESUNI_AGENT_MODE", need: "optional", what: "claude or rules" },
  { name: "KESUNI_AGENT_MODEL", need: "optional", what: "Claude model id" },
  { name: "KESUNI_MAX_WAKES_PER_HOUR", need: "optional", what: "Cap on Chief runs per hour" },
  { name: "KESUNI_AUTO_PRINT", need: "optional", what: "off = the agent never starts or slices a print, whatever the switch on the Chief page says" },
  { name: "IDR_PER_USDC", need: "optional", what: "Rupiah per USDC; default 16500" },
  { name: "KESUNI_PRICE_PER_GRAM_IDR", need: "optional", what: "Price per gram" },
  { name: "KESUNI_COST_PER_GRAM_IDR", need: "optional", what: "Cost per gram" },
  { name: "KESUNI_PRICE_PER_GRAM_IDR_PETG", need: "optional", what: "PETG price per gram; default the PLA price" },
  { name: "KESUNI_COST_PER_GRAM_IDR_PETG", need: "optional", what: "PETG cost per gram; default the PLA cost" },
  { name: "KESUNI_PRICE_ROUND_IDR", need: "optional", what: "Price rounding step" },
  { name: "KESUNI_PRINT_MIN_PER_GRAM_SINGLE", need: "optional", what: "Print minutes per gram, single colour; default 3-5" },
  { name: "KESUNI_PRINT_MIN_PER_GRAM_MULTI", need: "optional", what: "Print minutes per gram, multi colour; default 5-15" },
  { name: "KESUNI_HANDLING_HOURS", need: "optional", what: "Hours to collect, check and pack after printing; default 1" },
  { name: "KESUNI_PRINTER_COUNT", need: "optional", what: "Printers that print units side by side; default 3" },
  { name: "KESUNI_MIN_ORDER_IDR", need: "optional", what: "Owner rule: minimum order" },
  { name: "KESUNI_PARTNER_MIN_IDR", need: "optional", what: "Owner rule: minimum for a partner job" },
  { name: "KESUNI_OWNER_APPROVAL_ABOVE_IDR", need: "optional", what: "Owner rule: approval above this amount" },
  { name: "KESUNI_MIN_MARGIN_PCT", need: "optional", what: "Owner rule: minimum margin" },
  { name: "KESUNI_PARTNER_MARGIN_PCT", need: "optional", what: "Owner rule: partner margin" },
  { name: "KESUNI_EXPLORER_TX_URL", need: "optional", what: "Explorer link override" },
  { name: "KESUNI_USDC_ADDRESS", need: "optional", what: "USDC contract override" },
  { name: "KESUNI_ARC_RPC_URL", need: "optional", what: "Arc RPC for the read-only receipt check" },
  { name: "KESUNI_ARC_CHAIN_ID", need: "optional", what: "Arc chain id for that check" },
  { name: "PORT", need: "optional", what: "Port Next.js listens on (Railway sets it; set 3000 so the domain matches)" },
  { name: "KESUNI_DB_PATH", need: "optional", what: "Database file; on Railway defaults to <volume>/kesuni.db" },
  { name: "KESUNI_FILES_DIR", need: "optional", what: "Uploaded files; on Railway defaults to <volume>/files" },
  { name: "KESUNI_ALLOW_MAINNET", need: "keep-unset", what: "Unlocks real money; needs the owner's and Sabina's approval" },
  { name: "KESUNI_ALLOW_NO_VOLUME", need: "keep-unset", what: "Starts without a volume: data is lost on every deploy" },
  { name: "APP_URL", need: "bridge-only", what: "Printer bridge target (studio PC)" },
  { name: "PRINTER_IP", need: "bridge-only", what: "Printer LAN address (studio PC)" },
  { name: "PRINTER_SERIAL", need: "bridge-only", what: "Printer serial (studio PC)" },
  { name: "PRINTER_ACCESS_CODE", need: "bridge-only", what: "Printer access code (studio PC)" },
];

/** Variables the app used to read and no longer does: a leftover value is silently ignored, so the check says so. */
export const RETIRED_ENV_VARS: { name: string; why: string }[] = [
  { name: "KESUNI_GRAMS_PER_HOUR", why: "print time now comes from KESUNI_PRINT_MIN_PER_GRAM_SINGLE and _MULTI" },
];

export interface EnvLine extends EnvVar { set: boolean }
export interface EnvReport { lines: EnvLine[]; problems: string[]; warnings: string[] }

export function envReport(env: Env): EnvReport {
  const lines = ENV_VARS.map((v) => ({ ...v, set: filled(env[v.name]) !== "" }));
  const problems = lines.filter((l) => l.need === "required" && !l.set).map((l) => `${l.name} is missing: ${l.what}`);
  const warnings: string[] = [];
  for (const l of lines) {
    if (l.need === "keep-unset" && l.set) warnings.push(`${l.name} is set: ${l.what}`);
    if (l.need === "recommended" && !l.set) warnings.push(`${l.name} is not set: ${l.what}`);
  }
  for (const r of RETIRED_ENV_VARS) {
    if (filled(env[r.name]) !== "") warnings.push(`${r.name} is retired and no longer read (${r.why}): delete it`);
  }
  const bridgeOnly = Object.keys(env).filter((k) => /^PRINTER(_\d+)?_(IP|SERIAL|ACCESS_CODE)$/.test(k) || k === "APP_URL");
  if (bridgeOnly.length) warnings.push(`Not needed on the server (printer bridge only), better removed: ${bridgeOnly.sort().join(", ")}`);
  // A pasted .env.local can carry secrets the app never reads (e.g. a wallet key): they should not sit on the server.
  // `next start` sets its own NEXT_PRIVATE_* / __NEXT_* variables (not Railway variables, nothing to remove).
  const known = new Set(ENV_VARS.map((v) => v.name));
  const unused = Object.keys(env).filter((k) =>
    !known.has(k) && !bridgeOnly.includes(k) && !k.startsWith("RAILWAY_") && !/^(__NEXT_|NEXT_PRIVATE_)/.test(k) &&
    /KEY|SECRET|TOKEN|PRIVATE|PASSWORD|MNEMONIC|SEED/i.test(k));
  if (unused.length) warnings.push(`Secrets the app does not use, better removed from the server: ${unused.sort().join(", ")}`);
  return { lines, problems, warnings };
}

// ---------- operator password (Basic auth) for the admin routes ----------

export type AuthCheck = { ok: true } | { ok: false; status: 401 | 403; error: string };

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * The admin routes check the operator password themselves, on top of src/proxy.ts (which lets the home network in
 * without one). No OPERATOR_PASSWORD on the server = the admin routes stay closed.
 */
export function checkOperatorAuth(authorization: string | null | undefined, password: string | undefined): AuthCheck {
  if (!password) return { ok: false, status: 403, error: "Admin routes are closed: set OPERATOR_PASSWORD on the server first" };
  const h = authorization ?? "";
  if (!h.startsWith("Basic ")) return { ok: false, status: 401, error: "Operator login required" };
  const decoded = Buffer.from(h.slice(6).trim(), "base64").toString("utf8");
  const given = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : "";
  return timingSafeEqual(digest(given), digest(password)) ? { ok: true } : { ok: false, status: 401, error: "Wrong operator password" };
}
