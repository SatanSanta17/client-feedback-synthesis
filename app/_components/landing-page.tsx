"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Users,
  ArrowRight,
  MessageSquareText,
  BarChart3,
  Brain,
  Target,
  Mail,
  Github,
  Linkedin,
  Sun,
  Moon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useTheme } from "@/lib/hooks/use-theme";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: MessageSquareText,
    title: "Capture Everything",
    description:
      "Paste raw notes, upload chat logs (WhatsApp, Slack), PDFs, CSVs — every conversation becomes structured data in seconds.",
  },
  {
    icon: Sparkles,
    title: "AI Signal Extraction",
    description:
      "Your notes go in messy. They come out as clear signals — pain points, feature requests, praise, and priorities — all tagged and ready.",
  },
  {
    icon: BarChart3,
    title: "Insights Dashboard",
    description:
      "Sentiment shifts, urgency spikes, theme trends — your entire client landscape distilled into one interactive view. Spot what matters before it becomes a fire.",
  },
  {
    icon: Brain,
    title: "Ask Your Data",
    description:
      "Skip the spreadsheet safari. Ask a question in plain English and get answers grounded in every session your team has ever captured — with citations.",
  },
  {
    icon: Users,
    title: "Team Workspaces",
    description:
      "Invite your sales and CS team. Everyone captures, AI synthesises across all sessions, and the whole team sees the same truth.",
  },
] as const;

const STEPS = [
  {
    number: "01",
    title: "Capture",
    description: "Paste notes or upload files after every client call.",
  },
  {
    number: "02",
    title: "Extract",
    description: "AI pulls structured signals — themes, sentiment, action items.",
  },
  {
    number: "03",
    title: "Understand",
    description: "Your dashboard lights up with trends, and Chat answers any question across all your sessions — instantly.",
  },
] as const;

const SOCIAL_LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Email", href: "mailto:burhanuddinchital25151@gmail.com", icon: Mail },
  { label: "GitHub", href: "https://github.com/SatanSanta17/", icon: Github },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/cburhanuddin/", icon: Linkedin },
];

/* ------------------------------------------------------------------ */
/*  Scroll-reveal hook                                                 */
/* ------------------------------------------------------------------ */

function useScrollReveal() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(node);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref: setNode, isVisible };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LandingPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  /* Track scroll position for header transparency */
  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 20);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /* Auth redirect */
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/capture");
    }
  }, [isAuthenticated, isLoading, router]);

  /* Scroll-reveal refs for each animated section */
  const featuresReveal = useScrollReveal();
  const stepsReveal = useScrollReveal();

  if (isLoading || isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-page)]">
      {/* ---- Nav (transparent → blur on scroll) ---- */}
      <nav
        className="fixed top-0 z-50 w-full transition-all duration-300"
        style={{
          backgroundColor: scrolled
            ? "var(--surface-page-translucent)"
            : "transparent",
          backdropFilter: scrolled ? "blur(16px)" : "none",
          borderBottom: scrolled
            ? "1px solid var(--border-default)"
            : "1px solid transparent",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
            Synthesiser
          </span>
          <Link href="/login">
            <Button size="lg" className="cursor-pointer px-6">
              Get Started
            </Button>
          </Link>
        </div>
      </nav>

      {/* ---- Hero (full viewport) ---- */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
        {/* Gradient glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[800px] rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          {/* Pill badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <Sparkles className="size-3.5 text-[var(--brand-primary)]" />
            AI-powered feedback intelligence
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-6xl">
            Turn every client conversation
            <br />
            into a{" "}
            <span
              className="inline-block bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-primary-vivid) 50%, var(--brand-primary) 100%)",
              }}
            >
              product signal
            </span>
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[var(--text-secondary)] sm:text-xl">
            Sales calls, CS check-ins, Slack threads — feedback is everywhere and nowhere.
            Synthesiser captures it all, extracts the signals with AI, and shows your whole team
            what clients actually need.
          </p>

          <div className="mt-12">
            <Link href="/login">
              <Button size="lg" className="cursor-pointer px-10 py-6 text-lg">
                Try It Yourself
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Features (full viewport, scroll-reveal) ---- */}
      <section className="flex min-h-screen items-center border-t border-[var(--border-default)] bg-gradient-to-b from-[var(--surface-raised)] to-[var(--surface-page)]">
        <div ref={featuresReveal.ref} className="mx-auto w-full max-w-6xl px-6 py-24">
          <div className="mb-16 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
              Everything you need to close the feedback loop
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-[var(--text-secondary)] sm:text-lg">
              From raw notes to actionable intelligence — in the time it takes to grab a coffee.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:gap-8">
            {FEATURES.map(({ icon: Icon, title, description }, index) => (
              <div
                key={title}
                className="group rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] p-8 transition-all duration-500 hover:shadow-lg"
                style={{
                  opacity: featuresReveal.isVisible ? 1 : 0,
                  transform: featuresReveal.isVisible
                    ? "translateY(0)"
                    : "translateY(40px)",
                  transitionDelay: `${index * 120}ms`,
                }}
              >
                <div className="mb-5 inline-flex rounded-lg bg-[var(--brand-primary-light)] p-3">
                  <Icon className="size-6 text-[var(--brand-primary)]" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- How It Works (full viewport, scroll-reveal) ---- */}
      <section
        id="how-it-works"
        className="flex min-h-screen items-center border-t border-[var(--border-default)]"
      >
        <div ref={stepsReveal.ref} className="mx-auto w-full max-w-5xl px-6 py-24">
          <div className="mb-16 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
              Three steps. Zero friction.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-[var(--text-secondary)] sm:text-lg">
              No onboarding marathons. Paste your first notes and see AI signals in under a minute.
            </p>
          </div>

          {/* Steps with connector */}
          <div className="relative">
            {/* Connector line behind the badges — desktop only */}
            <div className="absolute left-0 right-0 top-5 hidden sm:block">
              <div className="mx-auto h-0.5 bg-gradient-to-r from-transparent via-[var(--brand-primary-light)] to-transparent opacity-60" />
            </div>

            <div className="relative grid gap-12 sm:grid-cols-3 sm:gap-8">
              {STEPS.map(({ number, title, description }, index) => (
                <div
                  key={number}
                  className="text-center"
                  style={{
                    opacity: stepsReveal.isVisible ? 1 : 0,
                    transform: stepsReveal.isVisible
                      ? "translateY(0) scale(1)"
                      : "translateY(30px) scale(0.95)",
                    transition: "opacity 0.6s ease, transform 0.6s ease",
                    transitionDelay: `${index * 200}ms`,
                  }}
                >
                  <div className="relative z-10 mb-5 inline-flex size-10 items-center justify-center rounded-full bg-[var(--brand-primary)] text-sm font-bold text-[var(--primary-foreground)] shadow-md">
                    {number}
                  </div>
                  <h3 className="mb-3 text-xl font-semibold text-[var(--text-primary)]">
                    {title}
                  </h3>
                  <p className="mx-auto max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Bottom CTA (full viewport, clean & impactful) ---- */}
      <section className="flex min-h-screen items-center border-t border-[var(--border-default)] bg-[var(--surface-raised)]">
        <div className="mx-auto w-full max-w-3xl px-6 py-24 text-center">
          <div className="mb-10 flex justify-center">
            <div className="rounded-full bg-[var(--brand-primary-light)] p-5">
              <Target className="size-12 text-[var(--brand-primary)]" />
            </div>
          </div>

          <h2 className="text-3xl font-extrabold leading-snug tracking-tight text-[var(--text-primary)] sm:text-4xl lg:text-5xl">
            Stop letting insights
            <br />
            slip through the cracks
          </h2>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[var(--text-secondary)] sm:text-xl">
            Your next product decision shouldn&apos;t depend on someone remembering
            what a client said three weeks ago.
          </p>

          <div className="mt-12">
            <Link href="/login">
              <Button size="lg" className="cursor-pointer gap-2.5 px-10 py-6 text-lg">
                Start Capturing Today <ArrowRight className="size-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t border-[var(--border-default)] bg-[var(--surface-page)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-6 sm:flex-row sm:justify-between">
          <span className="text-sm text-[var(--text-muted)]">
            Developed by Burhanuddin C
          </span>
          <div className="flex items-center gap-4">
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
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="cursor-pointer text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
