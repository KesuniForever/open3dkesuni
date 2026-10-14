import { NextResponse } from "next/server";
import { chainHealth } from "@/lib/chain-health";

// Arc + Circle read-only health for the home page card, cached ~60 s (?fresh=1 skips the cache). Operator only (proxy.ts).
// Always 200: a network that is down is reported in the body as "unreachable", never as a broken page.
export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return NextResponse.json(await chainHealth({ fresh }));
}
