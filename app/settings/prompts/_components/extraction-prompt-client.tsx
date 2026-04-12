"use client"

import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"

import { PromptEditor } from "@/app/settings/_components/prompt-editor"
import { VersionHistoryPanel } from "@/app/settings/_components/version-history-panel"
import { VersionViewDialog } from "@/app/settings/_components/version-view-dialog"
import { useExtractionPrompt } from "./use-extraction-prompt"

interface ExtractionPromptClientProps {
  readOnly?: boolean
}

export function ExtractionPromptClient({ readOnly = false }: ExtractionPromptClientProps) {
  const editor = useExtractionPrompt()

  return (
    <div className="flex flex-1 flex-col mt-4">
      {readOnly && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-light)] px-4 py-3 text-sm text-[var(--status-info-text)]">
          <Info className="size-4 shrink-0" />
          <span>Only team admins can edit prompts. You can view them here.</span>
        </div>
      )}

      <PromptEditor
        content={editor.currentContent}
        onChange={editor.setCurrentContent}
        isLoading={editor.isLoading}
        readOnly={readOnly}
        className="flex-1 min-h-[400px]"
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">
          {editor.currentContent.length.toLocaleString()} characters
        </span>

        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={editor.handleReset}
              disabled={editor.isSaving || editor.isLoading}
            >
              Reset to Default
            </Button>
            <Button
              size="sm"
              onClick={editor.handleSave}
              disabled={!editor.isDirty || editor.isSaving || editor.isLoading}
            >
              {editor.isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>

      <VersionHistoryPanel
        history={editor.history}
        isOpen={editor.isHistoryOpen}
        onToggle={() => editor.setIsHistoryOpen(!editor.isHistoryOpen)}
        onViewVersion={(version, versionNumber) => {
          editor.setViewingVersion(version)
          editor.setViewingVersionNumber(versionNumber)
        }}
        onRevert={readOnly ? undefined : editor.handleRevert}
        isReverting={editor.isReverting}
        className="mt-4"
      />

      <VersionViewDialog
        version={editor.viewingVersion}
        versionNumber={editor.viewingVersionNumber}
        onClose={() => editor.setViewingVersion(null)}
        onRevert={readOnly ? undefined : async (version) => {
          await editor.handleRevert(version)
          editor.setViewingVersion(null)
        }}
        isReverting={editor.isReverting}
      />
    </div>
  )
}
