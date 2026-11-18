import "server-only";
import { getDb, type StaffRole } from "@ace/core";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StaffSession = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
};

/**
 * Step 1 of 2: the person has typed a correct password AND has an active staff record.
 * Used by the pages that come before the second verification step.
 */
export async function getSignedInStaff(): Promise<StaffSession> {
  const supabase = await createSupabaseServerClient();
  // getUser() asks the sign-in system to confirm the session is genuine (cookies alone are not trusted).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staff = await getDb().staffUser.findUnique({ where: { id: user.id } });
  if (!staff || !staff.active) {
    await supabase.auth.signOut();
    redirect("/login?error=no-access");
  }

  return { id: staff.id, email: staff.email, name: staff.name, role: staff.role };
}

/**
 * Step 2 of 2, and the check EVERY protected page and action must call first:
 * signed in, active staff member, second verification step completed, and (optionally)
 * holds one of the allowed roles.
 *
 *   const staff = await requireStaff();                    // any staff member
 *   const staff = await requireStaff(["OWNER", "MANAGER"]); // only these roles
 */
export async function requireStaff(allowed?: readonly StaffRole[]): Promise<StaffSession> {
  const staff = await getSignedInStaff();

  const supabase = await createSupabaseServerClient();
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") {
    // Has an authenticator app set up? Ask for the code. Otherwise make them set one up.
    redirect(assurance?.nextLevel === "aal2" ? "/login/verify" : "/login/setup");
  }

  if (allowed && !allowed.includes(staff.role)) redirect("/forbidden");

  return staff;
}
