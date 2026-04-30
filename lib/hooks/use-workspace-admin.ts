"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/auth-provider";

interface UseIsWorkspaceAdminResult {
  isAdmin: boolean;
  isLoading: boolean;
}

/**
 * Resolves whether the current user is an admin of the active workspace.
 *
 * Personal workspace (`activeTeamId === null`) → implicitly admin (the user
 * is the only data owner). Team workspace → fetches `team_members.role` and
 * returns true when role is `"admin"` (which includes owners — owners are
 * always admin members per `team-repository.create()`).
 *
 * Used by sidebar gating + page-level gating that need a client-side admin
 * signal. Surfaces (`/settings/themes`, future admin-gated nav entries)
 * import this directly rather than re-implementing the role lookup.
 */
export function useIsWorkspaceAdmin(): UseIsWorkspaceAdminResult {
  const { user, activeTeamId, isLoading: authLoading } = useAuth();

  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setIsAdmin(false);
      setIsLoading(false);
      return;
    }

    if (activeTeamId === null) {
      setIsAdmin(true);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const supabase = createClient();
    supabase
      .from("team_members")
      .select("role")
      .eq("team_id", activeTeamId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn(
            `[use-workspace-admin] failed to resolve role for teamId ${activeTeamId}: ${error.message}`
          );
          setIsAdmin(false);
        } else {
          setIsAdmin(data?.role === "admin");
        }
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, activeTeamId, authLoading]);

  return { isAdmin, isLoading };
}
