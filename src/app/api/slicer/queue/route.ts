import { NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { sliceQueue } from "@/lib/slicing";

// GET (bearer PRINTER_BRIDGE_TOKEN): what the studio PC's slicer should do now, oldest first; expired slices are never
// listed. Asking also tells the app the slicer is there. The bridge takes a slice by POSTing /api/slicer/queue/<id>
// { state: "slicing" } before it downloads the source; that works once.
export async function GET(req: Request) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  return NextResponse.json({ slices: sliceQueue(), now: new Date().toISOString() });
}
