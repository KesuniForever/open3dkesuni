import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BODY_LIMIT_MB, checkOperatorAuth, ENV_VARS, envReport, storagePlan } from "./deploy";

const RAILWAY = { RAILWAY_PROJECT_ID: "p", RAILWAY_ENVIRONMENT_ID: "e", RAILWAY_SERVICE_ID: "s" };
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("storagePlan", () => {
  it("changes nothing on the studio PC", () => {
    const p = storagePlan({}, "/repo");
    expect(p.onRailway).toBe(false);
    expect(p.defaults).toEqual({});
    expect(p.errors).toEqual([]);
    expect(p.dbPath).toBe(path.join("/repo", "data", "local", "kesuni.db"));
    expect(p.filesDir).toBe(path.join("/repo", "data", "local", "files"));
  });

  it("puts the database and the files on the Railway volume when the paths are left empty", () => {
    const p = storagePlan({ ...RAILWAY, RAILWAY_VOLUME_MOUNT_PATH: "/data", KESUNI_DB_PATH: "  " }, "/app");
    expect(p.defaults).toEqual({ KESUNI_DB_PATH: "/data/kesuni.db", KESUNI_FILES_DIR: "/data/files" });
    expect(p).toMatchObject({ dbPath: "/data/kesuni.db", filesDir: "/data/files", volume: "/data", errors: [] });
  });

  it("keeps explicit paths that are on the volume", () => {
    const p = storagePlan({ ...RAILWAY, RAILWAY_VOLUME_MOUNT_PATH: "/data", KESUNI_DB_PATH: "/data/db/k.db", KESUNI_FILES_DIR: "/data/up" }, "/app");
    expect(p.defaults).toEqual({});
    expect(p.errors).toEqual([]);
  });

  it("refuses to start on Railway without a volume", () => {
    const p = storagePlan(RAILWAY, "/app");
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toMatch(/No volume/);
  });

  it("refuses a database or files folder off the volume (container disk, memory, ../ tricks)", () => {
    for (const db of ["/app/data/local/kesuni.db", ":memory:", "data/kesuni.db", "/data/../etc/kesuni.db", "/data"]) {
      const p = storagePlan({ ...RAILWAY, RAILWAY_VOLUME_MOUNT_PATH: "/data", KESUNI_DB_PATH: db }, "/app");
      expect(p.errors.join(" "), db).toMatch(/KESUNI_DB_PATH/);
    }
    const f = storagePlan({ ...RAILWAY, RAILWAY_VOLUME_MOUNT_PATH: "/data", KESUNI_FILES_DIR: "/tmp/files" }, "/app");
    expect(f.errors.join(" ")).toMatch(/KESUNI_FILES_DIR/);
  });

  it("KESUNI_ALLOW_NO_VOLUME=1 lets a throwaway demo start without a volume", () => {
    expect(storagePlan({ ...RAILWAY, KESUNI_ALLOW_NO_VOLUME: "1" }, "/app").errors).toEqual([]);
  });
});

describe("envReport", () => {
  it("names missing required variables and never repeats a value", () => {
    const r = envReport({ OPERATOR_PASSWORD: "s3cret-value", CIRCLE_API_KEY: "TEST_API_KEY:abc" });
    expect(r.problems.some((p) => p.startsWith("PRINTER_BRIDGE_TOKEN is missing"))).toBe(true);
    expect(r.problems.some((p) => p.startsWith("OPERATOR_PASSWORD"))).toBe(false);
    expect(JSON.stringify(r)).not.toContain("s3cret-value");
    expect(JSON.stringify(r)).not.toContain("TEST_API_KEY:abc");
  });

  it("warns about the mainnet switch and printer-bridge settings on the server", () => {
    const r = envReport({ KESUNI_ALLOW_MAINNET: "1", PRINTER_2_ACCESS_CODE: "x", APP_URL: "http://localhost:3000" });
    expect(r.warnings.some((w) => w.startsWith("KESUNI_ALLOW_MAINNET is set"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("APP_URL, PRINTER_2_ACCESS_CODE"))).toBe(true);
  });

  it("points out pasted secrets the app never reads (names only)", () => {
    const r = envReport({ ARC_PRIVATE_KEY: "0xdead", CIRCLE_API_KEY: "k", RAILWAY_PRIVATE_DOMAIN: "x.railway.internal", PATH: "/bin" });
    expect(r.warnings).toContain("Secrets the app does not use, better removed from the server: ARC_PRIVATE_KEY");
    expect(JSON.stringify(r)).not.toContain("0xdead");
  });

  it("does not flag the variables `next start` sets for itself", () => {
    const r = envReport({ NEXT_PRIVATE_START_TIME: "1", __NEXT_PRIVATE_ORIGIN: "http://localhost:3000", NEXT_PUBLIC_API_KEY: "x" });
    expect(r.warnings).toContain("Secrets the app does not use, better removed from the server: NEXT_PUBLIC_API_KEY");
  });

  it("lists every variable the app reads (so the Railway guide stays complete)", () => {
    const names = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.|test-helper/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
          for (const m of src.matchAll(/\b(?:num|positive|env)\("([A-Z][A-Z0-9_]+)"/g)) names.add(m[1]);
        }
      }
    };
    walk(path.join(import.meta.dirname, ".."));
    expect(names.size).toBeGreaterThan(25);
    expect(names).toContain("KESUNI_DB_PATH");
    const known = new Set([...ENV_VARS.map((v) => v.name), "NEXT_RUNTIME", "VITEST", "NODE_ENV"]);
    const unknown = [...names].filter((n) => !known.has(n) && !n.startsWith("RAILWAY_"));
    expect(unknown).toEqual([]);
  });
});

describe("BODY_LIMIT_MB", () => {
  it("matches proxyClientMaxBodySize in next.config.ts (the import script sizes its uploads by it)", () => {
    const config = readFileSync(path.join(import.meta.dirname, "..", "..", "next.config.ts"), "utf8");
    expect(config).toContain(`proxyClientMaxBodySize: "${BODY_LIMIT_MB}mb"`);
  });
});

describe("checkOperatorAuth", () => {
  it("stays closed while the server has no OPERATOR_PASSWORD", () => {
    expect(checkOperatorAuth(basic("x", ""), undefined)).toMatchObject({ ok: false, status: 403 });
    expect(checkOperatorAuth(basic("x", ""), "")).toMatchObject({ ok: false, status: 403 });
  });

  it("needs Basic auth with the exact password (any user name, colons allowed in the password)", () => {
    expect(checkOperatorAuth(null, "pw")).toMatchObject({ ok: false, status: 401 });
    expect(checkOperatorAuth("Bearer pw", "pw")).toMatchObject({ ok: false, status: 401 });
    expect(checkOperatorAuth(basic("op", "PW"), "pw")).toMatchObject({ ok: false, status: 401 });
    expect(checkOperatorAuth(basic("op", "pw "), "pw")).toMatchObject({ ok: false, status: 401 });
    expect(checkOperatorAuth(basic("op", "pw"), "pw")).toEqual({ ok: true });
    expect(checkOperatorAuth(basic("", "a:b:c"), "a:b:c")).toEqual({ ok: true });
    expect(checkOperatorAuth(`Basic ${Buffer.from("pw").toString("base64")}`, "pw")).toMatchObject({ ok: false, status: 401 });
  });

  it("reads the password as UTF-8, like browsers send it", () => {
    expect(checkOperatorAuth(basic("op", "pässwort"), "pässwort")).toEqual({ ok: true });
  });
});
