import { fail, failWith, type Ctx } from "@/lib/http";
import { fileStore } from "@/lib/files";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { fileMd5, jobFile } from "@/lib/printer/jobs";

// GET (bearer PRINTER_BRIDGE_TOKEN): the sliced 3MF of a print job, for the LAN bridge to upload to the printer's SD
// card. Only while the job is queued or uploading. x-file-md5 lets the bridge check its download.
export async function GET(req: Request, ctx: Ctx) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const r = jobFile(id);
  if (!r.ok) return failWith(r);
  const bytes = await fileStore().get(r.attachment.storageKey).catch(() => undefined);
  if (!bytes) return fail(404, "File not found");
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "content-type": "model/3mf",
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${r.job.fileName}"`,
      "x-file-md5": fileMd5(bytes),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
