import { isCurrentUserAdmin } from "@/lib/services/profile-service";
import { PromptEditorPageContent } from "./_components/prompt-editor-page-content";

export const metadata = {
  title: "Settings — Synthesiser",
};

export default async function SettingsPage() {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            Access Denied
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            You don&apos;t have permission to access settings. Contact an admin
            if you need access.
          </p>
        </div>
      </div>
    );
  }

  return <PromptEditorPageContent />;
}
