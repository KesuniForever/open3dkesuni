import { NextResponse } from "next/server";
import type { ApiError } from "./types";
import type { Fail } from "./actions";
import { onRailway } from "./deploy";

export const fail = (status: number, error: string, reasons?: string[]) =>
  NextResponse.json({ error, reasons } satisfies ApiError, { status });

export const failWith = (r: Fail) => fail(r.status, r.error, r.reasons);

export type Ctx = { params: Promise<{ id: string }> };

/**
 * The JSON body, or null. Only bodies sent as application/json count: a plain HTML form on another site can post
 * text/plain without a CORS check, but never application/json (second layer behind the proxy's same-site check).
 */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return null;
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The caller's network address, for rate limits: taken from a header the hosting edge writes, never one the caller
 * can pick. Railway's edge overwrites X-Real-IP but passes CF-Connecting-IP through untouched, so there that header
 * is ignored. Off Railway the public way in is the Cloudflare tunnel, which sets CF-Connecting-IP itself.
 */
export function clientIp(req: Request, railway = onRailway(process.env)): string {
  const h = req.headers;
  if (railway) return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
