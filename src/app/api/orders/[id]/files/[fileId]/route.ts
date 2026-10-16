import { NextResponse } from "next/server";
import { fail, failWith, readJson } from "@/lib/http";
import { removeAttachment } from "@/lib/files";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

// DELETE { by }: a PERSON removes one file from the order (metadata, bytes, and a QC photo's photo evidence). Refused (409)
// with reasons while a print job uses the file, or for a QC photo once evidence is submitted. Operator only (src/proxy.ts:
// same-site writes, OPERATOR_PASSWORD on the public link); customers and the Chief have no way to remove a file.
export async function DELETE(req: Request, ctx: Ctx) {
  const { id, fileId } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { by }");
  const r = await removeAttachment(id, fileId, b.by);
  if (!r.ok) return failWith(r);
  // bytesRemoved false: the file is off the order, but its stored copy could not be deleted (the log names it).
  return NextResponse.json({ attachment: r.attachment, evidenceRemoved: r.evidenceRemoved, bytesRemoved: r.bytesRemoved });
}
