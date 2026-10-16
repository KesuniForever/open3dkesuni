import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import { DEMO_SCENARIOS } from "@/lib/demo";
import { videoEmbed, type VideoEmbed } from "@/lib/landing";
import Landing, { type LandingStats } from "./Landing";

// The landing page body as the server renders it: what a judge sees first. Links only: no form, no button that posts.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const stats: LandingStats = { printersOnline: 2, printersTotal: 3, orders: 7, arcVerified: 5 };
const render = (locale: Locale, video: VideoEmbed | null = null, s: LandingStats | null = stats) =>
  renderToStaticMarkup(<Landing t={makeT(locale, ID)} stats={s} video={video} />);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("Landing page", () => {
  it("says what Open3DKesuni is, in English by default", () => {
    const t = text(render("en"));
    expect(t).toContain("A 3D-print studio that runs itself, and gets paid only when the customer is happy.");
    expect(t).toContain("AI decides. Code constrains. The blockchain executes. Humans control the boundaries.");
    expect(t).toContain("Why three printers?");
    expect(t).toContain("no customer has paid through the app yet");
    expect(t).toContain("not real money");
    for (const s of DEMO_SCENARIOS) expect(t).toContain(s.title);
    expect(t).toMatch(/Printers online 2 \/3/);
  });

  it("has an Indonesian version", () => {
    const t = text(render("id"));
    expect(t).toContain("Studio cetak 3D yang berjalan sendiri, dan baru dibayar saat pelanggan puas.");
    expect(t).toContain("AI memutuskan. Kode membatasi.");
    expect(t).not.toContain("runs itself");
  });

  it("has no form and no button, and links only to /live, /dashboard and #demo", () => {
    for (const locale of ["en", "id"] as const) {
      const html = render(locale);
      expect(html).not.toMatch(/<form|<button|<input|method=|formaction/i);
      expect([...new Set(hrefs(html))].sort()).toEqual(["#demo", "/dashboard", "/live"]);
    }
  });

  it("names no pilot customer and quotes no one", () => {
    const html = render("en");
    for (const name of ["Aini", "Agung", "Khelda", "Felia", "Sabina"]) expect(html).not.toContain(name);
    expect(html).not.toMatch(/<blockquote|testimonial/i);
  });

  it("leaves out the live numbers when they could not be read", () => {
    expect(render("en", null, null)).not.toContain("lp-stats");
  });

  it("shows a placeholder until the demo video is set, then the player", () => {
    expect(text(render("en"))).toContain("Demo video coming soon");
    const yt = render("en", videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    expect(yt).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(yt).not.toContain("Demo video coming soon");
    expect(hrefs(yt).every((h) => ["#demo", "/live", "/dashboard"].includes(h))).toBe(true);
    const mp4 = render("en", videoEmbed("https://files.example.com/demo.mp4"));
    expect(mp4).toMatch(/<video src="https:\/\/files\.example\.com\/demo\.mp4"[^>]*controls/);
  });
});
