// The public landing page ("/" for everyone, and /welcome): what Open3DKesuni is, in one look.
import type { ScenarioId } from "./demo";

/**
 * The demo video. Empty: the page shows no "Watch the demo" button and no video card. A YouTube or Vimeo watch/share
 * link is shown in an embedded player; a link to an .mp4 (or .webm) file in a plain video player.
 */
export const DEMO_VIDEO_URL: string = "https://www.youtube.com/watch?v=pJ69_hUfkww";

/** The video link the page uses: the DEMO_VIDEO_URL env var (set on the server, no code change), else the one above. */
export const demoVideoUrl = (env: Record<string, string | undefined> = process.env): string => env.DEMO_VIDEO_URL?.trim() || DEMO_VIDEO_URL;

export type VideoEmbed = { kind: "iframe"; src: string; host: string } | { kind: "video"; src: string; host: string };

/** The player for a video link, or null when the link is empty or not one we can show. Only https links. */
export function videoEmbed(url: string): VideoEmbed | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const ytId = /^[\w-]{6,20}$/;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    return id && ytId.test(id) ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}`, host: "www.youtube-nocookie.com" } : null;
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return ytId.test(id) ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}`, host: "www.youtube-nocookie.com" } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/(?:^|\/)(\d{5,12})(?:\/|$)/)?.[1];
    return id ? { kind: "iframe", src: `https://player.vimeo.com/video/${id}`, host: "player.vimeo.com" } : null;
  }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: "video", src: u.toString(), host: u.hostname };
  return null;
}

/** What each practice scenario ends in, in a few words (the scenarios themselves are in src/lib/demo.ts). */
export const SCENARIO_OUTCOMES: Record<ScenarioId, string> = {
  smooth: "Priced and planned",
  "above-limit": "Waits for the owner's yes",
  "below-minimum": "Owner exception, logged",
  "late-deadline": "Refused, no override",
  "customer-rejects": "Stopped, no money moved",
  "printer-offline": "A task for a person",
};
