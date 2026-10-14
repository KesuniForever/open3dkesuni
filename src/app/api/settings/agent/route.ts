import { NextResponse } from "next/server";
import { agentSettings, setAgentProfile } from "@/lib/agent/chief";
import { fail, readJson } from "@/lib/http";

// The Chief's model profile: "test" (Sonnet 5.5) or "demo" (Opus 5.5). Operator only (see proxy.ts).
export async function GET() {
  return NextResponse.json(agentSettings());
}

export async function POST(req: Request) {
  const b = await readJson(req);
  const r = setAgentProfile(b?.profile);
  if (!r.ok) return fail(r.status, r.error);
  return NextResponse.json(agentSettings());
}
