import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import OrderForm from "./OrderForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Order · Open3DKesuni"), robots: { index: false, follow: false } };
}

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <OrderForm code={code} />;
}
