import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fail, loadOrder, readJson, type Ctx } from "@/lib/http";
import type { Evidence, Label } from "@/lib/types";

const KINDS = ["log", "photo", "qc"] as const;
const LABELS: Label[] = ["simulated", "manual", "local", "testnet", "mainnet"];

export async function POST(req: Request, ctx: Ctx) {
  const order = await loadOrder(ctx);
  if (!order) return fail(404, "Order not found");
  if (order.status === "CREATED") return fail(409, "Choose a plan before submitting evidence");
  const b = await readJson(req);
  if (!b || !KINDS.includes(b.kind as never) || typeof b.note !== "string" || !LABELS.includes(b.label as Label)) {
    return fail(400, "Expected { kind: 'log'|'photo'|'qc', note, label }");
  }
  const ev: Evidence = {
    id: `E-${db.evidence.length + 1}`, orderId: order.id, kind: b.kind as Evidence["kind"],
    note: b.note, label: b.label as Label, at: new Date().toISOString(),
  };
  db.evidence.push(ev);
  if (order.status === "PLAN_CHOSEN") order.status = "IN_PRODUCTION";
  if (ev.kind === "qc") order.status = "EVIDENCE_SUBMITTED";
  return NextResponse.json({ evidence: ev }, { status: 201 });
}
