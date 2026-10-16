import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeT } from "./core";
import { ID } from "./id";
import { tLib } from "@/lib/lib-text";
import { describeEntry } from "@/lib/ops";
import { whyLine } from "@/lib/printer/why-text";
import { ON_ITS_WAY_TEXT, REAL_ORDER_TEXT } from "@/lib/printer/done-debug-rules";
import { PRINT_DONE_DEBUG_TOOL } from "@/lib/printer/done-debug";
import type { AgentLogEntry } from "@/lib/types";

// "Done (debug)" on the order page: every new English text has an Indonesian entry (English stays the source).
const id = makeT("id", ID);
const src = ["PrintPanel.tsx", "OrderView.tsx"].map((f) => readFileSync(path.join(process.cwd(), "src/app/orders/[id]", f), "utf8")).join("\n");

describe("Done (debug) in Indonesian", () => {
  it("the button, the dialog and the line", () => {
    const keys = [
      "Done (debug)", "Mark the print as done?", "For testing only: nothing is printed. It is logged as a test.", "Mark done",
      "Marked done for testing by {name} · {time}", "test", "print marked done for testing (no real print)",
    ];
    for (const k of keys) expect(src.includes(`t("${k}"`), k).toBe(true); // the pages use exactly these keys
    expect(keys.filter((k) => !(k in ID))).toEqual([]);
    expect(id("Marked done for testing by {name} · {time}", { name: "Khelda", time: "16 Okt 14.05" })).toBe("Ditandai selesai untuk uji oleh Khelda · 16 Okt 14.05");
    expect(id("Done (debug)")).toBe("Selesai (debug)");
  });

  it("the refusals and the dispatcher's reason", () => {
    expect(tLib(id, REAL_ORDER_TEXT)).toBe("Hanya pesanan uji yang bisa ditandai selesai cetak tanpa mencetak");
    expect(tLib(id, ON_ITS_WAY_TEXT)).toBe("Cetakan pesanan ini sedang berjalan: hentikan dulu");
    expect(tLib(id, "Order is CREATED; only an order in production can be marked printed"))
      .toBe("Pesanan berstatus DIBUAT; hanya pesanan yang sedang diproduksi yang bisa ditandai selesai cetak");
    expect(whyLine(id, { key: "Marked printed for testing: the agent does not print it" })).toBe("Ditandai selesai cetak untuk uji: agen tidak mencetaknya");
  });

  it("the Activity audit row names the person, in both languages", () => {
    const row: AgentLogEntry = {
      id: 1, orderId: "ORD-9", actor: "human", tool: PRINT_DONE_DEBUG_TOOL, ok: true,
      input: { by: "Khelda" }, output: { status: "IN_PRODUCTION" }, at: "2026-10-16T10:00:00.000Z",
    };
    expect(describeEntry(row)).toEqual({ title: "Print marked done for testing by Khelda", line: "No real print: a test order" });
    expect(describeEntry(row, id)).toEqual({ title: "Cetakan ditandai selesai untuk uji oleh Khelda", line: "Tanpa cetak sungguhan: pesanan uji" });
  });
});
