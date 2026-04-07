import { cn } from "@/lib/utils";

interface TableShellProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Shared bordered table wrapper used across settings tables
 * (team members, pending invitations, etc.).
 *
 * Provides consistent border, rounded corners, overflow handling,
 * and an optional section title.
 */
export function TableShell({ title, children, className }: TableShellProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {title && (
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {title}
        </h3>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

interface TableHeadCellProps {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

/**
 * Standardised table header cell with consistent padding, font weight,
 * and colour tokens.
 */
export function TableHeadCell({
  children,
  align = "left",
  className,
}: TableHeadCellProps) {
  return (
    <th
      className={cn(
        "px-3 py-2 font-medium text-[var(--text-secondary)]",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}
