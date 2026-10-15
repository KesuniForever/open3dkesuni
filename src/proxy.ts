// Guards the operator side when the app is reachable from the internet (e.g. a Cloudflare tunnel).
// Customer links (/c/<token>), the invite order form (/request/<code>) and the printer bridge
// endpoint (own bearer token) stay open; everything else needs OPERATOR_PASSWORD.
// Requests from this computer or the home network skip the password, so local work is unchanged.
// Writes to the operator side must come from the app's own pages: the browser re-sends a saved Basic-auth
// password (and the home network needs none), so a form on another site could otherwise post here.
import { NextResponse, type NextRequest } from "next/server";
import { checkOperatorAuth, onRailway } from "@/lib/deploy";

const OPEN = [/^\/c\/[^/]+$/, /^\/api\/c(\/.*)?$/, /^\/request\/[^/]+$/, /^\/api\/printers\/report$/];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;
const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True when a browser sent this request from another site. Sec-Fetch-Site is set by the browser itself (HTTPS and
 * localhost only); over plain http on the home network the Origin host is compared with the host the request went to.
 * Scripts (printer bridge, import script, curl) send neither header and still need the password on the public link.
 */
function fromOtherSite(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let from: string;
  try {
    from = new URL(origin).host.toLowerCase();
  } catch {
    return true; // "null": sandboxed frame or data: page
  }
  const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host")]
    .flatMap((h) => (h ?? "").split(","))
    .map((h) => h.trim().toLowerCase());
  return !hosts.includes(from);
}

export function proxy(req: NextRequest) {
  if (OPEN.some((r) => r.test(req.nextUrl.pathname))) return NextResponse.next();
  if (!READ_ONLY.has(req.method) && fromOtherSite(req)) {
    return new NextResponse("Blocked: this request came from another site.", { status: 403 });
  }
  // On Railway every request comes from the internet, whatever Host header it claims.
  const remote = onRailway(process.env) || req.headers.has("cf-connecting-ip") || !LOCAL_HOST.test(req.headers.get("host") ?? "");
  if (!remote) return NextResponse.next();
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) return new NextResponse("Operator pages are closed on the public link.", { status: 403 });
  // Same check as the admin routes: UTF-8 password, compared in constant time.
  if (checkOperatorAuth(req.headers.get("authorization"), password).ok) return NextResponse.next();
  return new NextResponse("Operator login required.", {
    status: 401, headers: { "www-authenticate": 'Basic realm="Kesuni operator", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
