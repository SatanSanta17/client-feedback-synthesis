"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/hooks/use-theme";
import { Button } from "@/components/ui/button";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const isDark = theme === "dark";
  const Icon = isDark ? Moon : Sun;
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  function handleToggle() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={label}
      title={label}
      className={className}
    >
      <Icon className="size-4" />
    </Button>
  );
}
