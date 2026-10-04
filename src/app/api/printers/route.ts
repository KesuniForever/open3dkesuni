import { NextResponse } from "next/server";
import * as store from "@/lib/store";

export async function GET() {
  return NextResponse.json({ printers: store.listPrinters() });
}
