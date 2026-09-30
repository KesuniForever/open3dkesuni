import { NextResponse } from "next/server";
import { resetSimulated } from "@/lib/store";

// Restores the simulated demo order. Orders labelled "real" are never touched.
export async function POST() {
  resetSimulated();
  return NextResponse.json({ ok: true });
}
