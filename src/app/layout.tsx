import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "./components/AppShell";
import { publicNetwork } from "@/lib/network";
import { getLocale } from "@/i18n/server";
import { LocaleProvider } from "@/i18n/client";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open3DKesuni",
  description: "Order, production evidence and USDC payment for a 3D-print business.",
};

// English by default; the EN | ID switch sets the "lang" cookie for Indonesian. AppShell adds the operator sidebar
// everywhere except the customer pages (/c, /request).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const net = publicNetwork();
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <LocaleProvider locale={locale}>
          <AppShell network={{ name: net.name, isTestnet: net.isTestnet }}>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
