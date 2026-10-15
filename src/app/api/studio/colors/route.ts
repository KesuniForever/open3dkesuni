import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { publicPalette, studioPalette } from "@/lib/colors";

// GET (public, customer pages use it): the materials and colours loaded in the studio's AMS units right now, PLA and
// PETG. Only material, colour, name and whether a person checked it: no printers, slots or addresses.
export async function GET() {
  return NextResponse.json({ colors: publicPalette(studioPalette(store.listPrinters())), at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } });
}
