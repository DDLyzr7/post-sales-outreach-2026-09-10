"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { passwordSignInEnabled, requestOrigin, safeNextPath } from "@/lib/auth";

export type LoginState = { error: string | null };

/** Password sign-in for the fictional sample users, on localhost only. */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!passwordSignInEnabled()) {
    return { error: "Sign in with your Lyzr Microsoft account." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "/"));

  if (!email || !password) return { error: "Email and password are both required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect(next);
}

/**
 * Starts Microsoft sign-in. Supabase sends the browser to Microsoft, Microsoft
 * back to Supabase, and Supabase to /auth/callback with a one-time code.
 */
export async function signInWithMicrosoft(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? "/"));
  const origin = await requestOrigin();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      // Supabase needs Azure to return an email address.
      scopes: "email",
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? "Microsoft sign-in could not start. Try again.")}`);
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
