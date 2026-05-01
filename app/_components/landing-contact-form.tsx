"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contactSchema, type ContactInput } from "@/lib/schemas/contact-schema";

type FormState = "idle" | "submitting" | "success" | "error";

export function LandingContactForm() {
  const [formState, setFormState] = useState<FormState>("idle");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", mobile: "", message: "", website: "" },
  });

  async function onSubmit(data: ContactInput) {
    setFormState("submitting");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body.message ?? "Something went wrong. Please try again.");
        setFormState("idle");
        return;
      }

      setFormState("success");
    } catch (err) {
      console.error("[landing-contact-form] submit failed:", err);
      toast.error("Network error — please try again.");
      setFormState("idle");
    }
  }

  function handleSendAnother() {
    reset();
    setFormState("idle");
  }

  if (formState === "success") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] p-12 text-center">
        <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-[var(--brand-primary-light)]">
          <CheckCircle2 className="size-7 text-[var(--brand-primary)]" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
          Message received
        </h3>
        <p className="mb-6 max-w-sm text-sm text-[var(--text-secondary)]">
          Thanks — we&apos;ll get back to you within one business day.
        </p>
        <button
          type="button"
          onClick={handleSendAnother}
          className="text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  const isSubmitting = formState === "submitting";

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] p-6 sm:p-8"
      noValidate
    >
      {/* Honeypot — hidden from humans, visible to bots that fill every field */}
      <input
        type="text"
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute left-[-9999px] size-0 opacity-0"
        {...register("website")}
      />

      <div className="space-y-1.5">
        <Label htmlFor="contact-name">Name</Label>
        <Input
          id="contact-name"
          type="text"
          autoComplete="name"
          placeholder="Jane Doe"
          disabled={isSubmitting}
          {...register("name")}
        />
        {errors.name && (
          <p className="text-xs text-[var(--status-error)]">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          disabled={isSubmitting}
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-[var(--status-error)]">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-mobile">
          Mobile{" "}
          <span className="font-normal text-[var(--text-muted)]">(optional)</span>
        </Label>
        <Input
          id="contact-mobile"
          type="tel"
          autoComplete="tel"
          placeholder="+1 555 123 4567"
          disabled={isSubmitting}
          {...register("mobile")}
        />
        {errors.mobile && (
          <p className="text-xs text-[var(--status-error)]">{errors.mobile.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-message">Message</Label>
        <Textarea
          id="contact-message"
          rows={5}
          placeholder="Tell us what you're trying to figure out…"
          disabled={isSubmitting}
          {...register("message")}
        />
        {errors.message && (
          <p className="text-xs text-[var(--status-error)]">{errors.message.message}</p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full cursor-pointer"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sending…
          </>
        ) : (
          "Send message"
        )}
      </Button>
    </form>
  );
}
