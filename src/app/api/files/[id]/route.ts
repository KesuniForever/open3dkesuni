import { fail, type Ctx } from "@/lib/http";
import { readAttachment } from "@/lib/files";

// Download an attachment. Images open inline; design files download.
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const found = await readAttachment(id).catch(() => undefined);
  if (!found) return fail(404, "File not found");
  const { attachment: a, bytes } = found;
  const inline = a.mime.startsWith("image/");
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "content-type": a.mime,
      "content-length": String(bytes.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${a.filename.replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}
