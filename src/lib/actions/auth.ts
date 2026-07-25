"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const credentialsSchema = z.object({
  email: z.string().email("Email noto‘g‘ri formatda"),
  password: z.string().min(6, "Parol kamida 6 belgidan iborat bo‘lishi kerak"),
});

export interface LoginState {
  error: string | null;
}

export async function signInAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ma’lumotlar noto‘g‘ri" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    await logAudit({
      actorId: null,
      action: "auth.login_failed",
      entityType: "auth",
      severity: "warning",
      metadata: { email: parsed.data.email },
    });
    return { error: "Email yoki parol noto‘g‘ri" };
  }

  // Admin panel is invite-only: the account must hold at least one role.
  const admin = createSupabaseAdminClient();
  const { data: roleRows } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", data.user.id)
    .limit(1);

  if (!roleRows || roleRows.length === 0) {
    await supabase.auth.signOut();
    await logAudit({
      actorId: data.user.id,
      action: "auth.login_denied",
      entityType: "auth",
      severity: "warning",
      metadata: { reason: "no_admin_role" },
    });
    return { error: "Bu akkauntga admin panelga kirish huquqi berilmagan" };
  }

  await logAudit({
    actorId: data.user.id,
    action: "auth.login",
    entityType: "auth",
    severity: "info",
  });

  const next = formData.get("next");
  redirect(typeof next === "string" && next.startsWith("/") ? next : "/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  if (user) {
    await logAudit({
      actorId: user.id,
      action: "auth.logout",
      entityType: "auth",
      severity: "info",
    });
  }
  redirect("/login");
}
