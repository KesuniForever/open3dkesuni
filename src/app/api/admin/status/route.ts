// Deploy check for the operator (open it in the browser after a deploy): where the data lives, which variables are
// set (names only, never values), whether the one-time import is still possible, and the Chief's heartbeat.
import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { heartbeatStatus } from "@/lib/agent/heartbeat";
import { envReport, storagePlan } from "@/lib/deploy";
import { importBlockers, serverInfo } from "@/lib/deploy-import";
import { refuse } from "../shared";

export async function GET(req: Request) {
  const no = refuse(req);
  if (no) return no;
  const plan = storagePlan(process.env, process.cwd());
  const env = envReport(process.env);
  const orders = store.listOrders();
  let blockers: string[] | null = null;
  try {
    if (plan.dbPath !== ":memory:") blockers = importBlockers(serverInfo(plan.dbPath));
  } catch {
    blockers = null;
  }
  const hb = heartbeatStatus();
  return NextResponse.json({
    ok: plan.errors.length === 0 && env.problems.length === 0,
    node: process.version,
    railway: plan.onRailway,
    storage: { volume: plan.volume, dbPath: plan.dbPath, filesDir: plan.filesDir, problems: plan.errors },
    env: {
      problems: env.problems,
      warnings: env.warnings,
      set: env.lines.filter((l) => l.set).map((l) => l.name),
      missing: env.lines.filter((l) => !l.set && (l.need === "required" || l.need === "recommended")).map((l) => l.name),
    },
    data: {
      realOrders: orders.filter((o) => o.label !== "simulated").length,
      simulatedOrders: orders.filter((o) => o.label === "simulated").length,
      importAllowed: blockers ? blockers.length === 0 : null,
    },
    heartbeat: {
      enabled: hb.enabled, intervalSeconds: hb.intervalSeconds, schedulerRunning: hb.schedulerRunning,
      lastBeat: hb.last?.at ?? null, mode: hb.mode,
    },
  });
}
