"use client";

// ---------------------------------------------------------------------------
// ChatInput — Message input with send/stop (PRD-020 Part 3, Increment 3.4)
// ---------------------------------------------------------------------------
// Auto-expanding textarea (1–6 rows) with:
// - Send button (disabled during streaming or when empty)
// - Stop button (visible during streaming, triggers cancelStream)
// - Enter to send, Shift+Enter for newline
// - Disabled when conversation is archived
// ---------------------------------------------------------------------------

import { useRef, useCallback, useEffect, useState } from "react";
import { ArchiveRestore, ArrowUp, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MAX_CONCURRENT_STREAMS } from "@/lib/streaming";
import type { StreamState } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ROWS = 1;
const MAX_ROWS = 6;
const LINE_HEIGHT = 24; // px — matches text-sm leading-relaxed

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatInputProps {
  /** Current streaming state — controls send vs stop button. */
  streamState: StreamState;
  /**
   * True when the workspace's active-stream count is at or above
   * MAX_CONCURRENT_STREAMS (PRD-024 P3.R3). Computed by the parent
   * (chat-area) so all input surfaces — this component, starter
   * questions, follow-up chips — share one source of truth and gate
   * consistently. Disables Send + renders the inline blocking banner
   * when this is true and not currently streaming this conversation.
   */
  capReached: boolean;
  /** Whether the conversation is archived (disables input). */
  isArchived: boolean;
  /** Text to inject into the textarea (e.g. from follow-up chip click).
   *  Wrapped in an object so a new reference triggers the effect even for
   *  the same text clicked twice. */
  suggestedText?: { text: string; ts: number } | null;
  /** Send a new message. */
  onSendMessage: (content: string) => Promise<void>;
  /** Cancel the in-progress stream. */
  onCancelStream: () => void;
  /** Unarchive the current conversation (shown when archived). */
  onUnarchive?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatInput({
  streamState,
  capReached,
  isArchived,
  suggestedText,
  onSendMessage,
  onCancelStream,
  onUnarchive,
  className,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = streamState === "streaming";

  // The cap-blocked banner only renders when the workspace is at cap AND
  // this conversation isn't currently streaming. When this conversation is
  // streaming, the user already has a Stop button — no need to show the
  // cap message.
  const showCapBanner = !isStreaming && capReached;
  const canSend =
    value.trim().length > 0 && !isStreaming && !capReached;

  // Populate textarea when suggestedText changes (e.g. follow-up chip click)
  const prevSuggestedTsRef = useRef(0);
  useEffect(() => {
    if (suggestedText && suggestedText.ts !== prevSuggestedTsRef.current) {
      setValue(suggestedText.text);
      prevSuggestedTsRef.current = suggestedText.ts;
      // Focus the textarea so the user can edit or press Enter
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [suggestedText]);

  // -----------------------------------------------------------------------
  // Auto-resize textarea
  // -----------------------------------------------------------------------

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get scrollHeight
    textarea.style.height = "auto";
    const maxHeight = MAX_ROWS * LINE_HEIGHT;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [value, resizeTextarea]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    // Gate by cap as well as stream state — the Send button is visually
    // disabled, but Enter (handleKeyDown) calls handleSend directly,
    // bypassing the button's disabled attribute. Without this, pressing
    // Enter at cap would clear the textarea and the streaming module's
    // defensive guard would silently refuse the send (orphaned UX).
    if (!trimmed || isStreaming || capReached) return;

    setValue("");
    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });

    onSendMessage(trimmed).catch((err) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[ChatInput] send failed:", msg);
    });
  }, [value, isStreaming, capReached, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // -----------------------------------------------------------------------
  // Archived state
  // -----------------------------------------------------------------------

  if (isArchived) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 border-t border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground",
          className
        )}
      >
        <span>This conversation is archived.</span>
        {onUnarchive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onUnarchive}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArchiveRestore className="size-4" aria-hidden="true" />
            Unarchive
          </Button>
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className={cn("border-t border-border px-4 py-3", className)}>
      {showCapBanner && (
        <div
          role="status"
          aria-live="polite"
          className="mx-auto mb-2 max-w-3xl rounded-md border border-border bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground"
        >
          Already running {MAX_CONCURRENT_STREAMS} chats — wait until one of
          them completes before starting another.
        </div>
      )}

      <div className="relative mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your client feedback…"
          rows={MIN_ROWS}
          aria-label="Message input"
          className={cn(
            "flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5",
            "text-sm leading-relaxed placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "scrollbar-thin"
          )}
        />

        {isStreaming ? (
          /* Stop button — visible during streaming */
          <Button
            variant="destructive"
            size="icon"
            onClick={onCancelStream}
            aria-label="Stop generating"
            className="h-10 w-10 shrink-0 rounded-xl"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          /* Send button — visible when idle */
          <Button
            variant="default"
            size="icon"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="h-10 w-10 shrink-0 rounded-xl"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted-foreground/70">
        AI-generated responses may be inaccurate. Please verify all data before acting on it.
      </p>
    </div>
  );
}
