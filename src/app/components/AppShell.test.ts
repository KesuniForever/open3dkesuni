import { describe, expect, it } from "vitest";
import { isCustomerPage } from "./AppShell";

describe("isCustomerPage", () => {
  it("customer links, and the 404 of a cut-off customer link, never get the operator shell", () => {
    for (const p of ["/c", "/c/abc123", "/request", "/request/CODE", "/customer"]) expect(isCustomerPage(p)).toBe(true);
  });
  it("the public Live studio page has no operator shell either (its links would only ask for the password)", () => {
    for (const p of ["/live", "/live/x"]) expect(isCustomerPage(p)).toBe(true);
  });
  it("nor does the landing page", () => {
    for (const p of ["/", "/welcome", "/welcome/x"]) expect(isCustomerPage(p)).toBe(true);
    expect(isCustomerPage("/welcomes")).toBe(false);
  });
  it("operator pages keep the shell", () => {
    for (const p of ["/dashboard", "/orders/ORD-001", "/arc", "/review", "/calculator", "/cx", "/requests", "/lives", "/machines"]) expect(isCustomerPage(p)).toBe(false);
  });
});
