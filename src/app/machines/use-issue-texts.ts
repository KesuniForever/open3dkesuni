"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Printer } from "@/lib/types";
import { issueCodes, type IssueTexts } from "./printer-details";

/**
 * Bambu's fault texts come from the server page. When a poll shows a fault the page has no text for yet, re-render the
 * server part once (router.refresh keeps the client state), so the new fault gets Bambu's words too.
 */
export function useIssueTexts(printers: Pick<Printer, "snapshot">[], texts: IssueTexts): void {
  const router = useRouter();
  const asked = useRef(new Set<string>());
  const missing = issueCodes(printers).filter((c) => !(c in texts)).join(",");
  useEffect(() => {
    const fresh = missing ? missing.split(",").filter((c) => !asked.current.has(c)) : [];
    if (!fresh.length) return;
    fresh.forEach((c) => asked.current.add(c));
    router.refresh();
  }, [missing, router]);
}
