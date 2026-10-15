import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { createOrder } from "./actions";
import { setSpec } from "./agreement";
import { materialConcern } from "./agent/tools";
import { choicesWith, FINISHES, specFinishing, specMaterial } from "./spec-choices";

const SPEC = { dimensions: "60 × 30 × 15 mm", toleranceMm: 0.3, color: "Black", layerMm: 0.2, infillPct: 20, promise: "Measured with a caliper" };
const order = (material?: "PLA" | "PETG") => {
  const r = createOrder({ product: "Hook", quantity: 2, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 3_000_000, label: "real", material });
  if (!r.ok) throw new Error(r.error);
  return r.order.id;
};
beforeEach(() => store.resetDb());

describe("material and finishing are choices on the spec", () => {
  it("material: PLA or PETG (any case, Bambu names too); empty is the order's material", () => {
    expect(specMaterial("", undefined, "PETG")).toBe("PETG");
    expect(specMaterial("pla", undefined, "PLA")).toBe("PLA");
    expect(specMaterial("PETG HF", undefined, "PLA")).toBe("PETG");
    expect(specMaterial("ABS", undefined, "PLA")).toBeNull();
    expect(specMaterial("ABS", "ABS", "PLA")).toBe("ABS"); // an older spec, unchanged
  });

  it("finishing: Standard, Sanded or Primed for paint, stored in English", () => {
    expect(FINISHES).toEqual(["Standard", "Sanded", "Primed for paint"]);
    expect(specFinishing("")).toBe("Standard");
    expect(specFinishing("sanded")).toBe("Sanded");
    expect(specFinishing("Standar")).toBe("Standard");
    expect(specFinishing("Glossy")).toBeNull();
    expect(specFinishing("Dicat halus", "Dicat halus")).toBe("Dicat halus");
    expect(choicesWith(FINISHES, "Dicat halus")).toEqual([...FINISHES, "Dicat halus"]);
    expect(choicesWith(FINISHES, "Sanded")).toEqual([...FINISHES]);
  });

  it("a new spec starts at the order's material; the order's material follows the spec", () => {
    const id = order("PETG");
    const r = setSpec(id, { ...SPEC, material: "", finishing: "Primed for paint" });
    expect(r.ok && r.order.spec).toMatchObject({ material: "PETG", finishing: "Primed for paint" });
    const pla = setSpec(id, { ...SPEC, material: "PLA", finishing: "Primed for paint" });
    expect(pla.ok && pla.order.material).toBe("PLA");
    // So the Chief does not see a spec that disagrees with the order.
    expect(materialConcern(store.getOrder(id)!)).toBeNull();
  });

  it("refuses another material or finishing, with reasons the form can show", () => {
    const r = setSpec(order(), { ...SPEC, material: "ABS", finishing: "Glossy" });
    expect(r).toMatchObject({ ok: false, status: 400, reasons: ["Material must be PLA or PETG", "Finishing must be Standard, Sanded or Primed for paint"] });
  });

  it("an older spec keeps its free-text values while a person saves other changes", () => {
    const id = order();
    store.saveOrder({ ...store.getOrder(id)!, spec: { ...SPEC, material: "PLA+ eSUN", finishing: "Dicat halus" } });
    const r = setSpec(id, { ...SPEC, material: "PLA+ eSUN", finishing: "Dicat halus", color: "Red" });
    expect(r.ok && r.order.spec).toMatchObject({ material: "PLA+ eSUN", finishing: "Dicat halus", color: "Red" });
  });
});
