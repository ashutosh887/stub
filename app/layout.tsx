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

const SITE_URL = "https://trystub.vercel.app";
const NPM_URL = "https://www.npmjs.com/package/trystub";
const GITHUB_URL = "https://github.com/ashutosh887/stub";
const BLOG_URL =
  "https://ashutosh887.hashnode.dev/building-a-budget-your-ai-agents-physically-cannot-overspend-on-aurora-dsql";

const TITLE = "Stub: the general ledger for agent spend";
const DESCRIPTION =
  "One budget your agents can't break. A strongly-consistent, double-entry spend ledger on Amazon Aurora DSQL that fails any transaction which would breach your cap.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Stub",
  },
  description: DESCRIPTION,
  applicationName: "Stub",
  authors: [{ name: "Ashutosh Jha", url: "https://github.com/ashutosh887" }],
  creator: "Ashutosh Jha",
  publisher: "Stub",
  category: "technology",
  keywords: [
    "Stub",
    "agent spend ledger",
    "AI agent budget",
    "agent spend governance",
    "double-entry ledger",
    "Amazon Aurora DSQL",
    "x402 micropayments",
    "LLM cost control",
    "overspend prevention",
    "FinOps for AI agents",
    "audit-grade ledger",
    "AgentCore payments",
  ],
  openGraph: {
    type: "website",
    title: TITLE,
    description: "One budget your agents can't break. Built on Amazon Aurora DSQL.",
    url: SITE_URL,
    siteName: "Stub",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: "One budget your agents can't break. Built on Amazon Aurora DSQL.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Stub",
  alternateName: "Stub: the general ledger for agent spend",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description: DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: "Ashutosh Jha", url: "https://github.com/ashutosh887" },
  sameAs: [NPM_URL, GITHUB_URL, BLOG_URL],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
