import Link from "next/link"
import { CheckCircle2 } from "lucide-react"

interface EmailConfirmationPanelProps {
  children: React.ReactNode
  linkText?: string
  linkHref?: string
}

export function EmailConfirmationPanel({
  children,
  linkText = "Back to sign in",
  linkHref = "/login",
}: EmailConfirmationPanelProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--status-success-light)]">
          <CheckCircle2 className="size-6 text-[var(--status-success)]" />
        </div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Check your email
        </h1>
        <div className="mt-2 text-sm text-[var(--text-secondary)]">
          {children}
        </div>
        <Link
          href={linkHref}
          className="mt-6 inline-block text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          {linkText}
        </Link>
      </div>
    </div>
  )
}
