import { NextResponse } from "next/server";
import { heartbeatStatus, runHeartbeat } from "@/lib/agent/heartbeat";
import { fail } from "@/lib/http";

// The Chief's heartbeat: last run, interval and next run. POST runs one beat now. Operator only (see proxy.ts).
export async function GET() {
  return NextResponse.json(heartbeatStatus());
}

export async function POST() {
  const r = await runHeartbeat({ trigger: "button" });
  if (!r.ok) return fail(409, r.error);
  return NextResponse.json(heartbeatStatus());
}
