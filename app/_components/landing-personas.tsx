"use client";

import { HeartHandshake, Map, Rocket, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";

interface Persona {
  icon: LucideIcon;
  label: string;
  value: string;
}

const PERSONAS: readonly Persona[] = [
  {
    icon: Rocket,
    label: "Founders",
    value:
      "Capture every discovery call so investor and product decisions are evidence-backed, not memory-based.",
  },
  {
    icon: TrendingUp,
    label: "Sales",
    value:
      "Turn prospect objections and competitor mentions into shared institutional memory the next deal can use.",
  },
  {
    icon: HeartHandshake,
    label: "Customer Success",
    value: "Spot churn signals across QBRs and check-ins before they become churn.",
  },
  {
    icon: Map,
    label: "Product Managers",
    value:
      "Back the roadmap with what clients actually said, not what someone remembered three weeks later.",
  },
] as const;

export function LandingPersonas() {
  const [personasRef, isVisible] = useScrollReveal();

  return (
    <section className="border-t border-[var(--border-default)] bg-[var(--surface-page)]">
      <div className="mx-auto w-full max-w-4xl px-6 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            Built for the people who run client conversations
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-[var(--text-secondary)]">
            Whatever role you play in the loop, Synthesiser meets you where you
            are.
          </p>
        </div>

        <div
          ref={personasRef}
          className="divide-y divide-[var(--border-default)]/60"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 600ms ease-out, transform 600ms ease-out",
          }}
        >
          {PERSONAS.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-4 py-5">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary-light)]">
                <Icon className="size-5 text-[var(--brand-primary)]" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">
                  {label}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {value}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
