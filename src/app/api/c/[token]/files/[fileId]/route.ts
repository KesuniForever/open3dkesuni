import { orderForToken } from "@/lib/customer";
import { readAttachment } from "@/lib/files";
import { fail } from "@/lib/http";

type Ctx = { params: Promise<{ token: string; fileId: string }> };

// A photo of the customer's own order (QC or reference). Design files stay with the operator: the customer's own
// design comes back only through /api/c/<token>/design (for the 3D view on their order page).
export async function GET(_req: Request, ctx: Ctx) {
  const { token, fileId } = await ctx.params;
  const order = orderForToken(token);
  const found = order ? await readAttachment(fileId).catch(() => undefined) : undefined;
  if (!order || !found || found.attachment.orderId !== order.id || found.attachment.kind === "design") {
    return fail(404, "File not found");
  }
  const { attachment: a, bytes } = found;
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "content-type": a.mime, "content-length": String(bytes.byteLength),
      "content-disposition": "inline", "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600",
    },
  });
}
