import { NextResponse } from "next/server";
import { fail, failWith, type Ctx } from "@/lib/http";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { md5, refuseSliceResult, storeSliceResult } from "@/lib/slicing";
import { MAX_SLICE_BYTES } from "@/lib/slice-rules";
import { safeDispatch } from "@/lib/printer/dispatch";

// POST the sliced .gcode.3mf as the body (model/3mf or application/octet-stream, at most 50 MB), header x-file-md5,
// optional x-slice-ms (bearer PRINTER_BRIDGE_TOKEN): the studio PC's result. Only while the slice is "slicing". The app
// reads it again (sliced, A1, 0.4 mm, textured plate, one filament of the asked material and colour) and stores it as
// a design file on the order (uploadedBy "Bambu Studio (slicer)"); a file that does not match fails the slice (422).
export async function POST(req: Request, ctx: Ctx) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "model/3mf" && type !== "application/octet-stream") return fail(415, "Expected model/3mf");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_SLICE_BYTES) {
    refuseSliceResult(id, "The sliced file is larger than 50 MB"); // fails the slice now, not after the expiry
    return fail(413, "The sliced file is larger than 50 MB");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  const sent = (req.headers.get("x-file-md5") ?? "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(sent) || sent !== md5(bytes)) return fail(400, "The sliced file changed on the way (checksum mismatch)");
  const r = await storeSliceResult(id, bytes, { sliceMs: Number(req.headers.get("x-slice-ms") ?? Number.NaN) });
  if (!r.ok) return failWith(r);
  // A sliced file may be what an order waited for: the agent dispatcher runs (only acts when agent prints are on).
  safeDispatch("slice_done");
  return NextResponse.json({ job: r.job, attachment: r.attachment }, { status: 201 });
}
