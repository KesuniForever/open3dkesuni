"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Writes (or rewrites) a day's review now. The Chief uses Claude when it is on, else the code template. */
export default function ReviewButton({ day, label = "Buat review sekarang" }: { day?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/daily-review", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(day ? { day } : {}),
      });
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "Could not write the review");
      else router.push(`/review?day=${j.review.day}`);
      router.refresh();
    } catch {
      setError("Network error. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <button className="primary" onClick={() => void run()} disabled={busy}>{busy ? "Writing… (Claude can take a minute)" : label}</button>
      {error && <span className="alert bad" style={{ margin: 0 }}>{error}</span>}
    </span>
  );
}
