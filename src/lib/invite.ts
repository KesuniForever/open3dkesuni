// The private invite link (/request/<code>): only people Kesuni gave the link can open the customer portal and order.
// The code is CUSTOMER_INVITE_CODE, compared in constant time. Without it on the server no code is valid (the link is
// closed). The order route (POST /api/c) applies the same rule to the code the order form sends.
import { timingSafeEqual } from "node:crypto";

/** True only when `given` is exactly the invite code. Bytes are compared, so a code with accents cannot throw. */
export function inviteValid(given: unknown, code: string | undefined = process.env.CUSTOMER_INVITE_CODE): boolean {
  if (!code || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(code);
  return a.length === b.length && timingSafeEqual(a, b);
}
