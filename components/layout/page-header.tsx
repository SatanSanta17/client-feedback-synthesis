import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({ title, description, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {description}
        </p>
      )}
    </div>
  );
}
