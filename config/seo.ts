import type { Metadata } from "next";

export const SITE_URL = "https://trystub.vercel.app";
export const NPM_URL = "https://www.npmjs.com/package/trystub";
export const GITHUB_URL = "https://github.com/ashutosh887/stub";
export const BLOG_URL =
  "https://ashutosh887.hashnode.dev/building-a-budget-your-ai-agents-physically-cannot-overspend-on-aurora-dsql";

export const SITE_NAME = "Stub";
export const TITLE = "Stub: the general ledger for agent spend";
export const TAGLINE = "One budget your agents can't break.";
export const DESCRIPTION =
  "One budget your agents can't break. A strongly-consistent, double-entry spend ledger on Amazon Aurora DSQL that fails any transaction which would breach your cap. Governs paid APIs, x402 micropayments, and LLM tokens across a whole fleet of AI agents.";
export const SHORT_DESCRIPTION =
  "One budget your agents can't break. A double-entry spend ledger for AI agents, on Amazon Aurora DSQL.";

const PRODUCT_TERMS = [
  "Stub",
  "trystub",
  "agent spend ledger",
  "AI agent budget",
  "AI agent spend control",
  "AI agent cost control",
  "agent spend governance",
  "agent payment guardrails",
  "double-entry ledger",
  "spend ledger",
  "budget enforcement",
  "overspend prevention",
  "hard budget cap",
  "spend limit for AI agents",
  "LLM cost control",
  "LLM token metering",
  "token usage tracking",
  "x402 micropayments",
  "AgentCore payments",
  "exactly-once payments",
  "idempotent payments",
  "audit-grade ledger",
  "tamper-evident audit trail",
  "cost attribution",
  "chargeback and showback",
  "FinOps for AI agents",
  "AI guardrails",
];

const INTENT_QUERIES = [
  "how to limit AI agent spending",
  "how to stop AI agents overspending",
  "prevent runaway LLM costs",
  "budget cap for autonomous agents",
  "AI agent cost overrun protection",
  "track LLM token spend by team",
  "prevent double charging on retry",
  "spend limits across multiple agents",
  "audit trail for AI agent spending",
];

const TECH_TERMS = [
  "Amazon Aurora DSQL",
  "Aurora DSQL budget",
  "optimistic concurrency control",
  "SQLSTATE 40001",
  "serialization failure",
  "multi-region strong consistency",
  "active-active database",
  "PostgreSQL",
  "Next.js",
  "TypeScript SDK",
];

export const KEYWORDS = [...PRODUCT_TERMS, ...INTENT_QUERIES, ...TECH_TERMS];

export interface Faq {
  question: string;
  answer: string;
}

export const FAQS: Faq[] = [
  {
    question: "How do you stop an AI agent from overspending?",
    answer:
      "Give the whole fleet one budget and let the database enforce it. Every spend is a double-entry transaction that also decrements the budget, so one that would go below zero never commits. Alerts only tell you after the money is gone.",
  },
  {
    question: "What happens when two agents spend the same dollars at once?",
    answer:
      "One of them loses. Both read the same balance and try to write it, so Aurora DSQL commits exactly one and returns SQLSTATE 40001 to the other. Stub retries against the fresh balance, or records a denial. The balance never goes negative.",
  },
  {
    question: "Can a retry double-charge a vendor?",
    answer:
      "No. Stub reserves the estimate, pays exactly once outside the transaction, then settles the real cost and refunds the difference. Retries replay the ledger, never the payment. The SDK also keys every spend, so a retried request resolves to the same entry.",
  },
  {
    question: "Do I need an AWS account to try it?",
    answer:
      "No. Set DATABASE_URL and Stub runs on local Postgres, console and ledger included. Transactions run at SERIALIZABLE, so you hit the same 40001 conflicts as production.",
  },
  {
    question: "Does it track LLM token costs, or only API payments?",
    answer:
      "Both. The SDK holds an estimate, runs the call once, then settles the real token cost. It reads OpenAI and Anthropic usage fields. You supply the rates, because a price table shipped inside a package goes stale and quietly mis-bills you.",
  },
  {
    question: "Why Aurora DSQL instead of regular Postgres or DynamoDB?",
    answer:
      "Because the guarantee is the database's consistency model, not your code. One budget across regions needs active-active strong consistency. Aurora PostgreSQL Global is single-writer, and DynamoDB global tables are eventually consistent, so last-writer-wins means silent overspend. Stub runs on plain Postgres too, single-region.",
  },
];

const authorSchema = {
  "@type": "Person",
  "@id": `${SITE_URL}/#author`,
  name: "Ashutosh Jha",
  url: "https://github.com/ashutosh887",
  sameAs: [GITHUB_URL, "https://ashutosh887.hashnode.dev"],
};

const softwareSchema = {
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: SITE_NAME,
  alternateName: [TITLE, "trystub"],
  applicationCategory: "FinanceApplication",
  applicationSubCategory: "Developer Tools",
  operatingSystem: "Web, Node.js",
  url: SITE_URL,
  description: DESCRIPTION,
  softwareVersion: "1.1.0",
  downloadUrl: NPM_URL,
  codeRepository: GITHUB_URL,
  license: "https://opensource.org/licenses/MIT",
  featureList: [
    "Hierarchical budgets enforced in one database transaction",
    "Exactly-once settlement around irreversible payments",
    "LLM token metering with hold and settle",
    "Tamper-evident hash-chained audit trail",
    "Cost attribution, chargeback and showback",
    "Policy engine with per-transaction and rolling-window caps",
    "Velocity circuit breaker and fleet-wide kill switch",
    "Natural-language queries over the ledger",
  ],
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@id": `${SITE_URL}/#author` },
  sameAs: [NPM_URL, GITHUB_URL, BLOG_URL],
};

const websiteSchema = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: SITE_URL,
  name: SITE_NAME,
  description: SHORT_DESCRIPTION,
  inLanguage: "en",
  publisher: { "@id": `${SITE_URL}/#author` },
  about: { "@id": `${SITE_URL}/#software` },
};

const faqSchema = {
  "@type": "FAQPage",
  "@id": `${SITE_URL}/#faq`,
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

const breadcrumbSchema = {
  "@type": "BreadcrumbList",
  "@id": `${SITE_URL}/#breadcrumb`,
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "How it works", item: `${SITE_URL}/how-it-works` },
    { "@type": "ListItem", position: 3, name: "Dashboard", item: `${SITE_URL}/dashboard` },
  ],
};

export const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [authorSchema, softwareSchema, websiteSchema, faqSchema, breadcrumbSchema],
};

export const DEFAULT_METADATA: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Stub",
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Ashutosh Jha", url: "https://github.com/ashutosh887" }],
  creator: "Ashutosh Jha",
  publisher: "Stub",
  category: "technology",
  classification: "Developer Tools",
  referrer: "origin-when-cross-origin",
  keywords: KEYWORDS,
  alternates: {
    canonical: "/",
    languages: { "en-US": SITE_URL, "x-default": SITE_URL },
  },
  openGraph: {
    type: "website",
    title: TITLE,
    description: SHORT_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SHORT_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  other: {
    "apple-mobile-web-app-title": SITE_NAME,
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#07090d",
  },
};
