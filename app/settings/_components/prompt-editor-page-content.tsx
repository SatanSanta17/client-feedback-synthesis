"use client"

import { Info } from "lucide-react"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { PromptEditor } from "./prompt-editor"
import { VersionHistoryPanel } from "./version-history-panel"
import { VersionViewDialog } from "./version-view-dialog"
import { usePromptEditor } from "./use-prompt-editor"
import { PromptMasterSignalNotice } from "./prompt-master-signal-notice"
import { PromptUnsavedDialog } from "./prompt-unsaved-dialog"

interface PromptEditorPageContentProps {
  embedded?: boolean
  readOnly?: boolean
}

export function PromptEditorPageContent({ embedded = false, readOnly = false }: PromptEditorPageContentProps) {
  const editor = usePromptEditor()

  const content = (
    <>
      <Tabs
        value={editor.activeTab}
        onValueChange={editor.handleTabChange}
        className="flex flex-1 flex-col"
      >
        <TabsList>
          {editor.promptTabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {editor.promptTabs.map((tab) => (
          <TabsContent
            key={tab.key}
            value={tab.key}
            className="mt-4 flex flex-1 flex-col"
          >
            {tab.key === editor.autoSelectedMasterKey && (
              <PromptMasterSignalNotice
                displayedMasterKey={editor.displayedMasterKey}
                autoSelectedMasterKey={editor.autoSelectedMasterKey}
                onToggle={editor.handleTogglePromptVariant}
                disabled={editor.isLoading || editor.isSaving}
              />
            )}

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
              className="flex-1"
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
          </TabsContent>
        ))}
      </Tabs>

      <PromptUnsavedDialog
        open={editor.pendingTab !== null}
        onStay={editor.handleCancelSwitch}
        onDiscard={editor.handleDiscardAndSwitch}
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
    </>
  )

  if (embedded) return content

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Edit the AI system prompts used for signal extraction and master signal
          synthesis.
        </p>
      </div>
      {content}
    </div>
  )
}
