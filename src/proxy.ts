// Guards the operator side when the app is reachable from the internet (e.g. a Cloudflare tunnel).
// Customer links (/c/<token>), the invite order form (/pesan/<code>) and the printer bridge
// endpoint (own bearer token) stay open; everything else needs OPERATOR_PASSWORD.
// Requests from this computer or the home network skip the password, so local work is unchanged.
import { NextResponse, type NextRequest } from "next/server";

const OPEN = [/^\/c\/[^/]+$/, /^\/api\/c(\/.*)?$/, /^\/pesan\/[^/]+$/, /^\/api\/printers\/report$/];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function passwordOk(req: NextRequest, password: string): boolean {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  try {
    const decoded = atob(h.slice(6));
    return sameText(decoded.slice(decoded.indexOf(":") + 1), password);
  } catch {
    return false;
  }
}

export function proxy(req: NextRequest) {
  if (OPEN.some((r) => r.test(req.nextUrl.pathname))) return NextResponse.next();
  const remote = req.headers.has("cf-connecting-ip") || !LOCAL_HOST.test(req.headers.get("host") ?? "");
  if (!remote) return NextResponse.next();
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) return new NextResponse("Operator pages are closed on the public link.", { status: 403 });
  if (passwordOk(req, password)) return NextResponse.next();
  return new NextResponse("Operator login required.", {
    status: 401, headers: { "www-authenticate": 'Basic realm="Kesuni operator", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
