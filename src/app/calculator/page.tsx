import CostCalculator from "../components/CostCalculator";
import WeightCalculator from "../components/WeightCalculator";
import Info from "../components/Info";
import { idrPerUsdc } from "@/lib/costing";
import { pricingConfig } from "@/lib/pricing";
import { getLocale, getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function Calculator() {
  const t = await getT();
  const locale = await getLocale();
  return (
    <main className="wrap wide" lang={locale}>
      <header className="page-head">
        <div>
          <p className="eyebrow">{t("Price calculator")}</p>
          <h1>{t("The official price, per gram.")}</h1>
          <p className="page-sub">{t("Weight per piece from the slicer (Bambu Studio) × price per gram.")}</p>
        </div>
      </header>
      <WeightCalculator pricing={pricingConfig()} />
      <div className="section-head">
        <p className="eyebrow">{t("Cost check")}</p>
        <h2>
          {t("Check: know your real costs.")}{" "}
          <Info>
            {t("Only checks that the price per gram still covers the costs. The official price stays per gram (above); for a quote, open the order and enter the weight per piece there.")}
          </Info>
        </h2>
      </div>
      <CostCalculator idrPerUsdc={idrPerUsdc()} />
    </main>
  );
}
