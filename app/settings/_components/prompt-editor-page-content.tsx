"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Info } from "lucide-react";
import { PromptEditor } from "./prompt-editor";
import { VersionHistoryPanel } from "./version-history-panel";
import { VersionViewDialog } from "./version-view-dialog";
import { SIGNAL_EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts/signal-extraction";
import {
  MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
} from "@/lib/prompts/master-signal-synthesis";
import type { PromptKey, PromptVersion } from "@/lib/services/prompt-service";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_PROMPTS: Record<PromptKey, string> = {
  signal_extraction: SIGNAL_EXTRACTION_SYSTEM_PROMPT,
  master_signal_cold_start: MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  master_signal_incremental: MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PromptEditorPageContentProps {
  embedded?: boolean;
  readOnly?: boolean;
}

export function PromptEditorPageContent({ embedded = false, readOnly = false }: PromptEditorPageContentProps) {
  const [activeTab, setActiveTab] = useState<PromptKey>("signal_extraction");
  const [originalContent, setOriginalContent] = useState("");
  const [currentContent, setCurrentContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingTab, setPendingTab] = useState<PromptKey | null>(null);
  const [history, setHistory] = useState<PromptVersion[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<PromptVersion | null>(null);
  const [viewingVersionNumber, setViewingVersionNumber] = useState(0);
  const [hasMasterSignal, setHasMasterSignal] = useState(false);
  const [isMasterSignalTainted, setIsMasterSignalTainted] = useState(false);
  const [isViewingAlternate, setIsViewingAlternate] = useState(false);

  const isDirty = originalContent !== currentContent;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // -------------------------------------------------------------------------
  // Determine which master signal prompt to show based on current state
  // -------------------------------------------------------------------------

  // The prompt key the system will use on the next generation
  const autoSelectedMasterKey: PromptKey =
    hasMasterSignal && !isMasterSignalTainted
      ? "master_signal_incremental"
      : "master_signal_cold_start";

  // The alternate key (the one NOT auto-selected)
  const alternateMasterKey: PromptKey =
    autoSelectedMasterKey === "master_signal_incremental"
      ? "master_signal_cold_start"
      : "master_signal_incremental";

  // The prompt key currently displayed in the editor (may differ if toggled)
  const displayedMasterKey: PromptKey = isViewingAlternate
    ? alternateMasterKey
    : autoSelectedMasterKey;

  // The actual prompt key being edited (accounts for toggle within master signal tab)
  const effectiveKey: PromptKey =
    activeTab === autoSelectedMasterKey ? displayedMasterKey : activeTab;

  const promptTabs = useMemo<{ key: PromptKey; label: string }[]>(
    () => [
      { key: "signal_extraction", label: "Signal Extraction" },
      { key: autoSelectedMasterKey, label: "Master Signal" },
    ],
    [autoSelectedMasterKey]
  );

  // -------------------------------------------------------------------------
  // Check if a master signal exists (once on mount)
  // -------------------------------------------------------------------------

  useEffect(() => {
    async function checkMasterSignal() {
      try {
        const res = await fetch("/api/master-signal");
        if (res.ok) {
          const data = await res.json();
          setHasMasterSignal(data.masterSignal !== null);
          setIsMasterSignalTainted(data.isTainted ?? false);
        }
      } catch {
        // Silently default to cold start if the check fails
      }
    }
    checkMasterSignal();
  }, []);

  // -------------------------------------------------------------------------
  // Fetch active prompt for current tab
  // -------------------------------------------------------------------------

  const fetchPrompt = useCallback(async (key: PromptKey) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/prompts?key=${key}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch prompt: ${res.status}`);
      }
      const data = await res.json();
      const content = data.active?.content ?? DEFAULT_PROMPTS[key];
      setOriginalContent(content);
      setCurrentContent(content);
      setHistory(data.history ?? []);
    } catch (err) {
      console.error("Failed to fetch prompt:", err);
      toast.error("Failed to load prompt. Using default.");
      const fallback = DEFAULT_PROMPTS[key];
      setOriginalContent(fallback);
      setCurrentContent(fallback);
      setHistory([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompt(effectiveKey);
  }, [effectiveKey, fetchPrompt]);

  // -------------------------------------------------------------------------
  // beforeunload guard
  // -------------------------------------------------------------------------

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        e.preventDefault();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // -------------------------------------------------------------------------
  // Tab switch with dirty guard
  // -------------------------------------------------------------------------

  function handleTabChange(value: string) {
    const newTab = value as PromptKey;
    if (newTab === activeTab) return;

    if (isDirty) {
      setPendingTab(newTab);
    } else {
      setActiveTab(newTab);
      setIsViewingAlternate(false);
    }
  }

  // Toggle between cold-start and incremental within the Master Signal tab
  function handleTogglePromptVariant() {
    if (isDirty) {
      // Store the alternate key as pending — discard handler will apply the toggle
      setPendingTab(isViewingAlternate ? autoSelectedMasterKey : alternateMasterKey);
    } else {
      setIsViewingAlternate((prev) => !prev);
    }
  }

  function handleDiscardAndSwitch() {
    if (!pendingTab) return;

    // Detect if this is a toggle within the Master Signal tab
    const isMasterVariantToggle =
      activeTab === autoSelectedMasterKey &&
      (pendingTab === "master_signal_cold_start" ||
        pendingTab === "master_signal_incremental") &&
      pendingTab !== activeTab;

    if (isMasterVariantToggle) {
      setIsViewingAlternate((prev) => !prev);
    } else {
      setActiveTab(pendingTab);
      setIsViewingAlternate(false);
    }
    setPendingTab(null);
  }

  function handleCancelSwitch() {
    setPendingTab(null);
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: effectiveKey,
          content: currentContent,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Save failed: ${res.status}`);
      }

      toast.success("Prompt saved successfully.");
      await fetchPrompt(effectiveKey);
    } catch (err) {
      console.error("Failed to save prompt:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save prompt."
      );
    } finally {
      setIsSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Reset to default
  // -------------------------------------------------------------------------

  async function handleReset() {
    const defaultContent = DEFAULT_PROMPTS[effectiveKey];

    // If already matches default, no-op
    if (currentContent === defaultContent) {
      toast.info("Prompt already matches the default.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: effectiveKey,
          content: defaultContent,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Reset failed: ${res.status}`);
      }

      toast.success("Prompt reset to default.");
      await fetchPrompt(effectiveKey);
    } catch (err) {
      console.error("Failed to reset prompt:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to reset prompt."
      );
    } finally {
      setIsSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Revert to a past version
  // -------------------------------------------------------------------------

  async function handleRevert(version: PromptVersion) {
    setIsReverting(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: effectiveKey,
          content: version.content,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Revert failed: ${res.status}`);
      }

      toast.success("Reverted to selected version.");
      await fetchPrompt(effectiveKey);
    } catch (err) {
      console.error("Failed to revert prompt:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to revert prompt."
      );
    } finally {
      setIsReverting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const content = (
    <>
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex flex-1 flex-col"
      >
        <TabsList>
          {promptTabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {promptTabs.map((tab) => (
          <TabsContent
            key={tab.key}
            value={tab.key}
            className="mt-4 flex flex-1 flex-col"
          >
            {/* Contextual note for Master Signal tab */}
            {tab.key === autoSelectedMasterKey && (
              <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <p>
                  {displayedMasterKey === "master_signal_incremental" ? (
                    <>
                      Editing the{" "}
                      <strong className="text-foreground">incremental</strong>{" "}
                      prompt — used when updating an existing master signal with
                      new/updated sessions.
                    </>
                  ) : (
                    <>
                      Editing the{" "}
                      <strong className="text-foreground">cold-start</strong>{" "}
                      prompt — used when no master signal exists yet or after a
                      session with signals is deleted.
                    </>
                  )}
                  {displayedMasterKey === autoSelectedMasterKey && (
                    <span className="ml-1.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      active
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={handleTogglePromptVariant}
                  disabled={isLoading || isSaving}
                  className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {displayedMasterKey === "master_signal_incremental"
                    ? "View cold-start prompt"
                    : "View incremental prompt"}
                </button>
              </div>
            )}

            {readOnly && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <Info className="size-4 shrink-0" />
                <span>Only team admins can edit prompts. You can view them here.</span>
              </div>
            )}

            <PromptEditor
              content={currentContent}
              onChange={setCurrentContent}
              isLoading={isLoading}
              readOnly={readOnly}
              className="flex-1"
            />

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                {currentContent.length.toLocaleString()} characters
              </span>

              {!readOnly && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    disabled={isSaving || isLoading}
                  >
                    Reset to Default
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || isSaving || isLoading}
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              )}
            </div>

            <VersionHistoryPanel
              history={history}
              isOpen={isHistoryOpen}
              onToggle={() => setIsHistoryOpen((prev) => !prev)}
              onViewVersion={(version, versionNumber) => {
                setViewingVersion(version);
                setViewingVersionNumber(versionNumber);
              }}
              onRevert={readOnly ? undefined : handleRevert}
              isReverting={isReverting}
              className="mt-4"
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Unsaved changes dialog */}
      <Dialog
        open={pendingTab !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) handleCancelSwitch();
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes to this prompt. Do you want to discard
              them and switch tabs?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelSwitch}>
              Stay
            </Button>
            <Button variant="outline" onClick={handleDiscardAndSwitch}>
              Discard & Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version view dialog */}
      <VersionViewDialog
        version={viewingVersion}
        versionNumber={viewingVersionNumber}
        onClose={() => setViewingVersion(null)}
        onRevert={readOnly ? undefined : async (version) => {
          await handleRevert(version);
          setViewingVersion(null);
        }}
        isReverting={isReverting}
      />
    </>
  );

  if (embedded) return content;

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
  );
}
