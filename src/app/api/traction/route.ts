import { NextResponse } from "next/server";
import { traction } from "@/lib/traction";

// Real usage for the submission (src/lib/traction.ts): real customers, real orders by status and the real Arc
// transfers (deposit, release, refund of real orders, COMPLETE with a tx hash) with explorer links and Arc checks.
// No customer names. Read-only. Operator only like every route outside proxy.ts OPEN (local requests skip the password).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(traction());
}
