import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { safePlan } from "@/lib/printer/dispatch";

// The printers, and the agent dispatcher's read-only plan: whether agent prints are on, and per printer what it prints
// next or why it waits (My machines). Computing the plan writes nothing.
export async function GET() {
  return NextResponse.json({ printers: store.listPrinters(), autoPrint: safePlan() });
}
