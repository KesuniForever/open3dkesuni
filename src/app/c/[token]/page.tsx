import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { whatsappNumber } from "../whatsapp";
import CustomerView from "./CustomerView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Your order · Open3DKesuni"), robots: { index: false, follow: false } };
}

export default async function CustomerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The studio's WhatsApp for "Chat Kesuni on WhatsApp" (no number: no button).
  return <CustomerView token={token} whatsapp={whatsappNumber(process.env.KESUNI_WHATSAPP)} />;
}
