"use server";

import { getDb, recordAudit } from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInStaff } from "@/lib/auth";
import { requestContext } from "@/lib/request-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** `email` is handed back after a failed sign-in so the form can keep it (never the password). */
export type FormState = { error?: string; email?: string } | undefined;

const GENERIC_SIGN_IN_ERROR = "That email and password don't match.";

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(256),
});

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

/** Step 1: email and password. */
export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const typedEmail = formData.get("email");
  const email = typeof typedEmail === "string" ? typedEmail.trim().toLowerCase() : "";

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password.", email };

  const supabase = await createSupabaseServerClient();
  const ctx = await requestContext();
  const db = getDb();

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    // Never record what was typed. The same message is shown whether the email exists or not.
    await recordAudit(db, {
      actorType: "SYSTEM",
      action: "staff.sign_in_failed",
      after: { reason: error?.code ?? "unknown" },
      ...ctx,
    });
    return { error: GENERIC_SIGN_IN_ERROR, email };
  }

  const staff = await db.staffUser.findUnique({ where: { id: data.user.id } });
  if (!staff || !staff.active) {
    await supabase.auth.signOut();
    await recordAudit(db, {
      actorType: "SYSTEM",
      action: "staff.sign_in_denied",
      entityType: "auth_user",
      entityId: data.user.id,
      after: { reason: staff ? "inactive" : "no_staff_record" },
      ...ctx,
    });
    return { error: GENERIC_SIGN_IN_ERROR, email };
  }

  // The home page sends them on to the code check or the authenticator setup.
  redirect("/");
}

/** Step 2: the 6-digit code from the authenticator app. */
export async function verifyCode(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await getSignedInStaff();
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { error: "Enter the 6-digit code from your authenticator app." };

  const supabase = await createSupabaseServerClient();
  const ctx = await requestContext();
  const db = getDb();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) redirect("/login/setup");

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: code.data,
  });
  if (error) {
    await recordAudit(db, {
      actorType: "STAFF",
      actorId: staff.id,
      action: "staff.mfa_failed",
      ...ctx,
    });
    return { error: "That code isn't right or has expired. Wait for the next code and try again." };
  }

  await db.staffUser.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
  await recordAudit(db, {
    actorType: "STAFF",
    actorId: staff.id,
    action: "staff.signed_in",
    ...ctx,
  });
  redirect("/");
}

/** First time only: confirm the authenticator app was linked correctly. */
export async function confirmEnrolment(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await getSignedInStaff();
  const code = codeSchema.safeParse(formData.get("code"));
  const factorId = z.uuid().safeParse(formData.get("factorId"));
  if (!code.success) return { error: "Enter the 6-digit code from your authenticator app." };
  if (!factorId.success) return { error: "Something went wrong. Refresh the page and try again." };

  const supabase = await createSupabaseServerClient();
  const ctx = await requestContext();
  const db = getDb();

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factorId.data,
    code: code.data,
  });
  if (error) {
    return { error: "That code isn't right or has expired. Wait for the next code and try again." };
  }

  await db.staffUser.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
  await recordAudit(db, {
    actorType: "STAFF",
    actorId: staff.id,
    action: "staff.mfa_enrolled",
    ...ctx,
  });
  await recordAudit(db, {
    actorType: "STAFF",
    actorId: staff.id,
    action: "staff.signed_in",
    ...ctx,
  });
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ctx = await requestContext();

  await supabase.auth.signOut();
  if (user) {
    await recordAudit(getDb(), {
      actorType: "STAFF",
      actorId: user.id,
      action: "staff.signed_out",
      ...ctx,
    });
  }
  redirect("/login");
}
