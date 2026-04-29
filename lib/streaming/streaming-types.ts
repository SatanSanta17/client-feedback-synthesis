// ---------------------------------------------------------------------------
// Streaming Types — shapes consumed across the streaming module (PRD-024)
// ---------------------------------------------------------------------------
// The slice carries every field that any later part of PRD-024 needs, even
// when unused at first — so adding fields later doesn't require migration.
// ---------------------------------------------------------------------------

import type { ChatSource, Message, StreamState } from "@/lib/types/chat";

export interface ConversationStreamSlice {
  conversationId: string;
  /** Workspace tag — NULL = personal. Used by Part 5 for workspace-filtered indicators. */
  teamId: string | null;
  streamState: StreamState;
  streamingContent: string;
  statusText: string | null;
  latestSources: ChatSource[] | null;
  latestFollowUps: string[];
  error: string | null;
  assistantMessageId: string | null;
  /** Part 4 R2: solid-dot indicator state when a stream completes off-view. */
  hasUnseenCompletion: boolean;
  /**
   * Set on the streaming→idle transition. Consumed by useChat in Part 2 to
   * fold the message into messages[] in the same render commit (P2.R7).
   * Cleared by the consumer once read.
   */
  finalMessage: Message | null;
  /** ms epoch — for ordering and stale-stream detection. */
  startedAt: number;
}

export interface StartStreamArgs {
  conversationId: string;
  teamId: string | null;
  userMessage: string;
  userMessageId: string;
  /**
   * Fires once when the server confirms the new conversation row via the
   * X-Conversation-Id response header. Preserves the Gap P9 contract — the
   * caller (useChat) is responsible for generating the UUID up front.
   */
  onConversationCreated?: (id: string) => void;
}

/**
 * Default values for a fresh slice. Spread into setSlice when starting a
 * stream — conversationId/teamId/startedAt are filled in by the caller.
 */
export const IDLE_SLICE_DEFAULTS = {
  streamState: "idle" as StreamState,
  streamingContent: "",
  statusText: null,
  latestSources: null,
  latestFollowUps: [] as string[],
  error: null,
  assistantMessageId: null,
  hasUnseenCompletion: false,
  finalMessage: null,
} as const;
