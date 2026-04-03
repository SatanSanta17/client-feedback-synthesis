"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  canCreateTeam: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [canCreateTeam, setCanCreateTeam] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: currentUser } }) => {
      setUser(currentUser);
      setIsLoading(false);

      if (currentUser) {
        supabase
          .from("profiles")
          .select("can_create_team")
          .eq("id", currentUser.id)
          .single()
          .then(({ data }) => {
            setCanCreateTeam(data?.can_create_team ?? false);
          });
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);

      if (session?.user) {
        supabase
          .from("profiles")
          .select("can_create_team")
          .eq("id", session.user.id)
          .single()
          .then(({ data }) => {
            setCanCreateTeam(data?.can_create_team ?? false);
          });
      } else {
        setCanCreateTeam(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setCanCreateTeam(false);
    router.push("/login");
  }, [supabase, router]);

  return (
    <AuthContext
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        canCreateTeam,
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
