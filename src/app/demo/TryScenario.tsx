"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "../components/Icon";
import { useT } from "@/i18n/client";

/** "Try scenario": makes one simulated order through the engine, then opens it. */
export default function TryScenario({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/demo/${encodeURIComponent(id)}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { orderId?: string; error?: string; reasons?: string[] };
      if (body.orderId) {
        router.push(`/orders/${body.orderId}`);
        return; // stay busy while the order page opens
      }
      setError([body.error ? t(body.error) : t("Could not start ({status})", { status: res.status }), ...(body.reasons ?? []).map((r) => t(r))].join(". "));
    } catch {
      setError(t("Could not reach the app. Try again."));
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" className="demo-try" onClick={run} disabled={busy} aria-label={t("Try scenario: {title}", { title })}>
        {busy ? t("Setting up…") : t("Try scenario")}<Icon name="arrow" size={16} />
      </button>
      {error && <p className="demo-error" role="alert">{error}</p>}
    </>
  );
}
