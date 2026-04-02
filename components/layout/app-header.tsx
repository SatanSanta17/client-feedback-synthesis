import { TabNav } from "@/components/layout/tab-nav";
import { UserMenu } from "@/components/layout/user-menu";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-page)] px-6">
      <div className="flex items-center gap-6">
        <span className="text-base font-semibold text-[var(--text-primary)]">
          Accelerate Synthesis
        </span>
        <TabNav />
      </div>
      <UserMenu />
    </header>
  );
}
