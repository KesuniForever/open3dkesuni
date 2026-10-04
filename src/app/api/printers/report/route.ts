import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { fail, failWith, readJson, str } from "@/lib/http";
import { ingestReport } from "@/lib/printer/actions";
import type { PrinterEvent, PrinterEventKind, PrinterSnapshot, PrinterState } from "@/lib/printer/bambu";

// Called by scripts/printer-bridge.ts on the shop's LAN. Needs PRINTER_BRIDGE_TOKEN.
// It can only add printer evidence and tasks; it can never accept an order or move money.
const STATES: PrinterState[] = ["IDLE", "PREPARE", "SLICING", "RUNNING", "PAUSE", "FINISH", "FAILED", "UNKNOWN"];
const KINDS: PrinterEventKind[] = ["started", "progress", "needs_operator", "resumed", "finished", "failed"];
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function authorized(req: Request): boolean {
  const token = process.env.PRINTER_BRIDGE_TOKEN;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!token || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

function readSnapshot(v: unknown): PrinterSnapshot | null {
  const s = v as Record<string, unknown> | null;
  if (!s || !STATES.includes(s.state as PrinterState) || n(s.percent) === null || typeof s.at !== "string") return null;
  return {
    state: s.state as PrinterState, percent: Math.max(0, Math.min(100, n(s.percent)!)),
    remainingMin: n(s.remainingMin), layer: n(s.layer), totalLayers: n(s.totalLayers),
    jobName: typeof s.jobName === "string" ? s.jobName.slice(0, 120) : null,
    errorCode: n(s.errorCode) ?? 0, nozzleTemp: n(s.nozzleTemp), bedTemp: n(s.bedTemp), at: s.at,
  };
}

function readEvents(v: unknown): PrinterEvent[] | null {
  if (!Array.isArray(v) || v.length > 20) return null;
  const out: PrinterEvent[] = [];
  for (const raw of v) {
    const e = raw as Record<string, unknown>;
    if (!KINDS.includes(e?.kind as PrinterEventKind) || n(e.percent) === null || typeof e.at !== "string") return null;
    out.push({ kind: e.kind as PrinterEventKind, percent: n(e.percent)!, at: e.at,
      jobName: typeof e.jobName === "string" ? e.jobName.slice(0, 120) : null, errorCode: n(e.errorCode) ?? undefined });
  }
  return out;
}

export async function POST(req: Request) {
  if (!process.env.PRINTER_BRIDGE_TOKEN) return fail(503, "PRINTER_BRIDGE_TOKEN is not set on the server");
  if (!authorized(req)) return fail(401, "Bad bridge token");
  const b = await readJson(req);
  const snapshot = readSnapshot(b?.snapshot);
  const events = readEvents(b?.events ?? []);
  if (!b || !snapshot || !events) return fail(400, "Expected { printerId, snapshot, events[] }");
  const r = ingestReport(str(b.printerId), snapshot, events);
  if (!r.ok) return failWith(r);
  return NextResponse.json({ printer: r.printer, applied: r.applied });
}
