import { NextResponse } from "next/server";
import { db } from "./store";
import type { ApiError, Order } from "./types";

export const fail = (status: number, error: string, reasons?: string[]) =>
  NextResponse.json({ error, reasons } satisfies ApiError, { status });

export type Ctx = { params: Promise<{ id: string }> };

export async function loadOrder(ctx: Ctx): Promise<Order | null> {
  const { id } = await ctx.params;
  return db.orders.get(id) ?? null;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
