"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Mail, Github, Linkedin, Sun, Moon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "@/lib/hooks/use-theme";

const LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Email", href: "mailto:burhanuddinchital25151@gmail.com", icon: Mail },
  { label: "GitHub", href: "https://github.com/SatanSanta17/", icon: Github },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/cburhanuddin/", icon: Linkedin },
];

export function AppFooter() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  if (pathname === "/") return null;

  /* theme always starts as "light" on both server and client, then
     corrects after mount — so the button structure is always identical
     during hydration (Moon icon + "Dark" label). No DOM mismatch. */
  const isDark = theme === "dark";
  const ThemeIcon = isDark ? Sun : Moon;

  return (
    <footer className="border-t border-[var(--border-default)] bg-[var(--surface-page)] px-6 py-3">
      <div className="flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
        <span>Burhanuddin C</span>
        {LINKS.map(({ label, href, icon: Icon }) => (
          <span key={label} className="flex items-center gap-2">
            <span aria-hidden>·</span>
            <Link
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          </span>
        ))}
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="inline-flex cursor-pointer items-center gap-1.5 underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <ThemeIcon className="size-4" />
          {isDark ? "Light" : "Dark"}
        </button>
      </div>
    </footer>
  );
}
