import { z } from "zod";

// ---------------------------------------------------------------------------
// chunkTypeEnum — shared Zod enum mirroring `ChunkType` in
// `lib/types/embedding-chunk.ts`. Used by every chat tool whose schema
// accepts a `chunkTypes` filter (semantic_search, list_sessions,
// fetch_signals). Single source of truth so adding a chunk type is a
// one-file change.
// ---------------------------------------------------------------------------

export const chunkTypeEnum = z.enum([
  "summary",
  "client_profile",
  "pain_point",
  "requirement",
  "aspiration",
  "positive_signal",
  "competitive_mention",
  "blocker",
  "tool_and_platform",
  "custom",
  "raw",
]);
