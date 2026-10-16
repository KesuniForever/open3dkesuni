"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the server page every `seconds` while the tab is visible, and at once when the tab comes back.
 * router.refresh keeps the scroll position and any open (i) popover; no JSON API is needed. A refresh that gets an
 * HTTP error loads that error page instead (a tunnel's 502 while the server restarts), so a HEAD asks first: while
 * the server does not answer, the last data stays and the next tick tries again.
 */
export default function LiveRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await fetch(location.pathname, { method: "HEAD", cache: "no-store" });
        if (r.ok) router.refresh();
      } catch {
        // Offline: keep what is shown.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [router, seconds]);
  return null;
}
