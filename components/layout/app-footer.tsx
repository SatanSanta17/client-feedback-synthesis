import Link from "next/link";
import { Mail, Github, Linkedin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Email", href: "mailto:burhanuddinchital25151@gmail.com", icon: Mail },
  { label: "GitHub", href: "https://github.com/SatanSanta17/", icon: Github },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/cburhanuddin/", icon: Linkedin },
];

export function AppFooter() {
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
      </div>
    </footer>
  );
}
