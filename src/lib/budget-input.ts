// The customer's budget as people in Indonesia type it in a chat: "150rb", "1,5 jt", "Rp 150.000", "2 juta". Pure:
// the order form reads it while the customer types and shows what it means in rupiah and USDC under the field.
// Anything unclear is null (the form then asks for the amount again), never a guess.
import { parseIdr } from "./budget";

const UNITS: Record<string, number> = { rb: 1_000, ribu: 1_000, k: 1_000, jt: 1_000_000, juta: 1_000_000 };

/** "150rb" -> 150000, "1,5jt" / "1.5 juta" -> 1500000, "Rp 150.000" -> 150000; null when it is not one clear amount. */
export function parseIdrTyped(typed: string): number | null {
  const s = typed.trim().toLowerCase().replace(/^rp\.?\s*/, "");
  const m = /^(\d+)(?:[.,](\d{1,3}))?\s*(rb|ribu|k|jt|juta)$/.exec(s);
  if (m) {
    // "1,5jt" is one and a half; "1.500rb" groups thousands (1.500 × 1.000), as Indonesians write it
    const amount = m[2]?.length === 3 ? Number(m[1] + m[2]) : Number(`${m[1]}.${m[2] ?? "0"}`);
    const n = Math.round(amount * UNITS[m[3]]);
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
  }
  // "150.000,00": the cents of a whole-rupiah amount
  return parseIdr(s.replace(/,00$/, ""));
}
