import { z } from "zod";
import { recordAudit } from "./audit";
import { getDb } from "./db";
import { getSupabaseAdmin } from "./supabase-admin";

export const MIN_PASSWORD_LENGTH = 12;

export const createStaffInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  name: z.string().trim().min(1, "Enter a name.").max(80),
  role: z.enum(["OWNER", "MANAGER", "CREW"]),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(128),
});

export type CreateStaffInput = z.input<typeof createStaffInput>;

/**
 * Creates a staff member in two places that must always agree: the sign-in system (email and
 * password) and our own staff table (name and role). If the second step fails, the first is
 * undone, so we never leave a half-made account behind.
 *
 * The password is only ever handed to the sign-in system. It is never stored by us or logged.
 */
export async function createStaffUser(raw: CreateStaffInput, opts: { actorId?: string } = {}) {
  const input = createStaffInput.parse(raw);
  const supabase = getSupabaseAdmin();
  const db = getDb();

  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  });
  if (error || !data.user) {
    throw new Error(`Could not create the sign-in account: ${error?.message ?? "unknown error"}`);
  }

  try {
    const staff = await db.staffUser.create({
      data: { id: data.user.id, email: input.email, name: input.name, role: input.role },
    });
    await recordAudit(db, {
      actorType: opts.actorId ? "STAFF" : "SYSTEM",
      ...(opts.actorId ? { actorId: opts.actorId } : {}),
      action: "staff.created",
      entityType: "staff_user",
      entityId: staff.id,
      after: { email: staff.email, name: staff.name, role: staff.role },
    });
    return staff;
  } catch (cause) {
    await supabase.auth.admin.deleteUser(data.user.id);
    throw cause;
  }
}
