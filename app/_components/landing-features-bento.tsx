"use client";

import { BarChart3, MessageSquareText, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";
import { LandingChatPreview } from "./landing-chat-preview";

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
] as const;

interface FeatureCardProps {
  feature: FeatureItem;
  index: number;
  isVisible: boolean;
  className?: string;
}

function FeatureCard({
  feature: { icon: Icon, title, description },
  index,
  isVisible,
  className,
}: FeatureCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] p-8 transition-all duration-500 hover:shadow-lg",
        className,
      )}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(40px)",
        transition: "opacity 600ms ease-out, transform 600ms ease-out",
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

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8">
          <FeatureCard
            feature={FEATURES[0]}
            index={0}
            isVisible={isVisible}
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
          <LandingChatPreview
            index={3}
            isVisible={isVisible}
            className="md:col-span-3"
          />
        </div>
      </div>
    </section>
  );
}
