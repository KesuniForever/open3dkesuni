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
import { NOT_THROUGH, PAST_DEADLINE, deviceUpdate } from "@/lib/customer";
import { budgetApprox, idrBudget, usdcApprox } from "@/lib/budget";
import { A_DOCUMENT, A_PHOTO, customerDesignProblem } from "@/lib/file-rules";
import { readMesh } from "@/lib/mesh";
import { AgreeAndPay, Decide, MessagesCard, dayText, headline, stepOf, stepsOf } from "./[token]/CustomerView";
import { messageText } from "@/lib/text";
import { UNREADABLE } from "./ModelPreview";
import { WhatsAppButton, waChatLink, waShareLink, whatsappNumber } from "./whatsapp";
import { readDraft } from "@/app/request/[code]/OrderForm";

// The customer's order page after the 17 Oct bug hunt: the status first, rupiah first, plain words, a way out.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const render = (node: ReactNode, locale: Locale = "en") => renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);
const en = makeT("en", {});
const id = makeT("id", ID);
type Tx = NonNullable<CustomerView["escrow"]>["txs"][number];
const escrow = (state: NonNullable<CustomerView["escrow"]>["state"], txs: Tx[] = []): CustomerView["escrow"] =>
  ({ state, amountUsdc: "9.090909", network: "ARC-TESTNET", label: "testnet", txs });
const tx = (kind: Tx["kind"], state: Tx["state"]): Tx => ({ kind, amountUsdc: "9.090909", state, at: "2026-10-17T03:00:00.000Z" });
const view = (status: CustomerView["order"]["status"], extra: Partial<CustomerView> = {}) => ({
  order: { id: "ORD-020", product: "Clip", quantity: 1, deadline: "2026-10-30", status, label: "real" },
  escrow: null, paying: false, printing: null, printedOn: null, overBudget: null, budgetRaised: null, updates: [], ...extra,
}) as unknown as CustomerView;
const printing = (state: string): CustomerView["printing"] => ({ printer: "A1 Combo #1", state, percent: 40, remainingMin: 30, online: true });

describe("the headline follows the order's status first", () => {
  it("printed before it was paid: the print is told, the payment stays open, nothing to accept yet", () => {
    expect(headline(view("IN_PRODUCTION", { printing: printing("RUNNING") }), en).title).toBe("Printing now");
    expect(headline(view("IN_PRODUCTION", { printedOn: "A1 Combo #1" }), en).title).toBe("Printing finished");
    expect(headline(view("EVIDENCE_SUBMITTED"), en)).toEqual({
      title: "Your item is ready!", sub: "The payment is still open: pay below, then you can accept or reject here.",
    });
    expect(headline(view("IN_PRODUCTION"), en)).toEqual({ title: "Your order is being made", sub: "The payment is still open: pay below." });
    expect(headline(view("PLAN_CHOSEN"), en).title).toBe("Your price is ready");
    // The steps: "Printing" or later, with "Price and payment" still open (!).
    expect(stepOf(view("IN_PRODUCTION", { printing: printing("RUNNING") }))).toBe(2);
    expect(stepsOf(view("EVIDENCE_SUBMITTED")).map((s) => s.dot)).toEqual(["✓", "!", "✓", "4", "5"]);
    expect(stepsOf(view("EVIDENCE_SUBMITTED"))[1].state).toBe("open");
  });

  it("plain words: no escrow, wallet or agent in the headline", () => {
    const funded = escrow("FUNDED");
    const lines = [
      headline(view("PLAN_CHOSEN"), en), headline(view("PLAN_CHOSEN", { escrow: funded }), en),
      headline(view("ACCEPTED", { escrow: funded }), en), headline(view("REJECTED", { escrow: escrow("FUNDED", [tx("refund", "QUEUED" as Tx["state"])]) }), en),
      headline(view("EVIDENCE_SUBMITTED", { escrow: funded }), en),
    ].map((h) => `${h.title} ${h.sub}`).join(" ");
    expect(lines).not.toMatch(/escrow|wallet|agent/i);
    expect(headline(view("PLAN_CHOSEN", { escrow: funded }), en).title).toBe("Payment received and kept safe");
    expect(headline(view("PLAN_CHOSEN", { escrow: funded }), id).title).toBe("Pembayaran diterima dan disimpan aman");
  });

  it("testnet: the rupiah go to Kesuni on WhatsApp, so the page never says the app holds or received the money", () => {
    const network = { blockchain: "ARC-TESTNET", isTestnet: true, label: "testnet", name: "Arc Testnet", explorerTxBase: "" } as CustomerView["network"];
    const on = (status: CustomerView["order"]["status"], extra: Partial<CustomerView> = {}) => headline(view(status, { network, ...extra }), en);
    expect(on("PLAN_CHOSEN")).toEqual({ title: "Your price is ready", sub: "Check the details below, then agree. Kesuni sends the payment details on WhatsApp." });
    expect(on("PLAN_CHOSEN", { escrow: escrow("FUNDED") })).toEqual({
      title: "Price agreed", sub: "Kesuni sends the payment details on WhatsApp. Your order is waiting for its turn on a printer.",
    });
    expect(on("PLAN_CHOSEN", { escrow: escrow("AWAITING_DEPOSIT", [tx("customer_topup", "COMPLETE")]), paying: true }).title).toBe("Processing…");
    expect(on("PLAN_CHOSEN", { escrow: escrow("AWAITING_DEPOSIT", [tx("customer_topup", "FAILED")]) })).toEqual({
      title: "It did not go through", sub: "Tap the button again, or wait: Kesuni has been told.",
    });
    const all = (["PLAN_CHOSEN", "IN_PRODUCTION", "ACCEPTED", "PAID", "REJECTED"] as const)
      .flatMap((s) => [on(s), on(s, { escrow: escrow("FUNDED") }), on(s, { escrow: escrow(s === "REJECTED" ? "REFUNDED" : "RELEASED") })])
      .map((h) => `${h.title} ${h.sub}`).join(" ");
    expect(all).not.toMatch(/kept safe|received|Tap Pay|only goes to Kesuni|refunded|released|payment is on its way/i);
    expect(on("REJECTED", { escrow: escrow("REFUNDED") })).toEqual({ title: "You rejected the item", sub: "Kesuni will contact you about a fix." });
    expect(headline(view("PLAN_CHOSEN", { network, escrow: escrow("FUNDED") }), id).title).toBe("Harga disepakati");
  });

  it("an order printed piece by piece: not \"finished\" after its first run", () => {
    const funded = escrow("FUNDED");
    expect(headline(view("IN_PRODUCTION", { escrow: funded, pieces: { printed: 1, total: 3 } }), en)).toEqual({
      title: "Your order is being printed", sub: "1 of 3 pieces printed.",
    });
    expect(headline(view("IN_PRODUCTION", { escrow: funded, pieces: { printed: 1, total: 3 }, printing: printing("RUNNING") }), en).sub)
      .toBe("On printer A1 Combo #1. Progress comes straight from the printer. 1 of 3 pieces printed.");
    // Nothing printed yet: no count, the order waits for a printer as before.
    expect(headline(view("IN_PRODUCTION", { escrow: funded, pieces: { printed: 0, total: 3 } }), en).title).toBe("Payment received and kept safe");
    expect(stepOf(view("IN_PRODUCTION", { escrow: funded, pieces: { printed: 1, total: 3 } }))).toBe(2);
    expect(headline(view("IN_PRODUCTION", { escrow: funded, pieces: { printed: 1, total: 3 } }), id).sub).toBe("1 dari 3 buah sudah dicetak.");
  });

  it("accepted or rejected: never stuck on \"being forwarded\"", () => {
    expect(headline(view("ACCEPTED"), en).sub).toBe("Your order is complete."); // recorded by Kesuni, no escrow
    expect(headline(view("ACCEPTED", { escrow: escrow("FUNDED") }), en).sub).toBe("Kesuni is finishing the payment. Nothing for you to do.");
    expect(headline(view("ACCEPTED", { escrow: escrow("FUNDED", [tx("release", "FAILED")]) }), en).sub).toBe("Kesuni is finishing the payment. Nothing for you to do.");
    expect(headline(view("ACCEPTED", { escrow: escrow("FUNDED", [tx("release", "COMPLETE")]) }), en).sub).toBe("Your payment is on its way to Kesuni.");
    expect(headline(view("REJECTED"), en).title).toBe("You rejected the item");
    expect(headline(view("REJECTED", { escrow: escrow("FUNDED") }), en).sub).toBe("Kesuni is finishing the refund. Nothing for you to do.");
    expect(headline(view("REJECTED", { escrow: escrow("REFUNDED") }), id).title).toBe("Uang Anda sudah dikembalikan");
  });

  it("the payment did not go through: says so, not \"Your price is ready\"", () => {
    const failed = view("PLAN_CHOSEN", { escrow: escrow("AWAITING_DEPOSIT", [tx("customer_topup", "FAILED")]) });
    expect(headline(failed, en)).toEqual({ title: "The payment did not go through", sub: "Tap Pay again, or wait: Kesuni has been told." });
    expect(headline(failed, id).title).toBe("Pembayaran belum berhasil");
    expect(headline(view("PLAN_CHOSEN", { escrow: escrow("AWAITING_DEPOSIT", [tx("customer_topup", "COMPLETE")]), paying: true }), en).title).toBe("Processing your payment…");
  });

  it("the item is ready: photos are mentioned only when there are some", () => {
    const funded = escrow("FUNDED");
    expect(headline(view("EVIDENCE_SUBMITTED", { escrow: funded }), en).sub).toBe("When the item is in your hands, check it, then accept or reject here.");
    const withPhoto = view("EVIDENCE_SUBMITTED", { escrow: funded, updates: [{ kind: "photo", note: "QC", label: "manual", at: "x", photo: "/p" }] });
    expect(headline(withPhoto, en).sub).toBe("When the item is in your hands, check it, then accept or reject here. The quality-check photos are below.");
  });
});

describe("the steps", () => {
  it("received is done at once; printed stays \"Printing\" while Kesuni checks it; step 4 is theirs once handed over", () => {
    expect(stepsOf(view("CREATED")).map((s) => [s.dot, s.state])).toEqual([["✓", "done"], ["2", "now"], ["3", ""], ["4", ""], ["5", ""]]);
    const printed = stepsOf(view("IN_PRODUCTION", { escrow: escrow("FUNDED"), printedOn: "A1 Combo #1" }));
    expect(printed.map((s) => s.dot)).toEqual(["✓", "✓", "3", "4", "5"]);
    expect(printed[2]).toEqual({ label: "Printing", state: "now", dot: "3" });
    const handedOver = stepsOf(view("EVIDENCE_SUBMITTED", { escrow: escrow("FUNDED"), printedOn: "A1 Combo #1" }));
    expect(handedOver[3]).toEqual({ label: "You check the item", state: "now", dot: "4" });
    expect(id(handedOver[3].label)).toBe("Anda memeriksa barang");
    expect(stepsOf(view("PAID", { escrow: escrow("RELEASED") })).every((s) => s.state === "done")).toBe(true);
  });

  it("a rejected order never shows \"Done ✓\"", () => {
    const steps = stepsOf(view("REJECTED", { escrow: escrow("REFUNDED") }));
    expect(steps[4]).toEqual({ label: "Rejected, money back", state: "bad", dot: "✕" });
    expect(steps.map((s) => s.label)).not.toContain("Done");
    expect(id(steps[4].label)).toBe("Ditolak, uang kembali");
  });
});

describe("paying, deciding, and the numbers a customer reads", () => {
  const priced = view("PLAN_CHOSEN", {
    price: { usdc: "3.454545", idr: 57_000, etaHours: 3 }, network: { blockchain: "ARC-TESTNET", isTestnet: true, label: "testnet", name: "Arc Testnet", explorerTxBase: "" },
    agreement: null, costs: null, weightPrice: null,
    spec: { dimensions: "40 × 20 × 10 mm", toleranceMm: 0.3, material: "PLA", color: "Black", layerMm: 0.2, infillPct: 15, finishing: "Standard",
      promise: "Every unit is checked for size, colour, finish and function before hand-over." },
  });

  it("the button and the agreement in rupiah; the date as a date; no layer, infill or USDC", () => {
    const html = render(<AgreeAndPay v={priced} busy={false} onPay={() => {}} t={en} locale="en" />);
    // Testnet: the rupiah are paid to Kesuni on WhatsApp; the button agrees, it does not "pay".
    expect(text(html)).toContain("Agree to Rp57.000");
    expect(text(html)).not.toMatch(/\bpay\b/i);
    expect(text(html)).toContain("Ready by 30 Oct 2026");
    expect(text(html)).toContain("Tick the box and write your name to continue.");
    expect(text(html)).not.toMatch(/USDC|Layer|infill|2026-10-30/);
    const idHtml = text(render(<AgreeAndPay v={priced} busy={false} onPay={() => {}} t={id} locale="id" />, "id"));
    for (const s of ["Setujui harga Rp57.000", "Selesai paling lambat 30 Okt 2026", "PLA · Hitam", "Setiap buah dicek ukuran, warna, hasil akhir, dan fungsinya sebelum diserahkan."]) {
      expect(idHtml).toContain(s);
    }
    expect(html).toContain('class="cust-check"');
  });

  it("mainnet: the button names the exact real USDC that moves", () => {
    const real = { ...priced, network: { ...priced.network, isTestnet: false, name: "Arc" } } as CustomerView;
    expect(text(render(<AgreeAndPay v={real} busy={false} onPay={() => {}} t={en} locale="en" />))).toContain("Agree & pay 3.454545 USDC");
    expect(text(render(<AgreeAndPay v={real} busy={false} onPay={() => {}} t={id} locale="id" />, "id"))).toContain("Setuju & bayar 3,454545 USDC");
  });

  it("accept or reject in plain words; the size warning without jargon", () => {
    const html = text(render(<Decide defaultName="Aini" busy={false} photos={[]} onDecide={() => {}} over={{ deviation: 0.6, tolerance: 0.3 }} t={en} />));
    expect(html).toContain("Accept: Kesuni gets paid. Reject: you get your money back.");
    expect(html).toContain("Warning: the size is not as agreed.");
    expect(html).toContain("Tick the box and write your name to continue.");
    expect(html).not.toMatch(/agent|escrow|wallet|tolerance/i);
  });

  it("USDC at most 2 decimals, the visitor's decimal mark, always with ≈", () => {
    expect(usdcApprox("9.090909", "en")).toBe("≈ 9.09 USDC");
    expect(usdcApprox("9.090909", "id")).toBe("≈ 9,09 USDC");
    expect(usdcApprox("1234.5", "id")).toBe("≈ 1.234,5 USDC");
    expect(usdcApprox(10, "en")).toBe("≈ 10 USDC");
    expect(budgetApprox(idrBudget(150_000, 16_500), "en")).toBe("Rp150.000 ≈ 9.09 USDC");
    expect(budgetApprox(idrBudget(150_000, 16_500), "id")).toBe("Rp150.000 ≈ 9,09 USDC");
    expect(dayText("2026-10-30", "en")).toBe("30 Oct 2026");
    expect(dayText("2026-10-30", "id")).toBe("30 Okt 2026");
    expect(dayText("soon", "en")).toBe("soon");
  });
});

describe("a way out and a way to reach Kesuni", () => {
  it("the WhatsApp number from KESUNI_WHATSAPP: digits with the country code, or no button", () => {
    expect(whatsappNumber("62812-3456-7890")).toBe("6281234567890");
    expect(whatsappNumber("+62 812 3456 7890")).toBe("6281234567890");
    expect(whatsappNumber("0812 3456 7890")).toBe("6281234567890");
    for (const bad of [undefined, "", "call us", "123", "0000000000"]) expect(whatsappNumber(bad), String(bad)).toBeNull();
    expect(waChatLink("6281234567890", "Order ORD-020 https://x/c/abc")).toBe("https://wa.me/6281234567890?text=Order%20ORD-020%20https%3A%2F%2Fx%2Fc%2Fabc");
    expect(waShareLink("https://x/c/abc")).toBe("https://wa.me/?text=https%3A%2F%2Fx%2Fc%2Fabc");
    expect(render(<WhatsAppButton number={null} label="Chat" />)).toBe("");
    expect(render(<WhatsAppButton number="6281234567890" label="Chat Kesuni on WhatsApp" />))
      .toBe('<a class="btn-link cust-wa" href="https://wa.me/6281234567890" target="_blank" rel="noreferrer">Chat Kesuni on WhatsApp</a>');
  });

});

describe("the order form", () => {
  it("a photo or a document instead of a 3D file says what to do instead", () => {
    expect(customerDesignProblem("logo.PNG", 10)).toBe(A_PHOTO);
    expect(customerDesignProblem("IMG_1234.heic", 10)).toBe(A_PHOTO);
    expect(customerDesignProblem("brief.pdf", 10)).toBe(A_DOCUMENT);
    expect(customerDesignProblem("clip.stl", 10)).toBeNull();
    expect(id(A_PHOTO)).toBe("Ini foto, bukan file 3D. Kosongkan saja dan jelaskan barangnya di catatan.");
  });

  it("a broken STL is recognised by the same reason the 3D reader gives", () => {
    const garbage = new Uint8Array(200).fill(7);
    const r = readMesh("clip.stl", garbage);
    expect(!r.ok && r.reason).toBe(UNREADABLE);
    expect(id("This file can't be opened. Ask your designer for a new STL.")).toBe("File ini tidak bisa dibuka. Minta file STL baru ke desainer Anda.");
  });

  it("the draft keeps the material and colours and remembers there was a file (the file itself cannot be kept)", () => {
    const d = readDraft(JSON.stringify({
      name: "Aini", product: "Clip", quantity: 2, budgetIdr: "150rb", hadFile: true,
      choice: { material: "PLA", colors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }, { type: "ABS", color: "#000000" }, "x"] },
    }));
    expect(d).toEqual({
      fields: { name: "Aini", product: "Clip", budgetIdr: "150rb" }, hadFile: true,
      choice: { material: "PLA", colors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] },
    });
    expect(readDraft(JSON.stringify({ name: "A" }))).toEqual({ fields: { name: "A" }, choice: null, hadFile: false });
    expect(readDraft("not json")).toBeNull();
    expect(readDraft(null)).toBeNull();
  });
});

describe("messages from Kesuni follow the page's EN | ID switch", () => {
  const messages: CustomerView["messages"] = [
    { text: "Your price is ready. Please check and approve it on this page.", textId: "Harga sudah siap. Silakan cek dan setujui di halaman ini.", by: "agent", at: "2026-10-17T03:00:00.000Z" },
    { text: "We send photos tomorrow.", by: "human", at: "2026-10-17T04:00:00.000Z" },
  ];

  it("English, or the Indonesian when there is one; newest first", () => {
    expect(text(render(<MessagesCard messages={messages} t={en} locale="en" />, "en"))).toMatch(
      /^Messages from Kesuni K We send photos tomorrow\. from the Kesuni team · .* AI Your price is ready\. Please check and approve it on this page\. written by the Chief \(AI\) · /,
    );
    const idText = text(render(<MessagesCard messages={messages} t={id} locale="id" />, "id"));
    // A person's message without an Indonesian text, and every older message, stays in English.
    expect(idText).toMatch(/^Pesan dari Kesuni K We send photos tomorrow\. dari tim Kesuni · .* AI Harga sudah siap\. Silakan cek dan setujui di halaman ini\. ditulis oleh Chief \(AI\) · /);
    expect(idText).not.toContain("Your price is ready");
    // Each text says its language, so a screen reader reads the English one as English.
    const idHtml = render(<MessagesCard messages={messages} t={id} locale="id" />, "id");
    expect(idHtml).toMatch(/<div lang="en"[^>]*>We send photos tomorrow\.<\/div>/);
    expect(idHtml).toMatch(/<div lang="id"[^>]*>Harga sudah siap\./);
    expect(messageText({ text: "Hi.", textId: "" }, "id")).toBe("Hi.");
    expect(messageText({ text: "Hi.", textId: "Halo." }, "en")).toBe("Hi.");
    expect(render(<MessagesCard messages={[]} t={en} locale="en" />)).toBe("");
  });
});

describe("every text on the customer's pages has its Indonesian", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const literals = (src: string) => [...src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const quoted = (src: string, from: string, to: string) =>
    [...src.slice(src.indexOf(from), src.indexOf(to)).matchAll(/"([A-Z][^"]+)"/g)].map((m) => m[1]);

  it("the order page, the colour picker, the form, the portal and the printer's lines", () => {
    const page = read("src/app/c/[token]/CustomerView.tsx");
    const lib = read("src/lib/customer.ts");
    const keys = [
      ...literals(page), ...literals(read("src/app/c/ColorPicker.tsx")), ...literals(read("src/app/request/[code]/OrderForm.tsx")),
      ...literals(read("src/app/request/[code]/Portal.tsx")), ...literals(read("src/app/request/[code]/MyOrders.tsx")),
      ...literals(read("src/app/request/[code]/page.tsx")), ...literals(read("src/app/c/ModelPreview.tsx")),
      // the steps, the payment proof's lines, the printer's lines, the statuses of My orders
      ...quoted(page, "const STEPS", "/** The customer portal"), "Rejected, money back",
      ...quoted(lib, "const DEVICE_LINES", "export function deviceUpdate").filter((k) => !k.startsWith("^")),
      ...quoted(read("src/app/request/[code]/order-status.ts"), "export function orderStatus", "/** \"/c/<token>\""),
      NOT_THROUGH, PAST_DEADLINE, "The budget must be at least Rp1.000", "Paste the whole link Kesuni sent you (it starts with https://).",
    ];
    expect(keys.length).toBeGreaterThan(150);
    const same = ["Online", "Offline", "PLA", "PETG", "RUNNING", "PREPARE", "SLICING", "PAUSE", "CREATED", "PAID", "ACCEPTED", "REJECTED", "EVIDENCE_SUBMITTED", "PLAN_CHOSEN", "AWAITING_DEPOSIT"];
    expect([...new Set(keys)].filter((k) => !(k in ID) && !same.includes(k) && tLib(id, k) === k)).toEqual([]);
    expect(deviceUpdate("A1 Combo #2: started printing (Benchy)")).toBe("Printing started");
    expect(deviceUpdate("A1 Combo #2: progress 50%")).toBeNull();
  });
});
