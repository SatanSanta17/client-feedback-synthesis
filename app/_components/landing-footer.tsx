"use client";

import Link from "next/link";
import { Github, Linkedin, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ThemeToggle } from "@/components/layout/theme-toggle";

interface SocialLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

const SOCIAL_LINKS: readonly SocialLink[] = [
  { label: "Email", href: "mailto:burhanuddinchital25151@gmail.com", icon: Mail },
  { label: "GitHub", href: "https://github.com/SatanSanta17/", icon: Github },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/cburhanuddin/", icon: Linkedin },
];

const QUICK_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Contact", href: "#contact" },
] as const;

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--border-default)] bg-[var(--surface-page)]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-12 md:grid-cols-3 md:py-16">
        {/* Left: brand + credits */}
        <div>
          <span className="text-base font-bold tracking-tight text-[var(--text-primary)]">
            Synthesiser
          </span>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
            Capture every client conversation. Extract every signal. See the
            whole landscape.
          </p>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Developed by Burhanuddin C
          </p>
        </div>

        {/* Middle: in-page quick links */}
        <nav className="md:justify-self-center" aria-label="Footer">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Explore
          </h3>
          <ul className="mt-3 space-y-2">
            {QUICK_LINKS.map(({ label, href }) => (
              <li key={href}>
                <a
                  href={href}
                  className="text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Right: social + theme toggle */}
        <div className="flex items-center gap-4 md:justify-self-end">
          {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              aria-label={label}
            >
              <Icon className="size-4" />
            </Link>
          ))}
          <ThemeToggle className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
        </div>
      </div>
    </footer>
  );
}
