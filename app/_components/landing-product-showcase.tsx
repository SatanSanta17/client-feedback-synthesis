"use client";

import Image from "next/image";
import { Grid3x3, LineChart, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";

interface ChipProps {
  icon: LucideIcon;
  label: string;
  positionClass: string;
  baseTransform?: string;
  index: number;
  isVisible: boolean;
}

function Chip({
  icon: Icon,
  label,
  positionClass,
  baseTransform = "",
  index,
  isVisible,
}: ChipProps) {
  return (
    <div
      aria-hidden="true"
      className={`absolute hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-md ${positionClass}`}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: `${baseTransform} translateY(${isVisible ? 0 : 20}px)`.trim(),
        transition: "opacity 600ms ease-out, transform 600ms ease-out",
        transitionDelay: `${200 + index * 150}ms`,
      }}
    >
      <Icon className="size-3.5 text-[var(--brand-primary)]" />
      {label}
    </div>
  );
}

export function LandingProductShowcase() {
  const [showcaseRef, isVisible] = useScrollReveal();

  return (
    <section className="flex min-h-screen items-center border-t border-[var(--border-default)] bg-[var(--surface-page)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="mb-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
            See your client landscape, in one screen
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-[var(--text-secondary)] sm:text-lg">
            Every conversation, structured. Every theme, surfaced. Every signal,
            searchable.
          </p>
        </div>

        <div ref={showcaseRef} className="relative mx-auto w-full max-w-5xl">
          <div
            className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-2xl"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? "translateY(0)" : "translateY(40px)",
              transition: "opacity 600ms ease-out, transform 600ms ease-out",
            }}
          >
            <Image
              src="/landing/dashboard-showcase.png"
              alt="Synthesiser dashboard showing sentiment trends, theme matrix, and recent insights for a workspace's client portfolio"
              width={2400}
              height={1350}
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 90vw, 1200px"
              className="h-auto w-full"
              priority={false}
            />
          </div>

          <Chip
            icon={LineChart}
            label="Sentiment trends"
            positionClass="left-[-4%] top-[8%]"
            index={0}
            isVisible={isVisible}
          />
          <Chip
            icon={Grid3x3}
            label="Theme matrix"
            positionClass="right-[-4%] top-[20%]"
            index={1}
            isVisible={isVisible}
          />
          <Chip
            icon={MessagesSquare}
            label="RAG chat"
            positionClass="bottom-[12%] left-1/2"
            baseTransform="translateX(-50%)"
            index={2}
            isVisible={isVisible}
          />
        </div>
      </div>
    </section>
  );
}
