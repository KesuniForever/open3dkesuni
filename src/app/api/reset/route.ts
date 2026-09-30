import { NextResponse } from "next/server";
import { resetDb } from "@/lib/store";

// Restores the simulated seed data. Only affects the in-memory demo store.
export async function POST() {
  resetDb();
  return NextResponse.json({ ok: true });
}
