import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/lib/store";
import { POST as decision } from "./orders/[id]/decision/route";
import { POST as evidence } from "./orders/[id]/evidence/route";
import { POST as acceptance } from "./orders/[id]/acceptance/route";
import { POST as intent } from "./orders/[id]/payment-intent/route";

const ctx = { params: Promise.resolve({ id: "ORD-001" }) };
const post = (body: unknown) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(resetDb);

describe("JOB-001 flow", () => {
  it("refuses the 35 USDC partner quote (mandate 32)", async () => {
    const res = await decision(post({ quoteId: "Q-partner", decidedBy: "agent", reason: "faster" }), ctx);
    expect(res.status).toBe(422);
  });

  it("blocks payment before acceptance, then pays once after full flow", async () => {
    expect((await decision(post({ quoteId: "Q-own", decidedBy: "agent", reason: "within budget" }), ctx)).status).toBe(200);
    const pay = { recipient: "0x0000000000000000000000000000000000000001", amountMicro: 30_000_000, idempotencyKey: "job1-pay" };
    expect((await intent(post(pay), ctx)).status).toBe(422);

    await evidence(post({ kind: "log", note: "printed", label: "manual" }), ctx);
    await evidence(post({ kind: "qc", note: "passed", label: "manual" }), ctx);
    expect((await acceptance(post({ accepted: true, by: "owner", note: "ok" }), ctx)).status).toBe(200);

    const first = await intent(post(pay), ctx);
    expect(first.status).toBe(201);
    const replay = await intent(post(pay), ctx);
    expect((await replay.json()).replayed).toBe(true);
    expect((await intent(post({ ...pay, idempotencyKey: "other" }), ctx)).status).toBe(422);
  });
});
