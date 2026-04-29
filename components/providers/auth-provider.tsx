"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  getActiveTeamId,
  setActiveTeamCookie,
  clearActiveTeamCookie,
} from "@/lib/cookies/active-team";
import { clearAllStreams } from "@/lib/streaming";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  canCreateTeam: boolean;
  activeTeamId: string | null;
  setActiveTeam: (teamId: string | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

/** Fetch `can_create_team` from the profiles table. Shared by both auth paths. */
function fetchCanCreateTeam(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  setter: (v: boolean) => void
) {
  supabase
    .from("profiles")
    .select("can_create_team")
    .eq("id", userId)
    .single()
    .then(({ data }) => {
      setter(data?.can_create_team ?? false);
    });
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [canCreateTeam, setCanCreateTeam] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(
    () => getActiveTeamId()
  );
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: currentUser } }) => {
      setUser(currentUser);
      setIsLoading(false);

      if (currentUser) {
        fetchCanCreateTeam(supabase, currentUser.id, setCanCreateTeam);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);

      if (session?.user) {
        fetchCanCreateTeam(supabase, session.user.id, setCanCreateTeam);
      } else {
        setCanCreateTeam(false);
        // Defensive cleanup (PRD-024 P5.R4) — clear streaming store on any
        // session-null transition, not only the explicit signOut path. This
        // covers token expiry, multi-tab sign-out, and server-side revoke,
        // each of which fires onAuthStateChange with session=null without
        // going through this tab's signOut. Idempotent with signOut's
        // existing call.
        clearAllStreams();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const setActiveTeam = useCallback((teamId: string | null) => {
    if (teamId) {
      setActiveTeamCookie(teamId);
    } else {
      clearActiveTeamCookie();
    }
    setActiveTeamId(teamId);
    // Strip URL query params so workspace A's filters don't apply to
    // workspace B's refetched data — per the P5 filter-persistence contract.
    router.replace(pathname);
    // Re-runs server components (e.g. /settings pages) so they read the new cookie.
    // Client-side fetch effects must include activeTeamId in their deps separately.
    router.refresh();
  }, [router, pathname]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearActiveTeamCookie();
    clearAllStreams();
    setUser(null);
    setCanCreateTeam(false);
    setActiveTeamId(null);
    router.push("/login");
  }, [supabase, router]);

  return (
    <AuthContext
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        canCreateTeam,
        activeTeamId,
        setActiveTeam,
        signOut,
      }}
    >
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
