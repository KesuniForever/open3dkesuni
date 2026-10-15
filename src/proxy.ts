// Guards the operator side when the app is reachable from the internet (e.g. a Cloudflare tunnel).
// Customer links (/c/<token>), the invite order form (/request/<code>), the studio's colour list for customers and the
// printer bridge endpoints (each checks its own bearer token) stay open; everything else needs OPERATOR_PASSWORD.
// Requests from this computer or the home network skip the password, so local work is unchanged. Except printer
// controls, print starts and the camera picture: they move real machines and show the studio, so only this computer
// skips the password for them; a phone or laptop on the studio Wi-Fi gives the operator password too.
// Writes to the operator side must come from the app's own pages: the browser re-sends a saved Basic-auth
// password (and the home network needs none), so a form on another site could otherwise post here.
import { NextResponse, type NextRequest } from "next/server";
import { checkOperatorAuth, onRailway } from "@/lib/deploy";

const OPEN = [
  /^\/c\/[^/]+$/, /^\/api\/c(\/.*)?$/, /^\/request\/[^/]+$/, /^\/api\/studio\/colors$/,
  // LAN bridge (bearer PRINTER_BRIDGE_TOKEN, checked by each route)
  /^\/api\/printers\/report$/, /^\/api\/printers\/queue(\/[^/]+)?$/, /^\/api\/print-jobs\/[^/]+\/file$/,
];
/** Open for these methods only: the bridge POSTs camera frames; reading them (GET) is for operators. */
const OPEN_FOR: [RegExp, string[]][] = [[/^\/api\/printers\/[^/]+\/camera$/, ["POST"]]];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;
const THIS_COMPUTER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** Printer controls, print starts and cancels, the camera picture: the password from any other device too. */
const PRINTER_CONTROL: [RegExp, string[]][] = [
  [/^\/api\/printers\/[^/]+\/command$/, ["POST"]],
  [/^\/api\/print-jobs(\/[^/]+)?$/, ["POST"]],
  [/^\/api\/printers\/[^/]+\/camera$/, ["GET", "HEAD"]],
];
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
  const path = req.nextUrl.pathname;
  if (OPEN.some((r) => r.test(path)) || OPEN_FOR.some(([r, methods]) => r.test(path) && methods.includes(req.method))) {
    return NextResponse.next();
  }
  if (!READ_ONLY.has(req.method) && fromOtherSite(req)) {
    return new NextResponse("Blocked: this request came from another site.", { status: 403 });
  }
  // On Railway every request comes from the internet, whatever Host header it claims.
  const host = req.headers.get("host") ?? "";
  const remote = onRailway(process.env) || req.headers.has("cf-connecting-ip") || !LOCAL_HOST.test(host);
  const control = PRINTER_CONTROL.some(([r, methods]) => r.test(path) && methods.includes(req.method));
  if (!remote && !(control && !THIS_COMPUTER.test(host))) return NextResponse.next();
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) {
    return new NextResponse(remote ? "Operator pages are closed on the public link." : "Printer controls from another device need OPERATOR_PASSWORD.", { status: 403 });
  }
  // Same check as the admin routes: UTF-8 password, compared in constant time.
  if (checkOperatorAuth(req.headers.get("authorization"), password).ok) return NextResponse.next();
  return new NextResponse("Operator login required.", {
    status: 401, headers: { "www-authenticate": 'Basic realm="Kesuni operator", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
