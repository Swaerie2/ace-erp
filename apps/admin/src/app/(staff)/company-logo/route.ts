import { getDb, getLogoForPdf, MANAGEMENT } from "@ace/core";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";

// Served at exactly /company-logo (the (staff) folder is a route group and adds nothing to the address;
// a route handler does not use the staff layout). Crew get nothing here: they have no document screens.
export async function GET() {
  const staff = await requireStaff(MANAGEMENT); // every route starts with this
  const actor = await toActor(staff);
  const logo = await getLogoForPdf(getDb(), actor);
  if (!logo) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.format === "png" ? "image/png" : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      // The page links to /company-logo?v=<version>, and the version changes with every upload.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
