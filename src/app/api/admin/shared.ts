// Shared by the admin routes (deploy check and the one-time import). Not a route itself.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { BODY_LIMIT_MB, checkOperatorAuth } from "@/lib/deploy";

/** The operator password, always (also from the home network, unlike src/proxy.ts). Returns the refusal, or null. */
export function refuse(req: Request): NextResponse | null {
  const r = checkOperatorAuth(req.headers.get("authorization"), process.env.OPERATOR_PASSWORD);
  if (r.ok) return null;
  const headers: Record<string, string> = r.status === 401 ? { "www-authenticate": 'Basic realm="Kesuni operator", charset="UTF-8"' } : {};
  return NextResponse.json({ error: r.error }, { status: r.status, headers });
}

export type Upload = { ok: true; bytes: Buffer } | { ok: false; status: number; error: string };

/**
 * The body sent by scripts/railway-import-db.mjs: gzip (x-kesuni-gzip: 1), with the original size and SHA-256 in
 * headers. Next.js cuts request bodies over BODY_LIMIT_MB (proxyClientMaxBodySize) without failing the request,
 * so the size + hash check is what proves the file arrived whole.
 */
export async function readUpload(req: Request, maxBytes: number): Promise<Upload> {
  const sha = (req.headers.get("x-kesuni-sha256") ?? "").toLowerCase();
  const size = Number(req.headers.get("x-kesuni-bytes"));
  if (!/^[0-9a-f]{64}$/.test(sha) || !Number.isInteger(size) || size <= 0) {
    return { ok: false, status: 400, error: "Send x-kesuni-sha256 and x-kesuni-bytes (use scripts/railway-import-db.mjs)" };
  }
  if (size > maxBytes) return { ok: false, status: 413, error: `Larger than ${Math.round(maxBytes / 1024 / 1024)} MB` };
  let bytes = Buffer.from(await req.arrayBuffer());
  if (req.headers.get("x-kesuni-gzip") === "1") {
    try {
      bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
    } catch {
      return { ok: false, status: 400, error: `The upload is cut off or not gzip (request bodies over ${BODY_LIMIT_MB} MB are cut)` };
    }
  }
  if (bytes.byteLength !== size || createHash("sha256").update(bytes).digest("hex") !== sha) {
    return { ok: false, status: 400, error: "The upload arrived incomplete or changed (size or SHA-256 does not match)" };
  }
  return { ok: true, bytes };
}
