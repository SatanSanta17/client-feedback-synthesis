// ---------------------------------------------------------------------------
// Streaming module — public API surface (PRD-024)
// ---------------------------------------------------------------------------
// Consumers import from "@/lib/streaming" only. Internal modules
// (streaming-store, streaming-actions, streaming-hooks, streaming-types) are
// not imported directly outside lib/streaming/.
// ---------------------------------------------------------------------------

export type {
  ConversationStreamSlice,
  StartStreamArgs,
} from "./streaming-types";

export {
  startStream,
  cancelStream,
  markConversationViewed,
  markFinalMessageConsumed,
  clearAllStreams,
} from "./streaming-actions";

export {
  useStreamingSlice,
  useIsStreaming,
  useActiveStreamIds,
  useActiveStreamCount,
  useUnseenCompletionIds,
  useHasAnyUnseenCompletion,
} from "./streaming-hooks";
