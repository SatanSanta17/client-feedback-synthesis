import { createClient } from "@/lib/supabase/server";

export interface Profile {
  id: string;
  email: string;
  is_admin: boolean;
  can_create_team: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches the profile for the currently authenticated user.
 * Uses the user-scoped client (respects RLS — user can only read own profile).
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
