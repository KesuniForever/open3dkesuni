import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WeightPricePanel from "./WeightPricePanel";
import WeightCalculator from "../../components/WeightCalculator";
import { LocaleProvider } from "@/i18n/client";
import { pricingConfig, type PricingConfig } from "@/lib/pricing";
import type { Locale } from "@/i18n/core";
import type { Order, Quote } from "@/lib/types";

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
const panel = (o: Order, locale: Locale = "en", pricing: PricingConfig = pricingConfig()) => text(renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <WeightPricePanel order={o} quotes={[quote]} pricing={pricing} budgetIdr={1_600_000} minMarginPct={15} busy={false} act={async () => {}} />
  </LocaleProvider>,
));

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
