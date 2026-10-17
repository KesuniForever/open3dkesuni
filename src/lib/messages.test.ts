import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { chooseQuote, createOrder, ensureCustomerToken } from "./actions";
import { quoteByWeight } from "./agreement";
import { customerView } from "./customer";
import { AGENT_MESSAGES_PER_ORDER, amountsIn, messageContentReasons, postCustomerMessage } from "./messages";
import { tLib } from "./lib-text";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";
import { POST } from "@/app/api/orders/[id]/messages/route";

const ORDER = "ORD-001";
const T0 = new Date("2026-10-14T03:00:00Z");
const later = (min: number) => new Date(T0.getTime() + min * 60_000);

beforeEach(store.resetDb);

describe("customer message guards", () => {
  it("allows a plain update with the agreed price, dates, times and the order id", () => {
    expect(messageContentReasons("Harga sudah siap: Rp1.200.000 (50 × Rp24.000). Silakan cek dan setujui di halaman ini.")).toEqual([]);
    expect(messageContentReasons("Pesanan ORD-001 mulai dicetak, perkiraan selesai 2026-10-20 15.00 WIB.")).toEqual([]);
    expect(messageContentReasons("Cetakan dijeda pukul 08.00-10.00 untuk ganti filament.")).toEqual([]);
  });

  it.each([
    ["link", "Bayar lebih cepat di https://bayar.example"],
    ["www link", "Lihat www.kesuni-promo.net"],
    ["bare domain", "Konfirmasi lewat kesuni-bayar.com ya"],
    ["short link", "Info: bit.ly/abc"],
    ["wa.me link", "Chat kami di wa.me/6281234567890"],
    ["wallet address", "Kirim USDC ke 0x1111111111111111111111111111111111111111"],
    ["phone", "Hubungi 0812-3456-7890 untuk diskon"],
    ["phone with country code", "WA +62 812 3456 7890"],
    ["phone glued to letters", "WA081234567890"],
    ["email", "Kirim bukti ke admin@kesuni.studio"],
  ])("refuses a %s, in the English or the Indonesian text", (_kind, text) => {
    expect(messageContentReasons(text).length).toBeGreaterThan(0);
    expect(postCustomerMessage(ORDER, { text, textId: "Pesananmu sudah masuk." }, "agent", T0).ok).toBe(false);
    const r = postCustomerMessage(ORDER, { text: "Your order is in.", textId: text }, "agent", T0);
    expect(!r.ok && r.reasons?.[0]).toMatch(/^In the Indonesian text: No /);
    expect(postCustomerMessage(ORDER, { text: "Your order is in.", textId: text }, "human", T0).ok).toBe(false);
    expect(store.listMessages(ORDER)).toHaveLength(0);
  });

  it("trims, needs 1..500 characters, and the order must exist", () => {
    expect(postCustomerMessage(ORDER, "   ", "human").ok).toBe(false);
    expect(postCustomerMessage(ORDER, "a".repeat(501), "human").ok).toBe(false);
    expect(postCustomerMessage(ORDER, { text: "Hi.", textId: "a".repeat(501) }, "human")).toMatchObject({
      ok: false, reasons: ["In the Indonesian text: Message is longer than 500 characters"],
    });
    expect(postCustomerMessage("ORD-404", "Halo", "human")).toMatchObject({ ok: false, status: 404 });
    const r = postCustomerMessage(ORDER, "  Pesananmu sudah kami terima.  ", "human");
    expect(r.ok && r.message.text).toBe("Pesananmu sudah kami terima.");
  });

  it("refuses an exact repeat of the last message, in either language", () => {
    expect(postCustomerMessage(ORDER, "Sedang dicetak.", "human", T0).ok).toBe(true);
    expect(postCustomerMessage(ORDER, "Sedang dicetak.", "human", later(60))).toMatchObject({ ok: false, reasons: ["Same text as the last message"] });
    expect(postCustomerMessage(ORDER, { text: "Sedang dicetak.", textId: "Lagi dicetak." }, "agent", later(60)).ok).toBe(false);
    expect(postCustomerMessage(ORDER, { text: "Printing now.", textId: "Lagi dicetak." }, "agent", later(60)).ok).toBe(true);
    expect(postCustomerMessage(ORDER, { text: "Still printing.", textId: "Lagi dicetak." }, "agent", later(80)))
      .toMatchObject({ ok: false, reasons: ["In the Indonesian text: Same text as the last message"] });
  });

  it("a repeat is what the customer reads: a message without Indonesian shows its English on the Indonesian page", () => {
    // A person wrote Indonesian in the English box; the Chief's Indonesian says the same: twice in a row in Indonesian.
    expect(postCustomerMessage(ORDER, "Harga sudah siap, silakan cek.", "human", T0).ok).toBe(true);
    expect(postCustomerMessage(ORDER, { text: "Your price is ready, please check.", textId: "Harga sudah siap, silakan cek." }, "agent", later(1)))
      .toMatchObject({ ok: false, reasons: ["In the Indonesian text: Same text as the last message"] });
    expect(postCustomerMessage(ORDER, { text: "Your price is ready, please check.", textId: "Harganya sudah siap, silakan dicek." }, "agent", later(1)).ok).toBe(true);
    // The other way round: a person's English-only text equal to the last Indonesian one.
    expect(postCustomerMessage(ORDER, "Harganya sudah siap, silakan dicek.", "human", later(2)))
      .toMatchObject({ ok: false, reasons: ["Same text as the last message"] });
    expect(store.listMessages(ORDER)).toHaveLength(2);
  });

  it("the Chief writes in English and Indonesian: no Indonesian, or the English again, is refused; a person may write English only", () => {
    expect(postCustomerMessage(ORDER, "Your price is ready.", "agent", T0)).toMatchObject({ ok: false, reasons: ["Write the message in Indonesian too (textId)"] });
    expect(postCustomerMessage(ORDER, { text: "Your price is ready.", textId: "  " }, "agent", T0).ok).toBe(false);
    expect(postCustomerMessage(ORDER, { text: "Your price is ready.", textId: "Your price is ready." }, "agent", T0))
      .toMatchObject({ ok: false, reasons: ["textId must be the message in Indonesian, not the English text again"] });
    const r = postCustomerMessage(ORDER, { text: " Your price is ready. ", textId: " Harga sudah siap. " }, "agent", T0);
    expect(r.ok && [r.message.text, r.message.textId]).toEqual(["Your price is ready.", "Harga sudah siap."]);
    const p = postCustomerMessage(ORDER, "We check the design first.", "human", later(1));
    expect(p.ok && p.message).not.toHaveProperty("textId");
    expect(store.listLog(ORDER).find((e) => e.tool === "message_customer")!.input).toEqual({ text: "We check the design first." });
    postCustomerMessage(ORDER, { text: "Done.", textId: "Selesai." }, "human", later(2));
    expect(store.listLog(ORDER).filter((e) => e.tool === "message_customer").at(-1)!.input).toEqual({ text: "Done.", textId: "Selesai." });
  });

  it("a refusal about the Indonesian text reads in Indonesian on the operator's page", () => {
    const id = makeT("id", ID);
    expect(tLib(id, "In the Indonesian text: No links or web addresses in customer messages"))
      .toBe("Di teks bahasa Indonesia: Tidak boleh ada link atau alamat web di pesan ke pelanggan");
    expect(tLib(id, "In the Indonesian text: Message is longer than 500 characters")).toBe("Di teks bahasa Indonesia: Pesan lebih dari 500 karakter");
    expect(tLib(makeT("en", ID), "In the Indonesian text: Message is empty")).toBe("In the Indonesian text: Message is empty");
    expect(tLib(id, "Write the message in Indonesian too (textId)")).toBe("Tulis pesannya juga dalam bahasa Indonesia (textId)");
    expect(tLib(id, "textId must be the message in Indonesian, not the English text again"))
      .toBe("textId harus berisi pesan dalam bahasa Indonesia, bukan teks bahasa Inggris yang sama");
    expect(tLib(id, "In the Indonesian text: Same text as the last message")).toBe("Di teks bahasa Indonesia: Teks sama dengan pesan terakhir");
    // The money guard's reasons, inside the wrapper too.
    expect(tLib(id, "In the Indonesian text: Amounts must be the order's price (Rp450.000, 28,125 USDC); not 28.125 USDC"))
      .toBe("Di teks bahasa Indonesia: Jumlah uang harus harga pesanan (Rp450.000, 28,125 USDC); bukan 28.125 USDC");
    expect(tLib(id, "In the Indonesian text: The Chief may not write \"Diskon\": price changes, discounts and refunds are for people"))
      .toBe("Di teks bahasa Indonesia: Chief tidak boleh menulis \"Diskon\": perubahan harga, diskon, dan refund diputuskan orang");
    expect(tLib(id, "This order has no price yet: name no amount")).toBe("Pesanan ini belum punya harga: jangan sebut jumlah uang");
  });

  it("the agent writes at most once per order every 10 minutes; people are not rate limited", () => {
    expect(postCustomerMessage(ORDER, { text: "Your price is ready.", textId: "Harga sudah siap." }, "agent", T0).ok).toBe(true);
    expect(postCustomerMessage(ORDER, { text: "Your payment arrived.", textId: "Pembayaran sudah masuk." }, "agent", later(9))).toMatchObject({ ok: false, status: 429 });
    expect(postCustomerMessage(ORDER, "Kami cek desainnya dulu.", "human", later(1)).ok).toBe(true);
    expect(postCustomerMessage(ORDER, "Desain sudah dicek.", "human", later(2)).ok).toBe(true);
    expect(postCustomerMessage(ORDER, { text: "Your payment arrived.", textId: "Pembayaran sudah masuk." }, "agent", later(10)).ok).toBe(true);
    expect(store.listMessages(ORDER).map((m) => m.by)).toEqual(["agent", "human", "human", "agent"]);
  });

  it("the agent writes at most 20 messages per order", () => {
    for (let i = 0; i < AGENT_MESSAGES_PER_ORDER; i++) {
      expect(postCustomerMessage(ORDER, { text: `Update ${i + 1}.`, textId: `Kabar ke-${i + 1}.` }, "agent", later(i * 11)).ok).toBe(true);
    }
    const r = postCustomerMessage(ORDER, { text: "One more.", textId: "Satu lagi." }, "agent", later(1000));
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect(postCustomerMessage(ORDER, "Dari tim Kesuni.", "human", later(1000)).ok).toBe(true);
  });

  it("a person's message is logged; the agent's is logged by its tool call", () => {
    postCustomerMessage(ORDER, "Halo dari tim.", "human");
    expect(store.listLog(ORDER).find((e) => e.tool === "message_customer")).toMatchObject({ actor: "human", ok: true });
  });
});

describe("operator API POST /api/orders/[id]/messages", () => {
  const post = (id: string, body: unknown) =>
    POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

  it("posts as a person, refuses links, and never lets a person write as the agent", async () => {
    const ok = await post(ORDER, { text: "Barang siap diambil besok.", by: "human" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).message).toMatchObject({ by: "human", text: "Barang siap diambil besok." });
    expect((await post(ORDER, { text: "Cek www.promo.com" })).status).toBe(422);
    expect((await post(ORDER, { text: "Ready tomorrow.", textId: "Cek www.promo.com" })).status).toBe(422);
    expect((await post(ORDER, { text: "Saya Chief", by: "agent" })).status).toBe(400);
    expect((await post("ORD-404", { text: "Halo" })).status).toBe(404);
    expect(store.listMessages(ORDER).map((m) => m.by)).toEqual(["human"]);
    // An optional Indonesian text.
    const both = await post(ORDER, { text: "Ready tomorrow.", textId: "Siap besok." });
    expect((await both.json()).message).toMatchObject({ by: "human", text: "Ready tomorrow.", textId: "Siap besok." });
  });
});

describe("the Chief names no amount but the order's price, and promises no discount or refund", () => {
  beforeEach(() => { process.env.IDR_PER_USDC = "16000"; });
  afterEach(() => { delete process.env.IDR_PER_USDC; });

  it("reads rupiah and USDC the ways people write them", () => {
    expect(amountsIn("Rp450.000, Rp 1.200.000, Rp450rb, 450 ribu, Rp1,5 juta and 450.000 rupiah.")).toEqual({
      idr: [450_000, 1_200_000, 450_000, 1_500_000, 450_000, 450_000], usdc: [],
    });
    expect(amountsIn("28.125 USDC, 15.15 test USDC, USDC 1,000.50, US$9.09").usdc).toEqual([28.125, 15.15, 1000.5, 9.09]);
    expect(amountsIn("ORD-007: 50 pcs, about 6 hours, 2026-10-20, 3 kg")).toEqual({ idr: [], usdc: [] });
    // Cents, extra spaces, USD and the "k" shorthand; an amount it cannot read is NaN (no price matches it).
    expect(amountsIn("Rp 99.000,00, Rp1.234.567,89, 1.000,50 USDC, Rp  99.000, USD 5, 5 dollars, 450k, Rp1.2.3")).toEqual({
      idr: [99_000, 1_234_567.89, 99_000, NaN, 450_000], usdc: [1000.5, 5, 5],
    });
  });

  it("an amount written another way is checked the same, and one code cannot read is refused", () => {
    const q = quoteByWeight(ORDER, { gramsPerUnit: 300, source: "Bambu Studio", by: "human" }); // Rp450.000
    if (!q.ok) throw new Error(q.error);
    expect(chooseQuote(ORDER, q.quote.id, "human", "by weight").ok).toBe(true);
    const ok = "Cek halaman ini ya.";
    for (const text of ["Your price is Rp 400.000,00.", "Only 400k today.", "Pay USD 5 now.", "Your price: IDR  400.000"]) {
      expect(postCustomerMessage(ORDER, { text, textId: ok }, "agent", T0)).toMatchObject({ ok: false, reasons: [expect.stringMatching(/^Amounts must be the order's price/)] });
    }
    for (const textId of ["Harganya Rp 400.000,00.", "Cuma 400 ribu hari ini.", "Harganya Rp400rb."]) {
      expect(postCustomerMessage(ORDER, { text: "Please check this page.", textId }, "agent", T0))
        .toMatchObject({ ok: false, reasons: [expect.stringMatching(/^In the Indonesian text: Amounts must be the order's price/)] });
    }
    expect(postCustomerMessage(ORDER, { text: "Your price is Rp4.50.000.", textId: ok }, "agent", T0)).toMatchObject({
      ok: false, reasons: [expect.stringMatching(/; not an amount written in a way code cannot check$/)],
    });
    expect(postCustomerMessage(ORDER, {
      text: "Your price is ready: Rp 450.000,00 (450k). Please check and approve it on this page.",
      textId: "Harga sudah siap: Rp450.000 (450 ribu). Silakan cek dan setujui di halaman ini.",
    }, "agent", T0).ok).toBe(true);
  });

  it("before a price nothing; then only the price by weight (unit or total) or the chosen quote; never free or diskon", () => {
    // The probe from the review: a made-up price and a promise of free goods.
    expect(postCustomerMessage(ORDER, { text: "Only Rp1.000 today, free if you pay now!", textId: "Cuma Rp1.000 hari ini, gratis kalau bayar sekarang!" }, "agent", T0))
      .toMatchObject({
        ok: false, reasons: [
          expect.stringMatching(/may not write "free"/), "This order has no price yet: name no amount",
          expect.stringMatching(/^In the Indonesian text: The Chief may not write "gratis"/), "In the Indonesian text: This order has no price yet: name no amount",
        ],
      });
    const q = quoteByWeight(ORDER, { gramsPerUnit: 300, source: "Bambu Studio", by: "human" }); // Rp450.000
    if (!q.ok) throw new Error(q.error);
    expect(chooseQuote(ORDER, q.quote.id, "human", "by weight").ok).toBe(true);
    expect(postCustomerMessage(ORDER, { text: "Your price is Rp400.000.", textId: "Harganya Rp450.000." }, "agent", T0)).toMatchObject({
      ok: false, reasons: [expect.stringMatching(/^Amounts must be the order's price \(Rp450\.000, 28\.125 USDC\); not Rp400\.000$/)],
    });
    // A discount only in the Indonesian text is refused all the same.
    expect(postCustomerMessage(ORDER, { text: "10% off if you pay today.", textId: "Diskon 10% kalau bayar hari ini." }, "agent", T0))
      .toMatchObject({ ok: false, reasons: [expect.stringMatching(/^In the Indonesian text: The Chief may not write "Diskon"/)] });
    expect(postCustomerMessage(ORDER, { text: "If you reject it, you get a refund.", textId: "Kalau ditolak, uang kembali." }, "agent", T0).ok).toBe(false);
    // A refund or "free" promised only in the Indonesian text, under a clean English one.
    for (const [textId, word] of [
      ["Kalau ditolak, uang kembali penuh.", "uang kembali"], ["Dana akan dikembalikan.", "dikembalikan"],
      ["Pengembalian dana sedang diproses.", "Pengembalian"], ["Ongkir cuma-cuma.", "cuma-cuma"], ["Cetak ulang tanpa biaya.", "tanpa biaya"],
    ]) {
      expect(postCustomerMessage(ORDER, { text: "If you reject it, we will sort it out.", textId }, "agent", T0)).toMatchObject({
        ok: false, reasons: [`In the Indonesian text: The Chief may not write "${word}": price changes, discounts and refunds are for people`],
      });
    }
    expect(postCustomerMessage(ORDER, {
      text: "Your price is ready: Rp450.000 (28.125 USDC). Please check and approve it on this page.",
      textId: "Harga sudah siap: Rp450.000. Silakan cek dan setujui di halaman ini.",
    }, "agent", T0).ok).toBe(true);
    // USDC in the Indonesian text as an Indonesian reads it: "28,125" is the price, "28.125" twenty-eight thousand.
    const usdcIn = (textId: string) => postCustomerMessage(ORDER, { text: "Your price is ready: 28.125 USDC.", textId }, "agent", later(20));
    expect(usdcIn("Harga sudah siap: 28.125 USDC.")).toMatchObject({
      ok: false, reasons: ["In the Indonesian text: Amounts must be the order's price (Rp450.000, 28,125 USDC); not 28.125 USDC"],
    });
    expect(amountsIn("28.125 USDC, 28,125 USDC, 1,5 USDC, US$ 9,09", "id").usdc).toEqual([28_125, 28.125, 1.5, 9.09]);
    expect(usdcIn("Harga sudah siap: Rp450.000 (28,125 USDC).").ok).toBe(true);
    // People are not limited to the price (a person may decide a discount).
    expect(postCustomerMessage(ORDER, "Diskon Rp50.000 untuk pelanggan pertama.", "human", later(1)).ok).toBe(true);
  });

  it("once the order moved on (here: the payment arrived), the Chief may write again after 2 minutes, not 10", () => {
    expect(postCustomerMessage(ORDER, { text: "Your price is ready on this page.", textId: "Harga sudah siap di halaman ini." }, "agent", T0).ok).toBe(true);
    const same = postCustomerMessage(ORDER, { text: "Still waiting for your approval.", textId: "Masih menunggu persetujuanmu." }, "agent", later(3));
    expect(same).toMatchObject({ ok: false, status: 429, retryAfter: later(10).toISOString() });
    store.saveEscrow({
      orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: T0.toISOString(),
    });
    const paid = { text: "Your payment arrived; we start printing.", textId: "Pembayaran sudah masuk, kami mulai cetak." };
    expect(postCustomerMessage(ORDER, paid, "agent", later(1))).toMatchObject({ ok: false, retryAfter: later(2).toISOString() });
    expect(postCustomerMessage(ORDER, paid, "agent", later(3)).ok).toBe(true);
    expect(store.listMessages(ORDER).map((m) => m.stage)).toEqual(["CREATED/none", "CREATED/FUNDED"]);
  });
});

describe("customer page and reset", () => {
  it("the customer sees the text in English and Indonesian, who wrote it and when; nothing else", () => {
    postCustomerMessage(ORDER, { text: "Your price is ready, please check.", textId: "Harga sudah siap, silakan cek." }, "agent", T0);
    postCustomerMessage(ORDER, "Kami tunggu ya.", "human", later(1));
    const v = customerView(store.getOrder(ORDER)!, ensureCustomerToken(ORDER)!);
    expect(v.messages).toEqual([
      { text: "Your price is ready, please check.", textId: "Harga sudah siap, silakan cek.", by: "agent", at: T0.toISOString() },
      { text: "Kami tunggu ya.", by: "human", at: later(1).toISOString() },
    ]);
    expect(JSON.stringify(v.messages)).not.toMatch(/orderId|"id"|M-\d/);
  });

  it("resetting the demo removes simulated orders' messages, never a real order's", () => {
    const real = createOrder({ product: "Casing korek", quantity: 50, deadline: "2026-10-30", designVersion: "v1", mandateMicro: 80_000_000, label: "real" });
    const realId = real.ok ? real.order.id : "";
    postCustomerMessage(ORDER, "Demo.", "human");
    postCustomerMessage(realId, "Pesanan asli.", "human");
    store.resetSimulated();
    expect(store.listMessages(ORDER)).toHaveLength(0);
    expect(store.listMessages(realId)).toHaveLength(1);
  });
});
