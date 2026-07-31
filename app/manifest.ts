import type { MetadataRoute } from "next";
import { SHORT_DESCRIPTION, SITE_NAME, SITE_URL } from "@/config/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stub: the general ledger for agent spend",
    short_name: SITE_NAME,
    description: SHORT_DESCRIPTION,
    start_url: SITE_URL,
    display: "standalone",
    background_color: "#07090d",
    theme_color: "#07090d",
    icons: [{ src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any" }],
    categories: ["developer", "finance", "productivity"],
    lang: "en",
  };
}
