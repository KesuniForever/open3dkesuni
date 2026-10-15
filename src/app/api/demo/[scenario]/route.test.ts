import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { POST } from "./route";

const ctx = (scenario: string) => ({ params: Promise.resolve({ scenario }) });
const req = () => new Request("http://x/api/demo", { method: "POST" });

beforeEach(() => store.resetDb());

describe("POST /api/demo/<scenario>", () => {
  it("makes one simulated order and returns its id", async () => {
    const n = store.listOrders().length;
    const res = await POST(req(), ctx("smooth"));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { orderId: string; steps: string[] };
    expect(store.listOrders()).toHaveLength(n + 1);
    expect(store.getOrder(body.orderId)).toMatchObject({ label: "simulated", status: "PLAN_CHOSEN", customerName: "Demo: smooth order" });
    expect(body.steps.length).toBeGreaterThan(1);
  });

  it("refuses an unknown scenario and makes nothing", async () => {
    const n = store.listOrders().length;
    const res = await POST(req(), ctx("refund-twice"));
    expect(res.status).toBe(404);
    expect(store.listOrders()).toHaveLength(n);
  });
});
