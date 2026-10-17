import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import { DEMO_SCENARIOS } from "@/lib/demo";
import { videoEmbed, type VideoEmbed } from "@/lib/landing";
import TeamLogin from "@/app/components/TeamLogin";
import Landing, { type LandingStats } from "./Landing";

// The landing page body as the server renders it: what a judge sees first. Links only: no form, no button that posts.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const stats: LandingStats = { printersOnline: 2, printersTotal: 3, realOrders: 4, realCustomers: 3, depositsVerified: 2 };
const render = (locale: Locale, video: VideoEmbed | null = null, s: LandingStats | null = stats) =>
  renderToStaticMarkup(<Landing t={makeT(locale, ID)} stats={s} video={video} />);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("Landing page", () => {
  it("says what Open3DKesuni is, in English by default", () => {
    const t = text(render("en"));
    expect(t).toContain("A 3D-print studio that runs itself, and gets paid only when the customer is happy.");
    expect(t).toContain("AI decides. Code constrains. The blockchain executes. Humans control the boundaries.");
    expect(t).toContain("Why three printers?");
    expect(t).toContain("not real money");
    for (const s of DEMO_SCENARIOS) expect(t).toContain(s.title);
    expect(t).toMatch(/Printers online 2 \/3/);
  });

  it("honest traction: real orders, real customers and verified escrow deposits only; how customers pay", () => {
    const t = text(render("en"));
    expect(t).toMatch(/Printers online 2 \/3 Real orders 4 Real customers 3 Escrow deposits verified on Arc 2 /);
    expect(t).toContain("Real orders only: the team's own tests are never counted. The deposits are test USDC on Arc Testnet.");
    expect(t).toContain("Payment is in rupiah, outside the app; the escrow deposits on Arc are test USDC from Kesuni's demo wallet, not customer money.");
    expect(t).toContain("Money held apart, released only by rule.");
    expect(t).not.toMatch(/no customer has paid|Orders handled|held fairly|Includes practice orders/);
    // The practice page needs the team's password: the page lists what each scenario shows, it does not offer to try it.
    expect(t).toContain(`${DEMO_SCENARIOS.length} scenarios we test`);
    expect(t).not.toMatch(/Try the rules|\(shown in the video\)/);
  });

  it("has an Indonesian version", () => {
    const t = text(render("id"));
    expect(t).toContain("Studio cetak 3D yang berjalan sendiri, dan baru dibayar saat pelanggan puas.");
    expect(t).toContain("AI memutuskan. Kode membatasi.");
    expect(t).toMatch(/Pesanan nyata 4 Pelanggan nyata 3 Setoran escrow terverifikasi di Arc 2 /);
    expect(t).toContain("Pembayaran dalam rupiah, di luar aplikasi");
    expect(t).not.toContain("runs itself");
  });

  it("has no form and no button, and links only to /live, /customer and /dashboard (and #demo once a video is set)", () => {
    for (const locale of ["en", "id"] as const) {
      const html = render(locale);
      expect(html).not.toMatch(/<form|<button|<input|method=|formaction/i);
      expect([...new Set(hrefs(html))].sort()).toEqual(["/customer", "/dashboard", "/live"]);
      expect([...new Set(hrefs(render(locale, videoEmbed(YT))))].sort()).toEqual(["#demo", "/customer", "/dashboard", "/live"]);
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

  it("no demo video yet: no 'Watch the demo' button and no video card; once set, both, with the player", () => {
    const none = render("en");
    expect(text(none)).not.toMatch(/Watch the demo|Demo video coming soon/);
    expect(none).not.toContain("lp-video");
    const yt = render("en", videoEmbed(YT));
    expect(text(yt)).toContain("Watch the demo");
    expect(text(yt)).not.toContain("(shown in the video)"); // the video shows the real flow, not the practice scenarios
    expect(yt).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    const mp4 = render("en", videoEmbed("https://files.example.com/demo.mp4"));
    expect(mp4).toMatch(/<video src="https:\/\/files\.example\.com\/demo\.mp4"[^>]*controls/);
  });
});

describe("Team login (top bar of the landing page and /live)", () => {
  it("a lock and 'Team login' to /dashboard; the words stay for screen readers when a phone shows the lock alone", () => {
    for (const locale of ["en", "id"] as const) {
      const html = renderToStaticMarkup(<TeamLogin t={makeT(locale, ID)} />);
      const label = locale === "en" ? "Team login" : "Login tim";
      expect(html).toMatch(new RegExp(`^<a class="lp-btn ghost lp-top-dash" href="/dashboard" aria-label="${label}" title="${label}"><svg`));
      expect(html).toContain(`<span class="lp-top-label">${label}</span>`);
      expect(html).not.toMatch(/Dashboard</);
    }
  });
});
