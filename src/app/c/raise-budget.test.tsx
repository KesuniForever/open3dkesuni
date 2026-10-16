import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import { LocaleProvider } from "@/i18n/client";
import { tLib } from "@/lib/lib-text";
import type { CustomerView } from "@/lib/customer";
import { NOT_OVER, PRICE_CHANGED, RAISE_CLOSED } from "@/lib/budget-raise";
import { ChoiceCard, RaiseBudget, headline } from "./[token]/CustomerView";

// "Your price is above your budget" on the customer's order page (ORD-005: 5 lamps, Kesuni's price Rp2.500.000), as the
// server renders it, in English and in Indonesian.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const render = (node: ReactNode, locale: Locale) => renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);
const OVER: NonNullable<CustomerView["overBudget"]> = {
  quoteId: "Q-6-abc", priceIdr: 2_500_000, unitIdr: 500_000, quantity: 5, priceUsdc: "151.515152", budgetIdr: 1_500_000,
};
const card = (locale: Locale, o = OVER, name = "Aini") => render(
  <RaiseBudget o={o} limitIdr={1_000_000} defaultName={name} busy={false} onRaise={() => {}} t={makeT(locale, ID)} />, locale,
);
const view = (extra: Partial<CustomerView>) =>
  ({ order: { status: "CREATED" }, escrow: null, paying: false, printing: null, printedOn: null, overBudget: null, budgetRaised: null, ...extra }) as unknown as CustomerView;

describe("\"Your price is above your budget\" on the order page", () => {
  it("English: the price, per piece and in USDC (2 decimals at most), the budget, the name and one button", () => {
    const html = card("en");
    expect(text(html)).toBe([
      "Rp2.500.000", "Rp500.000 per piece · ≈ 151.52 USDC",
      "Your budget", "Kesuni can only charge up to the budget you set. Raising it lets Kesuni prepare your agreement at this price. Above Rp1.000.000 Kesuni's owner also approves.",
      "Rp1.500.000", "Your name", "Raise my budget to Rp2.500.000",
      "You do not pay yet: you agree to the final price first. Or message Kesuni to change the order.",
    ].join(" "));
    expect(html).toContain('value="Aini"');
    expect(html).toMatch(/<button class="primary cust-cta">/); // enabled with a name
    expect(text(html)).not.toMatch(/cost|margin|gram|owner-approved|Q-6/i);
  });

  it("Indonesian", () => {
    const t = text(card("id"));
    for (const s of [
      "Rp500.000 per buah · ≈ 151,52 USDC", "Anggaran Anda", "Kesuni hanya bisa menagih sampai anggaran yang Anda tetapkan.",
      "Di atas Rp1.000.000, pemilik Kesuni juga ikut menyetujui.", "Nama Anda", "Naikkan anggaran saya menjadi Rp2.500.000",
      "Anda belum membayar: Anda menyetujui harga akhir dulu. Atau hubungi Kesuni untuk mengubah pesanan.",
    ]) expect(t).toContain(s);
  });

  it("one piece: no per-piece line; no name: the button waits for it", () => {
    const html = card("en", { ...OVER, quantity: 1, unitIdr: 2_500_000 }, "");
    expect(text(html)).toContain("Rp2.500.000 ≈ 151.52 USDC Your budget");
    expect(html).toMatch(/<button class="primary cust-cta" disabled="">/);
  });

  it("the owner's approval is mentioned only when the price is above the owner's limit", () => {
    const under = text(card("en", { ...OVER, priceIdr: 800_000, unitIdr: 160_000, priceUsdc: "48.484848", budgetIdr: 500_000 }));
    expect(under).toContain("Raising it lets Kesuni prepare your agreement at this price. Rp500.000");
    expect(under).not.toMatch(/owner/);
  });

  it("the headline: above the budget, then raised, else Kesuni prepares the price", () => {
    const en = makeT("en", {});
    const id = makeT("id", ID);
    expect(headline(view({ overBudget: OVER }), en)).toEqual({ title: "Your price is above your budget", sub: "" });
    expect(headline(view({ overBudget: OVER }), id).title).toBe("Harga melebihi anggaran Anda");
    expect(headline(view({ budgetRaised: { toIdr: 2_500_000 } }), en)).toEqual({ title: "Kesuni is preparing your agreement", sub: "" });
    expect(headline(view({ budgetRaised: { toIdr: 2_500_000 } }), id).title).toBe("Kesuni sedang menyiapkan kesepakatan Anda");
    expect(headline(view({}), en)).toEqual({
      title: "Kesuni is preparing your price",
      sub: "Kesuni is checking your order. The price will appear on this page. You can close it and open the link again later.",
    });
  });
});

describe("the colour card next to Kesuni's price", () => {
  it("drops \"until Kesuni sends the price\" once the price is on the page; the colours can still change", () => {
    const choice: CustomerView["choice"] = { material: "PLA", colors: [], canChange: true, materialLocked: true };
    const note = "You can change this until Kesuni sends the price.";
    const cc = (priceShown: boolean) => text(render(<ChoiceCard token="t" choice={choice} onSaved={async () => {}} priceShown={priceShown} />, "en"));
    expect(cc(false)).toContain(note);
    expect(cc(true)).not.toContain(note);
    expect(cc(true)).toContain("Change");
  });
});

describe("every new text has its Indonesian", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const literals = (src: string) => [...src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

  it("the card, the headlines, the confirmation line, the operator's lines and the log row", () => {
    const page = read("src/app/c/[token]/CustomerView.tsx");
    const part = page.slice(page.indexOf("export function RaiseBudget"), page.indexOf("/** Kesuni's official price by weight"));
    const outside = [
      "Your price is above your budget", "Kesuni is preparing your agreement", "Budget raised to {price}.",
      "raised by the customer from {from} ({name}, {date})", "customer raised the budget to Rp{total} (quote {quote})", "Customer raised the budget",
    ];
    const sources = ["src/app/orders/[id]/OrderView.tsx", "src/lib/budget.ts", "src/lib/ops.ts"].map(read).join("\n") + page;
    for (const k of outside) expect(sources, k).toContain(`t("${k}"`); // the pages use exactly these keys
    const status = read("src/app/request/[code]/order-status.ts"); // "My orders", translated by the portal
    for (const k of ["Above your budget", "Preparing your agreement"]) expect(status).toContain(`"${k}"`);
    const keys = [...literals(part), ...outside, "Above your budget", "Preparing your agreement"];
    expect(keys.length).toBeGreaterThan(10);
    expect([...new Set(keys)].filter((k) => !(k in ID))).toEqual([]);
  });

  it("every answer of \"Raise my budget\"", () => {
    const id = makeT("id", ID);
    for (const x of [PRICE_CHANGED, NOT_OVER, RAISE_CLOSED, "Name is required", "Order not found", "Too many tries in one hour. Try again later or contact Kesuni."]) {
      expect(tLib(id, x), x).not.toBe(x);
    }
    expect(id(PRICE_CHANGED)).toBe("Harganya berubah. Periksa harga baru di atas.");
  });
});
