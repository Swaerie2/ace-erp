import type { MetadataRoute } from "next";

// Client pages hold personal information and must never appear in search results.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
