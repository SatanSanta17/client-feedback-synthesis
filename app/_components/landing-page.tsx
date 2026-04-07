"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Users,
  ArrowRight,
  MessageSquareText,
  Brain,
  Target,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
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
    icon: Brain,
    title: "Cross-Client Synthesis",
    description:
      "One click generates a master signal document that surfaces recurring themes, rising urgency, and roadmap gaps across every client.",
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
    title: "Synthesise",
    description: "A living master document shows cross-client patterns at a glance.",
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LandingPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/capture");
    }
  }, [isAuthenticated, isLoading, router]);

  /* While checking auth, show nothing — avoids a flash of the landing page
     for users who are already logged in. */
  if (isLoading || isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-page)]">
      {/* ---- Nav ---- */}
      <nav className="sticky top-0 z-50 border-b border-[var(--border-default)] bg-[var(--surface-page)]/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
            Synthesiser
          </span>
          <Link href="/login">
            <Button size="sm" className="cursor-pointer gap-1.5">
              Get Started <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
      </nav>

      {/* ---- Hero ---- */}
      <section className="relative overflow-hidden">
        {/* Gradient glow behind the hero text */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[480px] w-[720px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-4xl px-6 pb-20 pt-24 text-center sm:pt-32">
          {/* Pill badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <Sparkles className="size-3.5 text-[var(--brand-primary)]" />
            AI-powered feedback intelligence
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-6xl">
            Turn every client conversation into a{" "}
            <span className="bg-gradient-to-r from-[var(--brand-primary)] to-[var(--brand-primary-vivid)] bg-clip-text text-transparent">
              product signal
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--text-secondary)] sm:text-xl">
            Sales calls, CS check-ins, Slack threads — feedback is everywhere and nowhere.
            Synthesiser captures it all, extracts the signals with AI, and shows your whole team
            what clients actually need.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/login">
              <Button size="lg" className="cursor-pointer gap-2 px-8 text-base">
                Start for Free <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="#how-it-works">
              <Button
                variant="outline"
                size="lg"
                className="cursor-pointer px-8 text-base"
              >
                See How It Works
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Features ---- */}
      <section className="border-t border-[var(--border-default)] bg-[var(--surface-raised)]">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="mb-14 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
              Everything you need to close the feedback loop
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[var(--text-secondary)]">
              From raw notes to actionable intelligence — in the time it takes to grab a coffee.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:gap-8">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="group rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] p-6 transition-shadow hover:shadow-md"
              >
                <div className="mb-4 inline-flex rounded-lg bg-[var(--brand-primary-light)] p-2.5">
                  <Icon className="size-5 text-[var(--brand-primary)]" />
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

      {/* ---- How It Works ---- */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-[var(--border-default)]">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <div className="mb-14 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
              Three steps. Zero friction.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[var(--text-secondary)]">
              No onboarding marathons. Paste your first notes and see AI signals in under a minute.
            </p>
          </div>

          <div className="grid gap-10 sm:grid-cols-3 sm:gap-8">
            {STEPS.map(({ number, title, description }) => (
              <div key={number} className="text-center sm:text-left">
                <div className="mb-3 inline-flex items-center justify-center rounded-full bg-[var(--brand-primary)] px-3 py-1 text-xs font-bold text-[var(--primary-foreground)]">
                  {number}
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

          {/* Connector line (desktop only) */}
          <div className="relative mx-auto mt-[-88px] hidden h-0.5 max-w-md sm:block">
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-primary)] via-[var(--brand-primary-light)] to-[var(--brand-primary)] opacity-30" />
          </div>
        </div>
      </section>

      {/* ---- Bottom CTA ---- */}
      <section className="border-t border-[var(--border-default)] bg-[var(--surface-raised)]">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center sm:py-24">
          <Target className="mx-auto mb-6 size-10 text-[var(--brand-primary)]" />
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            Stop letting insights slip through the cracks
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[var(--text-secondary)]">
            Your next product decision shouldn&apos;t depend on someone remembering what a client said three weeks ago. Start capturing today.
          </p>
          <div className="mt-8">
            <Link href="/login">
              <Button size="lg" className="cursor-pointer gap-2 px-10 text-base">
                Get Started — It&apos;s Free <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t border-[var(--border-default)] bg-[var(--surface-page)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="text-sm text-[var(--text-muted)]">
            &copy; {new Date().getFullYear()} Synthesiser
          </span>
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
