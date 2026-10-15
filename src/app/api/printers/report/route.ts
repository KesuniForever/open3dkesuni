import { NextResponse } from "next/server";
import { fail, failWith, readJson, str } from "@/lib/http";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { ingestReport } from "@/lib/printer/actions";
import { readEvents, readSnapshot } from "@/lib/printer/report-input";

// Called by scripts/printer-bridge.mjs on the shop's LAN. Needs PRINTER_BRIDGE_TOKEN.
// It can only add printer evidence and tasks; it can never accept an order or move money.
export async function POST(req: Request) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const b = await readJson(req);
  const snapshot = readSnapshot(b?.snapshot);
  const events = readEvents(b?.events ?? []);
  if (!b || !snapshot || !events) return fail(400, "Expected { printerId, snapshot, events[] }");
  const r = ingestReport(str(b.printerId), snapshot, events);
  if (!r.ok) return failWith(r);
  return NextResponse.json({ printer: r.printer, applied: r.applied });
}
