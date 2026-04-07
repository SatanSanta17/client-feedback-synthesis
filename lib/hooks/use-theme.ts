"use client";

import { useState, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Theme = "light" | "dark";

interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */

const COOKIE_NAME = "theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function getThemeCookie(): Theme {
  if (typeof document === "undefined") return "light";

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`)
  );
  const value = match ? match[1] : null;

  if (value === "dark" || value === "light") return value;
  return "light";
}

function setThemeCookie(value: Theme): void {
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(getThemeCookie);

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

  return { theme, setTheme };
}

export type { Theme };
