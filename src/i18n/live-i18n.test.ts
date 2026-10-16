import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ID } from "./id";
import { COUNTING_RULE } from "@/lib/traction";

// The public Live studio page (/live): every English text on it has an Indonesian entry (the page opens in English).
const literals = (file: string) => [...readFileSync(path.join(process.cwd(), file), "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

describe("Live studio in Indonesian", () => {
  it("every t(\"…\") on the page, and the words it passes through t", () => {
    const keys = [
      ...literals("src/app/live/LiveStudio.tsx"), ...literals("src/app/live/page.tsx"), ...literals("src/lib/live.ts"),
      "Deposit", "Release", "Refund", "Demo top-up", "real", "simulated", "order removed", "test USDC", "Agent prints on", "Agent prints off",
      "{n} simulated order", "{n} simulated orders", "{n} test transfer", "{n} test transfers", COUNTING_RULE, "fatal", "serious", "common",
      "allowed", "not allowed", "Rules", "Code", "failed", "in progress", "Verified on Arc", "mismatch", "not checked yet",
      "Idle", "Finished", "No status yet", "never",
      // The menu (labels go through t in Tabs.tsx), and the overview's words passed through t elsewhere.
      "Overview", "Printers", "Agent", "Money on Arc", "Sections", "{n} transfer", "{n} transfers", "Claude ran {n} time today.",
      "Claude ran {n} times today.", "today", "tomorrow", "in {n} d", "{n} d late", "no valid deadline", "{h}h {m}m",
    ];
    // Words that read the same in Indonesian.
    const same = ["Online", "Offline", "USDC", "Nozzle", "target {n} °C", "Slot {n}", "Claude"];
    expect([...new Set(keys)].filter((k) => !(k in ID) && !same.includes(k))).toEqual([]);
  });
});
