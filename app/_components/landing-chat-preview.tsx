"use client";

import { Brain, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

interface LandingChatPreviewProps {
  index: number;
  isVisible: boolean;
  className?: string;
}

export function LandingChatPreview({
  index,
  isVisible,
  className,
}: LandingChatPreviewProps) {
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
      <div className="grid gap-8 md:grid-cols-2 md:items-center md:gap-12">
        <div>
          <div className="mb-5 inline-flex rounded-lg bg-[var(--brand-primary-light)] p-3">
            <Brain className="size-6 text-[var(--brand-primary)]" />
          </div>
          <h3 className="mb-2 text-xl font-semibold text-[var(--text-primary)] md:text-2xl">
            Ask anything across every session
          </h3>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)] md:text-base">
            Plain-English questions. Cited answers grounded in every
            conversation your team has captured. No spreadsheet safari.
          </p>
        </div>

        {/* Faux chat */}
        <div className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-4">
          {/* User question */}
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--brand-primary)] px-4 py-2.5 text-sm text-[var(--primary-foreground)]">
              Which Enterprise clients flagged pricing concerns in Q1?
            </div>
          </div>

          {/* Assistant response */}
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary-light)]">
              <Sparkles className="size-3 text-[var(--brand-primary)]" />
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                Three Enterprise clients raised pricing concerns in Q1:
              </p>
              <ul className="space-y-1 text-sm leading-relaxed text-[var(--text-primary)]">
                <li>
                  <span className="font-medium">Acme</span> — &ldquo;the per-seat
                  tier doesn&apos;t scale for us&rdquo;
                </li>
                <li>
                  <span className="font-medium">Globex</span> — asked for volume
                  discounts twice
                </li>
                <li>
                  <span className="font-medium">Initech</span> — flagged on
                  their Q1 QBR
                </li>
              </ul>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                  Acme · Q1 sync
                </span>
                <span className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                  Globex · pricing review
                </span>
                <span className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                  Initech · Q1 QBR
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
