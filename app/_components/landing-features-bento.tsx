"use client";

import { BarChart3, Brain, MessageSquareText, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";

interface FeatureItem {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: readonly FeatureItem[] = [
  {
    icon: Sparkles,
    title: "AI Signal Extraction",
    description:
      "Your notes go in messy. They come out as clear signals — pain points, feature requests, praise, and priorities — all tagged and ready.",
  },
  {
    icon: MessageSquareText,
    title: "Capture Everything",
    description:
      "Paste raw notes, upload chat logs (WhatsApp, Slack), PDFs, CSVs — every conversation becomes structured data in seconds.",
  },
  {
    icon: BarChart3,
    title: "Insights Dashboard",
    description:
      "Sentiment shifts, urgency spikes, theme trends — your entire client landscape distilled into one interactive view.",
  },
  {
    icon: Brain,
    title: "Ask Your Data",
    description:
      "Skip the spreadsheet safari. Ask a question in plain English and get answers grounded in every session your team has ever captured — with citations.",
  },
] as const;

interface FeatureCardProps {
  feature: FeatureItem;
  index: number;
  isVisible: boolean;
  isHero?: boolean;
  className?: string;
}

function FeatureCard({
  feature: { icon: Icon, title, description },
  index,
  isVisible,
  isHero = false,
  className,
}: FeatureCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] transition-all duration-500 hover:shadow-lg",
        isHero ? "p-10" : "p-8",
        className
      )}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(40px)",
        transition: "opacity 600ms ease-out, transform 600ms ease-out",
        transitionDelay: `${index * 120}ms`,
      }}
    >
      {isHero ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 -right-16 size-64 rounded-full bg-[var(--brand-primary-light)] opacity-50 blur-3xl"
        />
      ) : null}

      <div className="relative">
        <div
          className={cn(
            "mb-5 inline-flex rounded-lg bg-[var(--brand-primary-light)]",
            isHero ? "p-4" : "p-3"
          )}
        >
          <Icon
            className={cn(
              "text-[var(--brand-primary)]",
              isHero ? "size-7" : "size-6"
            )}
          />
        </div>
        <h3
          className={cn(
            "mb-2 font-semibold text-[var(--text-primary)]",
            isHero ? "text-2xl" : "text-lg"
          )}
        >
          {title}
        </h3>
        <p
          className={cn(
            "leading-relaxed text-[var(--text-secondary)]",
            isHero ? "text-base max-w-md" : "text-sm"
          )}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

export function LandingFeaturesBento() {
  const [featuresRef, isVisible] = useScrollReveal();

  return (
    <section
      id="features"
      className="flex min-h-screen items-center border-t border-[var(--border-default)] bg-gradient-to-b from-[var(--surface-raised)] to-[var(--surface-page)]"
    >
      <div ref={featuresRef} className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="mb-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
            Everything you need to close the feedback loop
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-[var(--text-secondary)] sm:text-lg">
            From raw notes to actionable intelligence — in the time it takes to
            grab a coffee.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:grid-rows-2 lg:gap-8">
          <FeatureCard
            feature={FEATURES[0]}
            index={0}
            isVisible={isVisible}
            isHero
            className="md:row-span-2"
          />
          <FeatureCard
            feature={FEATURES[1]}
            index={1}
            isVisible={isVisible}
          />
          <FeatureCard
            feature={FEATURES[2]}
            index={2}
            isVisible={isVisible}
          />
          <FeatureCard
            feature={FEATURES[3]}
            index={3}
            isVisible={isVisible}
            className="md:col-span-2"
          />
        </div>
      </div>
    </section>
  );
}
