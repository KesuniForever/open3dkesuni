import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import { LocaleProvider } from "@/i18n/client";
import { TabNav } from "@/app/components/Tabs";
import type { PortalMachines, PortalPrice, PortalToken } from "@/lib/portal";
import MyOrders from "./MyOrders";
import { MachinesTab, PORTAL_TABS, PriceTab, TokenTab, portalTab } from "./Portal";

// The customer portal's tabs as the server renders them: short, read-only, in English with an Indonesian switch.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = (locale: Locale, node: (t: ReturnType<typeof makeT>) => ReactNode) =>
  renderToStaticMarkup(<LocaleProvider locale={locale}>{node(makeT(locale, ID))}</LocaleProvider>);

const MACHINES: PortalMachines = {
  at: "2026-10-16T05:00:00.000Z", lastReport: "8 s ago", bridgeDown: false,
  printers: [
    {
      id: "a1", name: "A1 Combo #1", online: true, state: { tone: "busy", text: "Printing 62%" }, stage: { text: "Printing", needsPerson: false },
      progress: { percent: 62, paused: false, remaining: "42m", doneAt: "12:41" },
      spools: [
        { key: "slot-1", type: "PLA", name: "Yellow", color: "#FEC600", colors: ["#FEC600"], active: true },
        { key: "ext", type: "PETG", name: "White", color: "#FFFFFF", colors: [], active: false },
      ],
    },
    { id: "a1-2", name: "A1 Combo #2", online: false, state: { tone: "bad", text: "Offline" }, stage: null, progress: null, spools: [] },
  ],
};
const PRICE: PortalPrice = {
  material: "PETG", perGram: { PLA: 1500, PETG: 1800 }, roundIdr: 500, minOrderIdr: 100_000, input: { grams: "38.2", quantity: "2" },
  result: { ok: true, gramsPerUnit: 38.2, quantity: 2, pricePerGramIdr: 1800, unitPriceIdr: 69_000, totalIdr: 138_000, usdc: "8.625" },
};
const TOKEN: PortalToken = {
  overall: "ISSUANCE BLOCKED", passed: 1, total: 8,
  gates: [
    { n: "01", id: "legal", title: "Legal & instrument rights", status: "BLOCKED", line: "Blocked in Indonesia. Other jurisdictions not reviewed." },
    { n: "04", id: "business", title: "Business evidence", status: "PASS", line: "Real usage meets the draft thresholds." },
  ],
};

describe("customer portal tabs", () => {
  it("menu: the order form first, then my orders, machines, price calculator, token research", () => {
    const html = render("en", (t) => <TabNav tabs={PORTAL_TABS} active="price" basePath="/request/abc" t={t} />);
    expect(text(html)).toBe(" New order My orders Machines Price calculator Token research ");
    expect(html).toContain('href="/request/abc"');
    expect(html).toContain('href="/request/abc?tab=orders"');
    expect(html).toMatch(/class="tab on" aria-current="page" href="\/request\/abc\?tab=price"|href="\/request\/abc\?tab=price"[^>]*class="tab on"/);
    expect(text(render("id", (t) => <TabNav tabs={PORTAL_TABS} active="order" basePath="/request/abc" t={t} />)))
      .toBe(" Pesanan baru Pesanan saya Mesin Kalkulator harga Riset token ");
    expect(portalTab(undefined)).toBe("order");
    expect(portalTab("machines")).toBe("machines");
    expect(portalTab("admin")).toBe("order");
    expect(portalTab(["token", "price"])).toBe("token");
  });

  it("machines: name, online or offline, what it does, progress and finish time, colours; no button or form", () => {
    const html = render("en", (t) => <MachinesTab m={MACHINES} t={t} locale="en" />);
    expect(text(html)).toMatch(/Machines .* Updated 12:00 WIB A1 Combo #1 Online Printing 62% 62% Printing 42m left Done around 12:41 WIB PLA Yellow PETG White A1 Combo #2 Offline Offline $/);
    expect(html).not.toMatch(/<button|<form|<input/);
    expect(text(html)).not.toContain("studio connection");
    const down = text(render("id", (t) => <MachinesTab m={{ ...MACHINES, bridgeDown: true, lastReport: "1 jam lalu" }} t={t} locale="id" />));
    expect(down).toMatch(/Mesin .* Koneksi studio sedang offline\. Laporan terakhir 1 jam lalu\..* sisa 42m Selesai sekitar 12:41 WIB PLA Kuning PETG Putih/);
    expect(text(render("en", (t) => <MachinesTab m={{ ...MACHINES, printers: [] }} t={t} locale="en" />))).toContain("No printer has reported yet.");
    // Paused for a person (filament change): said plainly, no finish time.
    const one = MACHINES.printers[0];
    const waiting = { ...one, state: { tone: "warn" as const, text: "Paused 62%" }, stage: { text: "Changing filament", needsPerson: true }, progress: { ...one.progress!, paused: true, doneAt: null } };
    const paused = text(render("en", (t) => <MachinesTab m={{ ...MACHINES, printers: [waiting] }} t={t} locale="en" />));
    expect(paused).toMatch(/A1 Combo #1 Online Paused 62% Waiting for a person at Kesuni 62% Paused PLA Yellow/);
    expect(paused).not.toMatch(/Changing filament|left|Done around/);
  });

  it("price calculator: the official price per gram, the form back on this page, the total in Rupiah and USDC; no cost", () => {
    const html = render("en", (t) => <PriceTab p={PRICE} action="/request/abc" t={t} />);
    expect(text(html)).toMatch(/Price calculator .* PLA Rp1\.500 per gram PETG Rp1\.800 per gram Grams per piece Quantity Material PLA PETG Calculate Rp138\.000 ≈ 8\.625 USDC · Rp69\.000 per piece An estimate\. The final price comes on your order page\./);
    expect(html).toContain('action="/request/abc"');
    expect(html).toContain('name="tab" value="price"');
    expect(html).toMatch(/name="g" value="38.2"/);
    expect(html).toMatch(/<option value="PETG" selected="">/);
    expect(text(html)).not.toMatch(/cost|margin|profit/i);
    const empty = text(render("id", (t) => <PriceTab p={{ ...PRICE, result: null }} action="/request/abc" t={t} />));
    expect(empty).toMatch(/Kalkulator harga .* Gram per buah Jumlah Bahan PLA PETG Hitung Ini perkiraan\./);
    expect(empty).not.toContain("USDC");
    const bad = text(render("id", (t) => <PriceTab p={{ ...PRICE, result: { ok: false, reasons: ["Grams per unit must be above 0 and at most 5000"] } }} action="/x" t={t} />));
    expect(bad).toContain("Gram per unit harus di atas 0 dan maksimal 5000");
    expect(text(render("id", (t) => <PriceTab p={{ ...PRICE, result: { ok: false, reasons: ["Enter the grams per piece as a number, for example 16"] } }} action="/x" t={t} />)))
      .toContain("Isi gram per buah dengan angka, misalnya 16");
  });

  it("price calculator: a total under the owner's minimum says the order waits for Kesuni's approval", () => {
    expect(text(render("en", (t) => <PriceTab p={PRICE} action="/x" t={t} />))).not.toContain("approval");
    const small = { ...PRICE, result: { ok: true as const, gramsPerUnit: 16, quantity: 1, pricePerGramIdr: 1500, unitPriceIdr: 24_000, totalIdr: 24_000, usdc: "1.5" } };
    expect(text(render("en", (t) => <PriceTab p={small} action="/x" t={t} />))).toContain("Orders under Rp100.000 need Kesuni's approval first, so the price can take longer.");
    expect(text(render("id", (t) => <PriceTab p={small} action="/x" t={t} />))).toContain("Pesanan di bawah Rp100.000 perlu persetujuan Kesuni dulu, jadi harganya bisa lebih lama keluar.");
  });

  it("token research: labelled research only, each gate with its status; its one line behind the ⓘ", () => {
    const html = render("en", (t) => <TokenTab k={TOKEN} t={t} />);
    expect(text(html)).toMatch(/Token research ISSUANCE BLOCKED Research only\. No token exists and nothing is sold\. .* 1 of 8 checks passed 01 Legal & instrument rights Blocked in Indonesia\. Other jurisdictions not reviewed\. BLOCKED 04 Business evidence Real usage meets the draft thresholds\. PASS/);
    expect(html).toMatch(/<span class="info-pop" role="tooltip">Blocked in Indonesia\./);
    expect(html).not.toContain("gates with PASS evidence");
    expect(html).not.toMatch(/<button|<form|<input/);
    expect(text(render("id", (t) => <TokenTab k={TOKEN} t={t} />))).toMatch(/Riset token PENERBITAN DIBLOKIR Hanya riset\. Tidak ada token dan tidak ada yang dijual\..* 1 dari 8 syarat lulus .* DIBLOKIR .* LULUS/);
  });

  it("my orders: says it is loading until this browser's list is read", () => {
    const html = render("en", () => <MyOrders orderHref="/request/abc" />);
    expect(text(html)).toMatch(/My orders .* Loading… Have an order link\? Paste it here Open/);
    expect(text(render("id", () => <MyOrders orderHref="/request/abc" />))).toMatch(/Pesanan saya .* Memuat… Punya link pesanan\? Tempel di sini Buka/);
  });
});
