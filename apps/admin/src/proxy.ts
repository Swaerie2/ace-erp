import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static files, the robots file and the health check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|robots.txt|api/health).*)"],
};
