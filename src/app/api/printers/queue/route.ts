import { NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { bridgeQueue } from "@/lib/printer/jobs";

// GET ?printers=a1,a1-2 (bearer PRINTER_BRIDGE_TOKEN): what the LAN bridge should do now: queued commands and print
// jobs, oldest first. Expired ones are never listed. The bridge takes an item by POSTing /api/printers/queue/<id>
// { state: "sent" } (command) or { state: "uploading" } (job) before it acts; that works once.
export async function GET(req: Request) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const list = new URL(req.url).searchParams.get("printers");
  const ids = list ? list.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,32}$/.test(s)) : null;
  return NextResponse.json({ ...bridgeQueue(ids), now: new Date().toISOString() });
}
