import type { Metadata } from "next";
import OrderForm from "./OrderForm";

export const metadata: Metadata = { title: "Pesan · Open3DKesuni", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <OrderForm code={code} />;
}
