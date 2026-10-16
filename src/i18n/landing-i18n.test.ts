import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ID } from "./id";
import { DEMO_SCENARIOS } from "@/lib/demo";
import { SCENARIO_OUTCOMES } from "@/lib/landing";

// The landing page (/welcome): every English text on it has an Indonesian entry (the page opens in English).
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const unescape = (s: string) => s.replace(/\\"/g, '"');
const literals = (src: string) => [...src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => unescape(m[1]));
// The texts the page passes through t() from its tables (label:, text:, title:, role: and the pilot list).
const tableTexts = (src: string) => [
  ...[...src.matchAll(/\b(?:label|text|title|role): "((?:[^"\\]|\\.)*)"/g)].map((m) => unescape(m[1])),
  ...[...src.matchAll(/^ {2}"((?:[^"\\]|\\.)*)",$/gm)].map((m) => m[1]),
];

describe("Landing page in Indonesian", () => {
  it("every text on the page has a translation", () => {
    const landing = read("src/app/welcome/Landing.tsx");
    const keys = [
      ...literals(landing), ...tableTexts(landing), ...literals(read("src/app/welcome/page.tsx")),
      ...Object.values(SCENARIO_OUTCOMES), ...DEMO_SCENARIOS.flatMap((s) => [s.title, s.tag, s.line]),
    ];
    const same = ["Demo", "Printer", "Blockchain"]; // read the same in Indonesian
    expect(keys.length).toBeGreaterThan(80);
    expect([...new Set(keys)].filter((k) => !(k in ID) && !same.includes(k))).toEqual([]);
  });
});
