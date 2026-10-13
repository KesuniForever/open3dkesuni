import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, failWith, type Ctx } from "@/lib/http";
import { addAttachment, MAX_BYTES } from "@/lib/files";

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!store.getOrder(id)) return fail(404, "Order not found");
  return NextResponse.json({ attachments: store.listAttachments(id) });
}

// multipart/form-data: file, kind ("design" | "reference" | "qc_photo"), by
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 1024 * 1024) return fail(413, "File is too large");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Expected multipart form data with a file");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Expected a file field");
  const r = await addAttachment(id, {
    kind: String(form.get("kind") ?? ""), filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()), uploadedBy: String(form.get("by") ?? ""),
  });
  if (!r.ok) return failWith(r);
  return NextResponse.json({ attachment: r.attachment, evidence: r.evidence ?? null }, { status: 201 });
}
