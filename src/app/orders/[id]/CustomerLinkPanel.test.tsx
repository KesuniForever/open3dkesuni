import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/core";
import CustomerLinkPanel, { NewLinkAsk, showMade, shownLink } from "./CustomerLinkPanel";

// The order page's Customer card as the server renders it first, and the inline confirm of "New link".
const OLD = "/c/oldoldoldoldoldoldoldold";
const NEW = "/c/newnewnewnewnewnewnewnew";
const render = (node: ReactNode, locale: Locale = "en") =>
  renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>).replace(/&#x27;/g, "'");
const panel = (locale: Locale = "en") =>
  render(<CustomerLinkPanel orderId="ORD-070" path={OLD} name="Aini" note="Warna hijau" onChange={() => {}} />, locale);
const ask = (by: string, busy = false, locale: Locale = "en") =>
  render(<NewLinkAsk by={by} busy={busy} onName={() => {}} onConfirm={() => {}} onCancel={() => {}} />, locale);

describe("order page: the customer link", () => {
  it("shows the link, Copy and Open as customer, and a quiet New link button; nothing asked yet", () => {
    const html = panel();
    expect(html).toContain(`<code style="flex:1 1 260px;overflow-wrap:anywhere">${OLD}</code>`);
    expect(html).toContain(">Copy customer link</button>");
    expect(html).toContain(`<a href="${OLD}" target="_blank" rel="noreferrer">Open as customer</a>`);
    expect(html).toMatch(/<button type="button" class="quiet">New link<\/button>/);
    expect(html).not.toContain("The old link stops working.");
    expect(html).not.toContain("New link made.");
    expect(html).toContain("“Warna hijau”");
  });

  it("the inline confirm: a short line, the name, Make new link and Cancel (no browser dialog)", () => {
    const html = ask("Khelda");
    expect(html).toContain("The old link stops working.");
    expect(html).toContain('<input placeholder="e.g. Khelda" maxLength="60" value="Khelda"/>');
    expect(html).toContain('<button type="submit" class="danger">Make new link</button>');
    expect(html).toContain('<button type="button" autofocus="">Cancel</button>');
    // What it is for, and whom to send the new link to (the ⓘ).
    expect(html).toContain("Use this if the link was shown to others, like in a video or a screenshot.");
    expect(html).toContain("Send the new link only to the customer's own WhatsApp number, never to someone who asks with the old link.");
    // Without a name the button stays off and the name field has the focus; while it runs, every control is off.
    const unnamed = ask("  ");
    expect(unnamed).toContain('<button type="submit" class="danger" disabled="">Make new link</button>');
    expect(unnamed).toMatch(/<input [^>]*autofocus=""/);
    expect(unnamed).toContain('<button type="button">Cancel</button>');
    expect(ask("Khelda", true)).toContain('<button type="submit" class="danger" disabled="">Making…</button>');
    expect(ask("Khelda", true)).toMatch(/<button type="button" disabled=""[^>]*>Cancel<\/button>/);
  });

  it("never puts the focus on Make new link: an Enter held on New link must not make one unread", () => {
    for (const html of [ask("Khelda"), ask("  "), ask("Khelda", true)]) {
      expect(html).not.toMatch(/<button type="submit"[^>]*autofocus/);
    }
  });

  it("in Indonesian", () => {
    expect(panel("id")).toMatch(/class="quiet">Tautan baru<\/button>/);
    const html = ask("Khelda", false, "id");
    expect(html).toContain("Tautan lama langsung tidak berlaku.");
    expect(html).toContain(">Buat tautan baru</button>");
    expect(html).toContain(">Batal</button>");
    expect(html).toContain("Kirim tautan baru hanya ke nomor WhatsApp pelanggan sendiri, jangan ke orang yang memintanya dengan tautan lama.");
    expect(html).not.toMatch(/>(Make new link|Cancel|Your name)</);
  });

  it("shows the new link at once, then whatever the page reads (a newer one made in another tab too)", () => {
    expect(shownLink(OLD, null)).toBe(OLD);
    const made = { old: OLD, link: NEW };
    expect(shownLink(OLD, made)).toBe(NEW); // the page has not reloaded yet
    expect(shownLink(NEW, made)).toBe(NEW); // it has
    expect(shownLink("/c/newerneweerneweerneweer", made)).toBe("/c/newerneweerneweerneweer");
  });

  it("\"New link made\" shows only while nothing else is going on on the card", () => {
    const made = { old: OLD, link: NEW };
    expect(showMade(NEW, made, false, false)).toBe(true);
    expect(showMade(NEW, made, true, false)).toBe(false); // New link pressed again: the confirm is open
    expect(showMade(NEW, made, true, true)).toBe(false); // that second try failed: only the error shows
    expect(showMade(NEW, made, false, true)).toBe(false);
    expect(showMade("/c/newerneweerneweerneweer", made, false, false)).toBe(false); // a newer one made in another tab
    expect(showMade(OLD, null, false, false)).toBe(false);
  });

  it("never asks with window.confirm or alert", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/orders/[id]/CustomerLinkPanel.tsx"), "utf8");
    expect(src).not.toMatch(/window\.(confirm|alert)|\balert\(/);
    expect(src).toContain("/customer-link`");
  });
});
