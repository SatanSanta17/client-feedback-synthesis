"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_AUTH_ROUTE } from "@/lib/constants";
import { Sparkles, ArrowRight, Target } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";
import { LandingFeedbackSources } from "./landing-feedback-sources";
import { LandingProductShowcase } from "./landing-product-showcase";
import { LandingFeaturesBento } from "./landing-features-bento";
import { LandingPersonas } from "./landing-personas";
import { LandingContactSection } from "./landing-contact-section";
import { LandingFooter } from "./landing-footer";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    number: "01",
    title: "Capture",
    description:
      "Paste notes or drop a Zoom recording after every call. Sales doesn't reformat. CS doesn't restructure. PMs don't chase.",
  },
  {
    number: "02",
    title: "Extract",
    description:
      "AI pulls pain points, requirements, sentiment, and competitive mentions — tagged, themed, and linked to the client who said it.",
  },
  {
    number: "03",
    title: "Decide",
    description:
      "Your CS lead opens chat 30 minutes before a renewal and pulls every concern this client has ever raised — with quotes.",
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LandingPage() {
  const { isAuthenticated, isLoading } = useAuth();
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
      router.replace(DEFAULT_AUTH_ROUTE);
    }
  }, [isAuthenticated, isLoading, router]);

  /* Scroll-reveal ref for the how-it-works steps section */
  const [stepsRef, stepsVisible] = useScrollReveal();

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
          <div className="flex items-center gap-4 sm:gap-6">
            <a
              href="#contact"
              className="text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Contact
            </a>
            <Link href="/login">
              <Button size="lg" className="cursor-pointer px-6">
                Get Started
              </Button>
            </Link>
          </div>
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
            Customer Feedback Management, powered by AI
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-6xl">
            All your client feedback,
            <br />
            finally{" "}
            <span
              className="inline-block bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-primary-vivid) 50%, var(--brand-primary) 100%)",
              }}
            >
              answerable
            </span>
            .
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[var(--text-secondary)] sm:text-xl">
            Synthesiser captures every client conversation — sales calls, CS check-ins, Zoom
            recordings — extracts the signals with AI, and lets your whole team ask questions
            across all of it.
          </p>

          <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/login">
              <Button size="lg" className="cursor-pointer px-10 py-6 text-lg">
                Try It Yourself
              </Button>
            </Link>
            <a href="#showcase">
              <Button
                size="lg"
                variant="outline"
                className="cursor-pointer px-10 py-6 text-lg"
              >
                See an example dashboard
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ---- Feedback sources — the "before" picture ---- */}
      <LandingFeedbackSources />

      {/* ---- Product Showcase (full viewport) ---- */}
      <LandingProductShowcase />

      {/* ---- Built for personas (compact strip) ---- */}
      <LandingPersonas />

      {/* ---- Features bento (full viewport, scroll-reveal) ---- */}
      <LandingFeaturesBento />

      {/* ---- How It Works (full viewport, scroll-reveal) ---- */}
      <section
        id="how-it-works"
        className="flex min-h-screen items-center border-t border-[var(--border-default)]"
      >
        <div ref={stepsRef} className="mx-auto w-full max-w-5xl px-6 py-24">
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
                    opacity: stepsVisible ? 1 : 0,
                    transform: stepsVisible
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
            Every client conversation your team has — captured, structured, and
            queryable. The right answer reaches you so that you can make the right decision.
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

      {/* ---- Contact section (full viewport) ---- */}
      <LandingContactSection />

      {/* ---- Footer ---- */}
      <LandingFooter />
    </div>
  );
}
