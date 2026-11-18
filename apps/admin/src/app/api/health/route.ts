import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Used by hosting and monitoring to check the app is up. Reveals nothing sensitive. */
export function GET() {
  return NextResponse.json(
    { status: "ok", app: "admin", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
