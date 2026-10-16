import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ID } from "./id";
import portal from "./id/portal";
import { PORTAL_TABS } from "@/app/request/[code]/Portal";

// The customer portal (/request/<code>): every English text on it has an Indonesian entry (the page opens in English),
// and the portal's dictionary only adds words: it never changes how another page reads in Indonesian.
const literals = (file: string) => [...readFileSync(path.join(process.cwd(), file), "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
const DIR = "src/app/request/[code]";

describe("customer portal in Indonesian", () => {
  it("every t(\"…\") on the portal, and the words it passes through t", () => {
    const keys = [
      ...literals(`${DIR}/page.tsx`), ...literals(`${DIR}/Portal.tsx`), ...literals(`${DIR}/MyOrders.tsx`),
      ...PORTAL_TABS.map((x) => x.label), "Sections",
      // the order statuses (order-status.ts) and the errors of the paste field
      "Weighing your design", "Preparing your price", "Price ready", "Processing payment", "Waiting for a printer", "Printing {pct}", "Print paused", "Quality check",
      "Your turn: check the item", "Payment still open", "Printed {printed} of {total}", "Done", "Refunding", "Refunded",
      "Paste the whole link Kesuni sent you (it starts with https://).", "This order link was not found. Please check the link from Kesuni.",
      "Connection lost. Please try again.",
      // the calculator's own reason for grams it cannot read
      "Enter the grams per piece as a number, for example 16",
      // the token gates' status words and the overall verdict
      "PASS", "NOT YET", "BLOCKED", "UNKNOWN", "ISSUANCE BLOCKED", "READY FOR LEGAL REVIEW",
    ];
    // Words that read the same in Indonesian.
    const same = ["Online", "Offline"];
    expect([...new Set(keys)].filter((k) => !(k in ID) && !same.includes(k))).toEqual([]);
  });

  it("adds only new words: no entry another dictionary file already has", async () => {
    const files = readdirSync(path.join(process.cwd(), "src/i18n/id")).filter((f) => f.endsWith(".ts") && !["index.ts", "portal.ts"].includes(f));
    const others = new Set<string>();
    for (const f of files) {
      const mod = (await import(`./id/${f.replace(/\.ts$/, "")}.ts`)) as { default?: Record<string, string> };
      for (const k of Object.keys(mod.default ?? {})) others.add(k);
    }
    expect(files.length).toBeGreaterThan(10);
    expect(Object.keys(portal).filter((k) => others.has(k))).toEqual([]);
  });
});
