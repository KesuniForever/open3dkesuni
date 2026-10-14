import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "./components/AppShell";
import { publicNetwork } from "@/lib/network";

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

// The whole site is English (lang="en" here). AppShell adds the operator sidebar everywhere except the customer pages
// (/c, /pesan).
export default function RootLayout({ children }: LayoutProps<"/">) {
  const net = publicNetwork();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AppShell network={{ name: net.name, isTestnet: net.isTestnet }}>{children}</AppShell>
      </body>
    </html>
  );
}
