import { NextResponse } from "next/server";
import { getDailyReview, listDailyReviews } from "@/lib/store";
import { generateDailyReview, isDay, jakartaDay } from "@/lib/agent/daily-review";
import { fail, readJson } from "@/lib/http";

// The Chief's daily reviews for the owner. Operator only (see proxy.ts).
// GET: all reviews, newest first; GET ?day=YYYY-MM-DD: one review. POST { day? }: write it now (default today, Jakarta).
export async function GET(req: Request) {
  const day = new URL(req.url).searchParams.get("day");
  if (day === null) return NextResponse.json({ reviews: listDailyReviews() });
  if (!isDay(day)) return fail(400, "day must be a date YYYY-MM-DD");
  const review = getDailyReview(day);
  return review ? NextResponse.json({ review }) : fail(404, `No daily review for ${day}`);
}

export async function POST(req: Request) {
  const b = (await readJson(req)) ?? {};
  const day = b.day === undefined || b.day === "" ? jakartaDay() : b.day;
  if (!isDay(day)) return fail(400, "day must be a date YYYY-MM-DD");
  const r = await generateDailyReview(day, { trigger: "button" });
  return r.ok ? NextResponse.json({ review: r.review }) : fail(r.status, r.error);
}
