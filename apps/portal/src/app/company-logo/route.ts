import { getPortalDb } from "@ace/core";
import { getLogoForClientPdf } from "@ace/core/portal";

export const dynamic = "force-dynamic";

// Public on purpose: the logo is printed on every document, and the private quote link has no sign-in.
// The page links to /company-logo?v=<version>; the version changes with every upload, so a long cache is safe.
export async function GET() {
  const logo = await getLogoForClientPdf(getPortalDb());
  if (!logo) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.format === "png" ? "image/png" : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
