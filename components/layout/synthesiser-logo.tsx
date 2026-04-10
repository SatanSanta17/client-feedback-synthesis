"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTheme } from "@/lib/hooks/use-theme";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type LogoVariant = "full" | "icon";

interface SynthesiserLogoProps {
  variant?: LogoVariant;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Asset map                                                          */
/* ------------------------------------------------------------------ */

const LOGO_ASSETS: Record<LogoVariant, { light: string; dark: string; width: number; height: number }> = {
  full: {
    light: "/synthesiser-logo-light.svg",
    dark: "/synthesiser-logo-dark.svg",
    width: 180,
    height: 48,
  },
  icon: {
    light: "/synthesiser-icon-light.svg",
    dark: "/synthesiser-icon-dark.svg",
    width: 36,
    height: 30,
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SynthesiserLogo({ variant = "full", className }: SynthesiserLogoProps) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  /* Prevent hydration mismatch — render light by default, then sync */
  useEffect(() => {
    setMounted(true);
  }, []);

  const assets = LOGO_ASSETS[variant];
  const resolvedTheme = mounted ? theme : "light";
  const src = resolvedTheme === "dark" ? assets.dark : assets.light;

  return (
    <Image
      src={src}
      alt="Synthesiser"
      width={assets.width}
      height={assets.height}
      className={className}
      priority
    />
  );
}
