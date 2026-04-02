import { createClient } from "@/lib/supabase/server";

export interface Profile {
  id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches the profile for the currently authenticated user.
 * Uses the anon client (respects RLS — user can only read own profile).
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Failed to fetch profile:", error.message);
    return null;
  }

  return data;
}

/**
 * Checks if the currently authenticated user is an admin.
 * Returns false if the user is not authenticated or the query fails.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.is_admin ?? false;
}
