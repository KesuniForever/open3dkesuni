import { listPrinters } from "@/lib/store";
import { getLocale } from "@/i18n/server";
import { issueTexts } from "../../machines/issue-texts";
import OrderView from "./OrderView";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Bambu's words for the faults the printers report now: the table is server-only, so the page passes the few it needs.
  return <OrderView id={id} issueTexts={issueTexts(listPrinters(), await getLocale())} />;
}
