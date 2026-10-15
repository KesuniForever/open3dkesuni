import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, readJson } from "@/lib/http";
import { createPrintJob, expireStale } from "@/lib/printer/jobs";

// POST { orderId?, printerId, attachmentId, plate, amsMapping, options?, by, bedEmptyConfirmed: true, personPresent: true,
// warningsChecked?, urlForm? ("sdcard" default | "ftp") }: a PERSON starts a real print of a sliced .gcode.3mf. Refused
// (409) with reasons, plus warnings and the colour match, when anything is not right. Operator only (src/proxy.ts asks
// for the operator password from any device but this computer); never the Chief.
export async function POST(req: Request) {
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { printerId, attachmentId, plate, amsMapping, by, bedEmptyConfirmed, personPresent }");
  const r = createPrintJob({
    orderId: b.orderId, printerId: b.printerId, attachmentId: b.attachmentId, plate: b.plate, amsMapping: b.amsMapping,
    options: b.options, by: b.by, bedEmptyConfirmed: b.bedEmptyConfirmed, personPresent: b.personPresent, warningsChecked: b.warningsChecked,
    urlForm: b.urlForm,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error, reasons: r.reasons, warnings: r.warnings ?? [], match: r.match ?? null }, { status: r.status });
  }
  return NextResponse.json({ job: r.job, warnings: r.warnings, match: r.match }, { status: 201 });
}

// GET ?orderId=ORD-012 (or ?printerId=a1): print jobs, newest first.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  expireStale();
  const orderId = q.get("orderId") ?? undefined;
  const printerId = q.get("printerId") ?? undefined;
  return NextResponse.json({ jobs: store.listPrintJobs(orderId ? { orderId } : printerId ? { printerId } : {}).reverse() });
}
