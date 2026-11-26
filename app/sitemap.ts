import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: `${SITE_URL}/how-it-works`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    { url: `${SITE_URL}/proof`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/dashboard`, lastModified, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/audit`, lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/settlement`, lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/attribution`, lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/incident`, lastModified, changeFrequency: "weekly", priority: 0.6 },
  ];
}
