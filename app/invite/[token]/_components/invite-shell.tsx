import { AlertCircle, Clock, CheckCircle2, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] p-8 text-center shadow-sm">
        <div className="flex flex-col items-center">{children}</div>
      </div>
    </div>
  );
}

interface InviteHeaderProps {
  teamName: string | null;
  role: string | null;
}

export function InviteHeader({ teamName, role }: InviteHeaderProps) {
  return (
    <>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-primary-light)]">
        <Users className="size-6 text-[var(--brand-primary)]" />
      </div>
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">
        Join {teamName}
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        You&apos;ve been invited to join <strong>{teamName}</strong> on
        Synthesiser.
      </p>
      <div className="mt-3">
        <Badge variant="secondary" className="capitalize">
          {role}
        </Badge>
      </div>
    </>
  );
}

export function OAuthDivider() {
  return (
    <div className="my-6 flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--border-default)]" />
      <span className="text-xs text-[var(--text-muted)]">or</span>
      <div className="h-px flex-1 bg-[var(--border-default)]" />
    </div>
  );
}

export function StatusIcon({
  variant,
}: {
  variant: "error" | "expired" | "accepted";
}) {
  const config = {
    error: { icon: AlertCircle, bg: "bg-[var(--status-error-light)]", text: "text-[var(--status-error)]" },
    expired: { icon: Clock, bg: "bg-[var(--status-warning-light)]", text: "text-[var(--status-warning)]" },
    accepted: {
      icon: CheckCircle2,
      bg: "bg-[var(--status-success-light)]",
      text: "text-[var(--status-success)]",
    },
  }[variant];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "mb-4 flex h-12 w-12 items-center justify-center rounded-full",
        config.bg
      )}
    >
      <Icon className={cn("size-6", config.text)} />
    </div>
  );
}
