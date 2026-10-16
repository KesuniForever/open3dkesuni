// Request bodies with a hard size limit, for the customer routes open to the internet (/api/c and /api/c/<token>).
// Those routes are left out of the proxy (src/proxy.ts matcher): Next.js would otherwise buffer every body in memory,
// up to 60 MB, before the route could refuse it. Here nothing past the limit is ever read, whatever size the request
// claims (a body without Content-Length is counted as it arrives).

/** The body's bytes, or "too-large" as soon as more than `max` bytes are declared or arrive (the rest is never read). */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | "too-large"> {
  const declared = Number(req.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) return "too-large";
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return "too-large";
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The request's media type, lower case, without parameters ("multipart/form-data"). */
export const mediaType = (req: Request): string => (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

/**
 * A JSON object body of at most `max` bytes: null when it is not application/json (a form on another site cannot send
 * that without a CORS check) or not an object, "too-large" past the limit.
 */
export async function readJsonCapped(req: Request, max: number): Promise<Record<string, unknown> | null | "too-large"> {
  if (mediaType(req) !== "application/json") return null;
  const bytes = await readCapped(req, max);
  if (bytes === "too-large") return bytes;
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
