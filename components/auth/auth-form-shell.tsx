interface AuthFormShellProps {
  title: string
  subtitle: string
  children: React.ReactNode
}

export function AuthFormShell({ title, subtitle, children }: AuthFormShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {subtitle}
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}
