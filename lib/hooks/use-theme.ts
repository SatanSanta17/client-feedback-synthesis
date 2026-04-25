"use client";

import { useState, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Theme = "light" | "dark";

interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Flips the current theme — single source of truth for the inversion. */
  toggleTheme: () => void;
}

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */

const COOKIE_NAME = "theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function setThemeCookie(value: Theme): void {
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTheme(): UseThemeReturn {
  /*
   * Always initialise as "light" so server and client produce identical
   * HTML during hydration — no DOM structure or attribute mismatches.
   *
   * After mount, the effect reads the <html> class that the server
   * layout already set (based on the cookie) and syncs state to match.
   * This triggers a single re-render that updates the toggle icon/label.
   */
  const [theme, setThemeState] = useState<Theme>("light");

  /* Sync with the server-rendered <html> class on first mount */
  useEffect(() => {
    const serverTheme = document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
    setThemeState(serverTheme);
  }, []);

  /* Apply the dark class on <html> whenever theme changes */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setThemeCookie(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      setThemeCookie(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}

export type { Theme };
