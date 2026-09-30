import { NextResponse } from "next/server";
import type { ApiError } from "./types";
import type { Fail } from "./actions";

export const fail = (status: number, error: string, reasons?: string[]) =>
  NextResponse.json({ error, reasons } satisfies ApiError, { status });

export const failWith = (r: Fail) => fail(r.status, r.error, r.reasons);

export type Ctx = { params: Promise<{ id: string }> };

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
