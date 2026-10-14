import { describe, expect, it } from "vitest";
import { isCustomerPage } from "./AppShell";

describe("isCustomerPage", () => {
  it("customer links, and the 404 of a cut-off customer link, never get the operator shell", () => {
    for (const p of ["/c", "/c/abc123", "/pesan", "/pesan/KODE"]) expect(isCustomerPage(p)).toBe(true);
  });
  it("operator pages keep the shell", () => {
    for (const p of ["/", "/orders/ORD-001", "/arc", "/review", "/kalkulator", "/cx", "/pesanan"]) expect(isCustomerPage(p)).toBe(false);
  });
});
