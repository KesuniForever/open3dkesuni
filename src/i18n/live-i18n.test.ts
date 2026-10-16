import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ID } from "./id";
import { COUNTING_RULE } from "@/lib/traction";

// The public Live studio page (/live): every English text on it has an Indonesian entry (the page opens in English).
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const literals = (file: string) => [...read(file).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
/** Texts a table passes through t: the Money tab's "How the money works" rows (text:, info:). */
const tableTexts = (file: string) => [...read(file).matchAll(/\b(?:text|info): "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
/** The Chief page's short labels in src/lib/live.ts (ALONE, PERSON), passed through t. */
const shortLabels = () => [...read("src/lib/live.ts").matchAll(/^const (?:ALONE|PERSON): Record<string, string> = \{([\s\S]*?)\n\};/gm)]
  .flatMap((m) => [...m[1].matchAll(/\w+: "((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]));

describe("Live studio in Indonesian", () => {
  it("every t(\"…\") on the page, and the words it passes through t", () => {
    const labels = shortLabels();
    expect(labels.length).toBeGreaterThan(20);
    const keys = [
      ...literals("src/app/live/LiveStudio.tsx"), ...literals("src/app/live/page.tsx"), ...literals("src/lib/live.ts"),
      ...tableTexts("src/app/live/LiveStudio.tsx"), ...labels, ...literals("src/app/components/TeamLogin.tsx"), "Token research",
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
