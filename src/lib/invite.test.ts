import { afterEach, describe, expect, it } from "vitest";
import { inviteValid } from "./invite";

// The private invite link (/request/<code>): only the exact code opens the customer portal.
afterEach(() => { delete process.env.CUSTOMER_INVITE_CODE; });

describe("invite code", () => {
  it("is valid only when it is exactly CUSTOMER_INVITE_CODE", () => {
    process.env.CUSTOMER_INVITE_CODE = "kesuni-2026-abc";
    expect(inviteValid("kesuni-2026-abc")).toBe(true);
    expect(inviteValid("kesuni-2026-ab")).toBe(false);
    expect(inviteValid("kesuni-2026-abcd")).toBe(false);
    expect(inviteValid("KESUNI-2026-ABC")).toBe(false);
    expect(inviteValid(" kesuni-2026-abc")).toBe(false);
    expect(inviteValid("")).toBe(false);
  });

  it("is closed when the server has no code", () => {
    expect(inviteValid("anything")).toBe(false);
    expect(inviteValid("", "")).toBe(false);
  });

  it("refuses what is not a string, and a code of the same length in other letters without throwing", () => {
    expect(inviteValid(undefined, "abc")).toBe(false);
    expect(inviteValid(["abc"], "abc")).toBe(false);
    expect(inviteValid(123, "123")).toBe(false);
    // Same number of characters, more bytes: a plain string-length check would make timingSafeEqual throw.
    expect(inviteValid("abé", "abc")).toBe(false);
    expect(inviteValid("abé", "abé")).toBe(true);
  });
});
