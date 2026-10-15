// Bambu's own words for the faults the printers report now, in the visitor's language. Server only: the table behind
// issueText is about 640 KB, so a page looks up these few texts and passes them to its client components.
import { activeIssues } from "@/lib/printer/bambu";
import { issueText } from "@/lib/printer/errors";
import type { Locale } from "@/i18n/core";
import type { Printer } from "@/lib/types";
import { infoMessages, type IssueTexts } from "./printer-details";

export function issueTexts(printers: Pick<Printer, "snapshot">[], locale: Locale): IssueTexts {
  const out: IssueTexts = {};
  for (const p of printers) {
    const s = p.snapshot;
    const issues = [...activeIssues({ hms: s?.hms, errorCode: s?.errorCode ?? 0 }), ...infoMessages(s).map((h) => ({ kind: "hms" as const, code: h.code }))];
    for (const i of issues) out[i.code] = issueText(i, locale);
  }
  return out;
}
