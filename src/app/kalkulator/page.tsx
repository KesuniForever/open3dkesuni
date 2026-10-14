import CostCalculator from "../components/CostCalculator";
import WeightCalculator from "../components/WeightCalculator";
import { idrPerUsdc } from "@/lib/costing";
import { pricingConfig } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default function Kalkulator() {
  return (
    <main className="wrap wide" lang="en">
      <header className="page-head">
        <div>
          <p className="eyebrow">Price calculator</p>
          <h1>The official price, per gram.</h1>
          <p className="page-sub">Weight per piece from the slicer (Bambu Studio) × price per gram. Below it: a check that the price still covers the costs.</p>
        </div>
      </header>
      <WeightCalculator pricing={pricingConfig()} />
      <div className="section-head">
        <p className="eyebrow">Cost check</p>
        <h2>Check: know your real costs.</h2>
        <p className="page-sub">
          This long calculator only checks whether the price per gram still covers the costs. The official price stays per gram (above);
          for a quote, open the order and enter the weight per piece there.
        </p>
      </div>
      <CostCalculator idrPerUsdc={idrPerUsdc()} />
    </main>
  );
}
