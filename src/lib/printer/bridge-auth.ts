// The LAN bridge's routes check its bearer token themselves (they are open in src/proxy.ts): PRINTER_BRIDGE_TOKEN,
// compared in constant time. Without the token on the server they are closed.
import { timingSafeEqual } from "node:crypto";
import { fail } from "../http";

export function bridgeAuthorized(req: Request): boolean {
  const token = process.env.PRINTER_BRIDGE_TOKEN;
  if (!token) return false;
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** null when the request carries the bridge token, else the response to send back (503 unset, 401 wrong). */
export function bridgeAuth(req: Request): Response | null {
  if (!process.env.PRINTER_BRIDGE_TOKEN) return fail(503, "PRINTER_BRIDGE_TOKEN is not set on the server");
  if (!bridgeAuthorized(req)) return fail(401, "Bad bridge token");
  return null;
}
