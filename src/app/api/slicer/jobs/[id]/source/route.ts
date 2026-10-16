import { fail, failWith, type Ctx } from "@/lib/http";
import { fileStore } from "@/lib/files";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { md5, sliceJobSource } from "@/lib/slicing";

// GET (bearer PRINTER_BRIDGE_TOKEN): the model to slice, for the studio PC. Only while the slice is taken ("slicing").
// x-file-md5 lets the bridge check its download.
export async function GET(req: Request, ctx: Ctx) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const r = sliceJobSource(id);
  if (!r.ok) return failWith(r);
  const bytes = await fileStore().get(r.attachment.storageKey).catch(() => undefined);
  if (!bytes) return fail(404, "File not found");
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-file-md5": md5(bytes),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
