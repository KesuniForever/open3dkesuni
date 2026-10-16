import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeT } from "./core";
import { ID } from "./id";
import { tLib } from "@/lib/lib-text";
import { describeEntry } from "@/lib/ops";
import { whyLine } from "@/lib/printer/why-text";
import type { AgentLogEntry } from "@/lib/types";

// The customer's own design: every English text on the order form, the customer's order page and the operator's
// order page, and every reason a design is refused, has an Indonesian entry (English stays the source).
const id = makeT("id", ID);
const literals = (file: string) => [...readFileSync(path.join(process.cwd(), file), "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

describe("the customer's design in Indonesian", () => {
  it("every t(\"…\") on the order form, and the new lines on the customer's and the operator's pages", () => {
    const keys = [
      ...literals("src/app/request/[code]/OrderForm.tsx"), ...literals("src/app/orders/[id]/SlicePanel.tsx"),
      "Sending your design…", "Remove file", "Weighing your design…", "Your design: {g} g per piece", "Kesuni will check your file",
      "From the customer", "Automatic slice", "automatic, for the price",
    ];
    const missing = [...new Set(keys)].filter((k) => !(k in ID) && !["Slot {n}", "Printer"].includes(k));
    expect(missing).toEqual([]);
    expect(id("Your design: {g} g per piece", { g: "16" })).toBe("Desain Anda: 16 g per buah");
  });

  it("every reason a design is refused or not weighed", () => {
    const texts = [
      "STEP files cannot be weighed here: export an STL from your CAD program", "Send your design as an STL or OBJ file",
      "Export your model as an STL or OBJ. Send a 3MF project on WhatsApp.",
      "Your design file is empty", "Your design is larger than 25 MB. Send it on WhatsApp instead.",
      "This STL file is broken or empty. Export it again and send it.", "This OBJ file is broken or empty. Export it again and send it.",
      "Your design cannot be used", "Blocked: this request came from another site.",
      "Your order could not be read. Please try again.", "The order is too long", "The request is too long",
      "Too many tries in one hour. Try again later or contact Kesuni.", "Too many designs sent in one hour. Try again later or contact Kesuni.",
      "Kesuni is receiving other designs right now. Try again in a minute.", "This order link is not valid",
      "Too many orders in one hour. Try again later or contact Kesuni.",
      "The design cannot be weighed automatically now", "The studio PC's slicer has not asked for work in the last 2 min",
      "Too many designs are being weighed: a person enters the grams", "Only an STL or OBJ is weighed automatically: a person enters the grams",
      "The design could not be stored", "Saving the file failed on the studio PC",
      "The order already has grams per unit: they stay", "The sliced design has more than one plate: a person enters the grams",
    ];
    expect(texts.filter((x) => tLib(id, x) === x)).toEqual([]);
    expect(whyLine(id, { key: "Sliced only to weigh the design: the agent slices it again to print" }))
      .toBe("Di-slice hanya untuk menimbang desain: agen men-slice ulang untuk mencetak");
  });

  it("the decision log names the customer's design and the automatic weighing", () => {
    const row = (tool: string, ok: boolean, input: object, output: object): AgentLogEntry =>
      ({ id: 1, orderId: "ORD-9", actor: "human", tool, ok, input, output, at: "2026-10-16T10:00:00.000Z" });
    expect(describeEntry(row("customer_design", true, { file: "Clip.stl" }, {}), id)).toEqual({ title: "Pelanggan mengirim desainnya", line: "Clip.stl" });
    expect(describeEntry(row("slice_request", true, { actor: "system", file: "Clip.stl", material: "PLA" }, {}), id).title).toBe("Menimbang desain pelanggan");
    expect(describeEntry(row("slicer_grams", true, { gramsPerUnit: 12.5, automatic: true }, {}), id).title).toBe("Gram dari penimbangan otomatis");
    expect(describeEntry(row("auto_weigh_result", true, { jobId: "SJ-1" }, { gramsPerUnit: 12.5 }), id).title).toBe("Desain ditimbang otomatis");
    expect(describeEntry(row("auto_weigh_result", false, { jobId: "SJ-1" }, { error: "x" }), id).title).toBe("Penimbangan otomatis: tim Kesuni mengisi gramnya");
    expect(describeEntry(row("auto_weigh", false, {}, { reasons: ["No printer"] }), id)).toEqual({ title: "Penimbangan otomatis tidak bisa dimulai", line: "No printer" });
  });
});
