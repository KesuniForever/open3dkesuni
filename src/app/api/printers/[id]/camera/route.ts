import { NextResponse } from "next/server";
import { fail, failWith, type Ctx } from "@/lib/http";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { cameraFrame, MAX_FRAME_BYTES, saveCameraFrame } from "@/lib/printer/jobs";

// POST image/jpeg body, at most 2 MB (bearer PRINTER_BRIDGE_TOKEN): the LAN bridge sends the printer's latest camera
// frame. Kept in memory, the latest one per printer. Open in src/proxy.ts for POST only: the bearer is checked here.
export async function POST(req: Request, ctx: Ctx) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "image/jpeg") return fail(415, "Expected image/jpeg");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FRAME_BYTES) return fail(413, "Camera frame is larger than 2 MB");
  const bytes = new Uint8Array(await req.arrayBuffer());
  const r = saveCameraFrame(id, bytes);
  if (!r.ok) return failWith(r);
  return NextResponse.json({ at: r.at, size: r.size }, { status: 201 });
}

// GET: the latest frame (operator only; frames show the studio). x-frame-at says when the bridge took it.
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const f = cameraFrame(id);
  if (!f) return fail(404, "No camera frame yet");
  return new Response(new Blob([f.jpeg as BlobPart]), {
    headers: { "content-type": "image/jpeg", "content-length": String(f.jpeg.byteLength), "x-frame-at": f.at, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
