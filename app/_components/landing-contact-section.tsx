"use client";

import Link from "next/link";
import { Calendar, Mail } from "lucide-react";

import { useScrollReveal } from "@/lib/hooks/use-scroll-reveal";
import { LandingContactForm } from "./landing-contact-form";

const CONTACT_EMAIL = "burhanuddinchital25151@gmail.com";

export function LandingContactSection() {
  const [contactRef, isVisible] = useScrollReveal();
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL;

  return (
    <section
      id="contact"
      className="flex min-h-screen items-center border-t border-[var(--border-default)] bg-[var(--surface-raised)]"
    >
      <div
        ref={contactRef}
        className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-12 px-6 py-24 lg:grid-cols-2"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(30px)",
          transition: "opacity 600ms ease-out, transform 600ms ease-out",
        }}
      >
        <div className="flex flex-col justify-center">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
            Have a question?
            <br />
            Want a walkthrough?
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            Drop us a note and we&apos;ll get back within one business day. Or
            reach out directly using the channels below.
          </p>

          <div className="mt-10 space-y-3">
            <Link
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--brand-primary)]"
            >
              <Mail className="size-4" />
              {CONTACT_EMAIL}
            </Link>

            {calendlyUrl ? (
              <Link
                href={calendlyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--brand-primary)]"
              >
                <Calendar className="size-4" />
                Book time directly
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex items-center">
          <div className="w-full">
            <LandingContactForm />
          </div>
        </div>
      </div>
    </section>
  );
}
