import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WeightPricePanel from "./WeightPricePanel";
import WeightCalculator from "../../components/WeightCalculator";
import { LocaleProvider } from "@/i18n/client";
import { priceByWeight, pricingConfig, type PricingConfig } from "@/lib/pricing";
import type { Locale } from "@/i18n/core";
import type { Attachment, Order, Quote } from "@/lib/types";

// Pages render these on the server first: the texts people see before any click.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const order = (colorMode?: "single" | "multi", gramsPerUnit = 10, quantity = 7): Order => ({
  id: "ORD-9", jobId: "J", product: "Keychain", quantity, deadline: "2099-12-31", designVersion: "v1",
  mandateMicro: 100_000_000, status: "CREATED", label: "simulated",
  gramPricing: {
    gramsPerUnit, quantity, pricePerGramIdr: 1500, costPerGramIdr: 750, unitPriceIdr: 15_000, totalIdr: 105_000,
    costIdr: 52_500, source: "Bambu Studio", quoteId: "Q-9", by: "human", at: "2026-10-15T05:00:00Z", ...(colorMode ? { colorMode } : {}),
  },
});
const quote: Quote = { id: "Q-9", orderId: "ORD-9", vendorId: "own", priceMicro: 6_360_000, etaHours: 4, source: "own" };
type Extra = { attachments?: Attachment[]; agentMode?: "claude" | "rules"; agreed?: boolean; agreementChanged?: boolean; paid?: boolean; real?: boolean };
const render = (o: Order, locale: Locale = "en", pricing: PricingConfig = pricingConfig(), extra: Extra = {}) => renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <WeightPricePanel order={o} quotes={[quote]} pricing={pricing} budgetIdr={1_600_000} minMarginPct={15} busy={false} act={async () => {}}
      attachments={extra.attachments ?? []} agentMode={extra.agentMode ?? "rules"} agreed={extra.agreed ?? false} agreementChanged={extra.agreementChanged ?? false}
      paid={extra.paid ?? false} real={extra.real ?? false} />
  </LocaleProvider>,
);
const panel = (o: Order, locale: Locale = "en", pricing: PricingConfig = pricingConfig(), extra: Extra = {}) => text(render(o, locale, pricing, extra));
/** A sliced Bambu Studio file from the studio PC: one plate, its grams and how many pieces are on it. */
const sliced = (weightG: number, objects = 1, filename = "Clip.gcode.3mf"): Attachment => ({
  id: `F-${filename}`, orderId: "ORD-9", kind: "design", filename, size: 1, mime: "model/3mf", uploadedBy: "Bambu Studio (slicer)", at: "2026-10-17T01:00:00Z", storageKey: "k",
  parsed3mf: { sliced: true, printerModel: "Bambu Lab A1", nozzle: "0.4", plates: [{ index: 1, predictionSec: 1800, weightG, objects, filaments: [{ id: 1, type: "PLA", color: "#FEC600", usedG: weightG }] }] },
});
/** The order before any price by weight. */
const unpriced = (over: Partial<Order> = {}): Order => ({ ...order(), gramPricing: undefined, ...over });

describe("order page: price by weight panel", () => {
  it("shows the colour, the print time and when it is ready, not the old 24 h rule", () => {
    const en = panel(order("multi"));
    expect(en).toMatch(/Multi colour · ETA 4 h/);
    // 7 pieces on 3 printers = 3 rounds × 10 g × 5–15 min = 150–450 min
    expect(en).toMatch(/Print time 2\.5–7\.5 h \(10 g × 5–15 min\/g, 3 rounds on 3 printers\)/);
    expect(en).toMatch(/Ready in ± 9 hours \(print time \+ 1 h to collect, check and pack\)/);
    expect(en).not.toMatch(/24 h|g\/h|Estimated time/);
  });

  it("an order priced before the colour mode existed reads as single colour", () => {
    const en = panel(order());
    expect(en).toMatch(/Single colour · ETA 4 h/);
    expect(en).toMatch(/Print time 1\.5–2\.5 h \(10 g × 3–5 min\/g, 3 rounds on 3 printers\)/);
  });

  it("in Indonesian", () => {
    const id = panel(order("multi"), "id");
    expect(id).toMatch(/Multi warna · ETA 4 jam/);
    expect(id).toMatch(/Waktu cetak 2,5–7,5 jam \(10 g × 5–15 mnt\/g, 3 putaran di 3 printer\)/);
    expect(id).toMatch(/Siap dalam ± 9 jam \(waktu cetak \+ 1 jam untuk ambil, cek, dan kemas\)/);
  });

  it("a long job has one note after ready in, not two parentheses in a row", () => {
    // 20 pieces on 3 printers = 7 rounds × 500 g × 5 min = 17.500 min → 292 h, + 1 h
    const en = panel(order("single", 500, 20));
    expect(en).toMatch(/Ready in ± 293 hours · about 12\.2 days \(print time \+ 1 h to collect, check and pack\)/);
    expect(en).not.toMatch(/\) \(/);
    const id = panel(order("single", 500, 20), "id");
    expect(id).toMatch(/Siap dalam ± 293 jam · sekitar 12,2 hari \(waktu cetak \+ 1 jam untuk ambil, cek, dan kemas\)/);
  });

  it("one printer: 'on 1 printer', not 'on 1 printers'", () => {
    const en = panel(order("single"), "en", { ...pricingConfig(), printerCount: 1 });
    expect(en).toMatch(/7 rounds on 1 printer\)/);
    expect(en).not.toMatch(/1 printers/);
  });
});

describe("order page: step 3 · Price", () => {
  it("the price in one line, who priced it, and where the customer is: agreed, paid", () => {
    const en = panel(order());
    expect(en).toMatch(/^ Price: Rp15\.000 per piece × 7 = Rp105\.000 10 g per piece · priced by the operator · 15 Oct, 12:00 Waiting for the customer to agree Test order: no payment needed/);
    expect(panel(order(), "en", pricingConfig(), { agreed: true, paid: true, real: true })).toMatch(/Customer agreed ✓ Paid ✓/);
    expect(panel(order(), "en", pricingConfig(), { real: true })).toMatch(/Waiting for the customer to agree Not paid yet/);
    const changed = { ...order(), agreement: { version: 2, hash: "h", by: "Aini", at: "2026-10-15T05:00:00Z" } } as Order;
    expect(panel(changed, "en", pricingConfig(), { agreementChanged: true })).toMatch(/The spec or price changed after the customer approved version 2\. They must approve again before paying\./);
    // The formula, the source and the hand form are folded away, still there.
    expect(render(order())).toMatch(/<summary>Type the grams by hand<\/summary>/);
    expect(render(order())).toMatch(/<summary>Price details<\/summary>/);
    expect(panel(order(), "id", pricingConfig(), { agreed: true })).toMatch(/^ Harga: Rp15\.000 per buah × 7 = Rp105\.000 10 g per buah · dihitung oleh operator · 15 Okt.* Pelanggan setuju ✓ Pesanan uji: tidak perlu bayar/);
  });

  it("priced within the budget and no plan yet: Run agent in step 3 (primary in rules mode); none over the budget or once chosen", () => {
    expect(render(order(), "en", pricingConfig(), { agentMode: "rules" })).toMatch(/<div class="row op-plan"><button class="primary">Run agent<\/button><\/div>/);
    expect(render(order(), "en", pricingConfig(), { agentMode: "claude" })).toMatch(/<div class="row op-plan"><button>Run agent<\/button><\/div>/);
    // Every quote above the budget: the customer's page offers to raise it, nothing to run.
    expect(render({ ...order(), mandateMicro: 1_000_000 })).not.toMatch(/Run agent/);
    expect(render({ ...order(), chosenQuoteId: "Q-9" })).not.toMatch(/Run agent/);
  });

  it("ORD-005: the price's grams and the newest slice's differ by more than 10 %: a warning", () => {
    const o = order("single", 270, 2);
    expect(panel(o, "en", pricingConfig(), { attachments: [sliced(55.29)] }))
      .toMatch(/The price uses 270 g per piece, but the newest slice weighs 55\.29 g per piece\. Check which is right before the customer pays\./);
    // Within 10 %: nothing. Four pieces on the plate: the slice's grams per piece.
    expect(panel(order("single", 10), "en", pricingConfig(), { attachments: [sliced(10.5)] })).not.toMatch(/newest slice weighs/);
    expect(panel(order("single", 10, 4), "en", pricingConfig(), { attachments: [sliced(40, 4)] })).not.toMatch(/newest slice weighs/);
    expect(panel(o, "id", pricingConfig(), { attachments: [sliced(55.29)] })).toMatch(/Harga memakai 270 g per buah, tapi slice terbaru beratnya 55,29 g per buah\./);
    // Once the customer paid, or after QC, it changes nothing any more: no warning.
    expect(panel(o, "en", pricingConfig(), { attachments: [sliced(55.29)], paid: true, real: true })).not.toMatch(/newest slice weighs/);
    expect(panel({ ...o, status: "PAID" }, "en", pricingConfig(), { attachments: [sliced(55.29)] })).not.toMatch(/newest slice weighs/);
  });

  it("no price yet: one button from the slice, for the Chief (Claude) or a person (rules)", () => {
    const o = unpriced({ quantity: 2 });
    const claude = render(o, "en", pricingConfig(), { attachments: [sliced(12.5)], agentMode: "claude" });
    expect(text(claude)).toMatch(/^ From the slice: 12\.5 g per piece \(Clip\.gcode\.3mf\) Send 12\.5 g to the Chief Type the grams by hand/);
    expect(claude).toMatch(/<button class="primary">Send 12\.5 g to the Chief<\/button>/);
    expect(claude).not.toMatch(/Make the price:/);
    const r = priceByWeight(12.5, 2, "single", pricingConfig());
    const total = r.ok ? "Rp" + r.price.totalIdr.toLocaleString("id-ID") : "?";
    const rules = render(o, "en", pricingConfig(), { attachments: [sliced(12.5)], agentMode: "rules" });
    expect(rules).toContain(`<button class="primary">Make the price: ${total}</button>`);
    expect(rules).not.toMatch(/<button class="primary">Send/);
    // The hand form starts with the slice's grams and source, without example placeholders.
    expect(rules).toMatch(/value="12\.5"/);
    expect(rules).toMatch(/value="Bambu Studio sliced file Clip\.gcode\.3mf, plate 1"/);
    expect(rules).not.toMatch(/placeholder="16"|Bambu Studio, plate 1, 0\.2 mm/);
    expect(text(rules)).toMatch(/Make the price myself Send the grams to the Chief/);
    // No slice yet: where the weight comes from; the hand form says what is missing.
    const none = panel(o);
    expect(none).toMatch(/^ Slice the model first \(step 2\) to get its weight\./);
    expect(none).toMatch(/Fill in the grams and where they come from\./);
    // The Chief already has the grams (Claude mode): it prices, no button.
    const withGrams = unpriced({ slicerGrams: { gramsPerUnit: 12.5, source: "s", by: "slicer", at: "2026-10-15T05:00:00Z" } });
    const chief = panel(withGrams, "en", pricingConfig(), { attachments: [sliced(12.5)], agentMode: "claude" });
    expect(chief).toMatch(/^ The Chief is pricing it with 12\.5 g per piece from the slice\./);
    expect(chief).not.toMatch(/Send 12\.5 g to the Chief/);
    expect(panel(o, "id", pricingConfig(), { attachments: [sliced(12.5)], agentMode: "claude" })).toMatch(/^ Dari hasil slice: 12,5 g per buah \(Clip\.gcode\.3mf\) Kirim 12,5 g ke Chief/);
  });

  it("once a plan is chosen: no button and no hand form", () => {
    const en = panel(unpriced({ status: "PLAN_CHOSEN" }), "en", pricingConfig(), { attachments: [sliced(12.5)], agentMode: "rules" });
    expect(en).not.toMatch(/Make the price|Send .* to the Chief|Type the grams by hand/);
    expect(en).toMatch(/Quotes are closed once a plan is chosen\./);
  });
});

describe("calculator: price per gram card", () => {
  const card = (locale: Locale, pricing: PricingConfig = pricingConfig()) => text(renderToStaticMarkup(
    <LocaleProvider locale={locale}><WeightCalculator pricing={pricing} /></LocaleProvider>,
  ));

  it("starts on single colour, 16 g: 48–80 min, ready in ± 3 hours", () => {
    const en = card("en");
    expect(en).toMatch(/Single colour Multi colour/);
    expect(en).toMatch(/Print time 48 min – 1\.3 h Ready in ± 3 hours/);
    expect(en).toMatch(/Single colour: 3–5 min of printing per gram\. Up to 3 pieces print at the same time, one per printer\. Ready in adds 1 h to collect, check and pack\./);
    expect(en).not.toMatch(/Estimated time/);
  });

  it("in Indonesian", () => {
    const id = card("id");
    expect(id).toMatch(/Warna Satu warna Multi warna/);
    expect(id).toMatch(/Waktu cetak 48 mnt – 1,3 jam Siap dalam ± 3 jam/);
  });

  it("the colour toggle is one Tab stop: only the checked option is focusable by Tab", () => {
    const html = renderToStaticMarkup(<LocaleProvider locale="en"><WeightCalculator pricing={pricingConfig()} /></LocaleProvider>);
    const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(2);
    expect(radios[0]).toMatch(/aria-checked="true"/);
    expect(radios[0]).toMatch(/tabindex="0"/);
    expect(radios[1]).toMatch(/aria-checked="false"/);
    expect(radios[1]).toMatch(/tabindex="-1"/);
  });

  it("one printer: one piece at a time, no 'Up to 1 pieces'", () => {
    const one = { ...pricingConfig(), printerCount: 1 };
    const en = card("en", one);
    expect(en).toMatch(/Single colour: 3–5 min of printing per gram\. One piece prints at a time\. Ready in adds 1 h/);
    expect(en).not.toMatch(/1 pieces/);
    expect(card("id", one)).toMatch(/Buah dicetak satu per satu\./);
  });
});
