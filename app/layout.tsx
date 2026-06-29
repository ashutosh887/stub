import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Fraunces } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stub — the general ledger for agent spend",
  description:
    "One budget your agents can't break. A strongly-consistent, double-entry spend ledger on Amazon Aurora DSQL.",
  metadataBase: new URL("https://trystub.vercel.app"),
  openGraph: {
    title: "Stub — the general ledger for agent spend",
    description: "One budget your agents can't break. Built on Amazon Aurora DSQL.",
    url: "https://trystub.vercel.app",
    siteName: "Stub",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
