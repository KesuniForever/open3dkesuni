import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "./demo";
import { DEMO_VIDEO_URL, SCENARIO_OUTCOMES, videoEmbed } from "./landing";

describe("videoEmbed", () => {
  it("turns YouTube watch, share and shorts links into the embed player", () => {
    const yt = { kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", host: "www.youtube-nocookie.com" };
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toEqual(yt);
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ?si=abc")).toEqual(yt);
    expect(videoEmbed("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toEqual(yt);
    expect(videoEmbed("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual(yt);
  });

  it("turns Vimeo links into the Vimeo player", () => {
    const v = { kind: "iframe", src: "https://player.vimeo.com/video/123456789", host: "player.vimeo.com" };
    expect(videoEmbed("https://vimeo.com/123456789")).toEqual(v);
    expect(videoEmbed("https://player.vimeo.com/video/123456789?h=abc")).toEqual(v);
  });

  it("plays an .mp4 or .webm file in a video player", () => {
    expect(videoEmbed("https://cdn.example.com/kesuni/demo.mp4")).toEqual({ kind: "video", src: "https://cdn.example.com/kesuni/demo.mp4", host: "cdn.example.com" });
    expect(videoEmbed("https://cdn.example.com/demo.WEBM")?.kind).toBe("video");
  });

  it("shows nothing for an empty, plain-http or unknown link", () => {
    for (const u of ["", "  ", "not a url", "http://youtu.be/dQw4w9WgXcQ", "javascript:alert(1)", "https://example.com/page", "https://youtube.com/watch?v=<x>"]) {
      expect(videoEmbed(u), u).toBeNull();
    }
  });

  it("the configured link is empty or one the page can show", () => {
    expect(DEMO_VIDEO_URL === "" || videoEmbed(DEMO_VIDEO_URL) !== null).toBe(true);
  });

  it("every practice scenario has an outcome line", () => {
    for (const s of DEMO_SCENARIOS) expect(SCENARIO_OUTCOMES[s.id], s.id).toBeTruthy();
  });
});
