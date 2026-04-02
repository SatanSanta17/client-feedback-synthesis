import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

interface ProfileState {
  isAdmin: boolean;
  isProfileLoading: boolean;
}

/**
 * Client-side hook that fetches the admin flag for the given user.
 * Returns { isAdmin: false, isProfileLoading: true } while loading.
 * On error or missing user, returns { isAdmin: false, isProfileLoading: false }.
 */
export function useProfile(user: User | null): ProfileState {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setIsProfileLoading(false);
      return;
    }

    setIsProfileLoading(true);

    supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to fetch profile:", error.message);
          setIsAdmin(false);
        } else {
          setIsAdmin(data?.is_admin ?? false);
        }
        setIsProfileLoading(false);
      });
  }, [user, supabase]);

  return { isAdmin, isProfileLoading };
}
