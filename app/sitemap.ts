import type { MetadataRoute } from "next";

const SITE_URL = "https://trystub.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: `${SITE_URL}/how-it-works`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    { url: `${SITE_URL}/dashboard`, lastModified, changeFrequency: "daily", priority: 0.6 },
  ];
}
