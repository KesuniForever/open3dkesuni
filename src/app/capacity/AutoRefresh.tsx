"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the server page every `seconds` while the tab is visible, so printer progress stays current. Read-only. */
export default function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
