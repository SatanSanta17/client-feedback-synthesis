"use client";

import {
  HeartHandshake,
  LifeBuoy,
  Mail,
  MessageSquare,
  MoveDown,
  Phone,
  Sparkles,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";

interface FeedbackSource {
  icon: LucideIcon;
  label: string;
}

const SOURCES: readonly FeedbackSource[] = [
  { icon: Phone, label: "Sales calls" },
  { icon: HeartHandshake, label: "CS check-ins" },
  { icon: MessageSquare, label: "Slack threads" },
  { icon: Mail, label: "Email replies" },
  { icon: Video, label: "Zoom recordings" },
  { icon: LifeBuoy, label: "Support tickets" },
] as const;

export function LandingFeedbackSources() {
  const [sectionRef, isVisible] = useScrollReveal();

  return (
    <section className="border-t border-[var(--border-default)] bg-[var(--surface-raised)]">
      <div ref={sectionRef} className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-14 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
            Right now, your feedback is everywhere except one place.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-[var(--text-secondary)] sm:text-lg">
            Every channel ends up in someone&apos;s head, someone&apos;s notes,
            or nowhere at all. Synthesiser is the layer that catches it all and
            makes it searchable.
          </p>
        </div>

        {/* Sources grid */}
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {SOURCES.map(({ icon: Icon, label }, index) => (
            <div
              key={label}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] px-4 py-3 shadow-sm"
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(20px)",
                transition:
                  "opacity 600ms ease-out, transform 600ms ease-out",
                transitionDelay: `${index * 80}ms`,
              }}
            >
              <Icon className="size-4 shrink-0 text-[var(--brand-primary)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Arrow connector */}
        <div className="my-10 flex items-center justify-center">
          <div
            aria-hidden
            className="flex size-12 items-center justify-center rounded-full bg-[var(--brand-primary-light)]"
            style={{
              opacity: isVisible ? 1 : 0,
              transition: "opacity 800ms ease-out",
              transitionDelay: "600ms",
            }}
          >
            <MoveDown className="size-5 text-[var(--brand-primary)]" />
          </div>
        </div>

        {/* Synthesiser node */}
        <div
          className="relative mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-[var(--brand-primary)] bg-gradient-to-br from-[var(--brand-primary-light)] to-[var(--surface-page)] p-8 text-center shadow-lg"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "scale(1)" : "scale(0.95)",
            transition:
              "opacity 700ms ease-out, transform 700ms ease-out",
            transitionDelay: "800ms",
          }}
        >
          <div className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-[var(--brand-primary)]">
            <Sparkles className="size-6 text-[var(--primary-foreground)]" />
          </div>
          <span className="text-lg font-bold text-[var(--text-primary)]">
            Synthesiser
          </span>
          <span className="mt-1 text-sm text-[var(--text-secondary)]">
            One searchable home for every client signal
          </span>
        </div>
      </div>
    </section>
  );
}
