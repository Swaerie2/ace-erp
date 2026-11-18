import type { MetadataRoute } from "next";

// Nothing in the staff area should ever appear in search results.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
