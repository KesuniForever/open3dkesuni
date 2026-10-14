import type { Metadata } from "next";
import CustomerView from "./CustomerView";

export const metadata: Metadata = { title: "Your order · Open3DKesuni", robots: { index: false, follow: false } };

export default async function CustomerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CustomerView token={token} />;
}
