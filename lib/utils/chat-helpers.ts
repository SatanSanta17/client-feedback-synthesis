// ---------------------------------------------------------------------------
// Chat Helpers — Pure utility functions for the chat streaming pipeline
// ---------------------------------------------------------------------------
// Extracted from app/api/chat/send/route.ts for SRP compliance.
// No framework imports, no side effects — pure functions only.
// ---------------------------------------------------------------------------

import type { ChatSource } from "@/lib/types/chat";
import type { RetrievalResult } from "@/lib/types/retrieval-result";

// ---------------------------------------------------------------------------
// SSE encoding
// ---------------------------------------------------------------------------

/**
 * Encode a typed SSE event as a string.
 */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Follow-up parsing
// ---------------------------------------------------------------------------

const FOLLOW_UP_COMPLETE_RE = /<!--follow-ups:(\[[\s\S]*?\])-->/;
const FOLLOW_UP_PARTIAL_RE = /<!--follow-ups:[\s\S]*$/;

/**
 * Parse the follow-up questions from the LLM response.
 * Expected format: <!--follow-ups:["q1","q2","q3"]-->
 * Returns the cleaned content (without the block) and the follow-ups array.
 */
export function parseFollowUps(text: string): {
  cleanContent: string;
  followUps: string[];
} {
  const match = text.match(FOLLOW_UP_COMPLETE_RE);

  if (!match) {
    return { cleanContent: text, followUps: [] };
  }

  try {
    const followUps = JSON.parse(match[1]) as string[];
    if (
      !Array.isArray(followUps) ||
      !followUps.every((q) => typeof q === "string")
    ) {
      return { cleanContent: text, followUps: [] };
    }
    const cleanContent = text.replace(FOLLOW_UP_COMPLETE_RE, "").trimEnd();
    return { cleanContent, followUps };
  } catch {
    return { cleanContent: text, followUps: [] };
  }
}

// ---------------------------------------------------------------------------
// Source mapping and deduplication
// ---------------------------------------------------------------------------

/**
 * Map a retrieval result to a ChatSource object for persistence.
 */
export function toSource(result: RetrievalResult): ChatSource {
  return {
    sessionId: result.sessionId,
    clientName: result.clientName,
    sessionDate: result.sessionDate,
    chunkText: result.chunkText,
    chunkType: result.chunkType,
  };
}

/**
 * Deduplicates sources by sessionId + chunkText combination.
 * Keeps the first occurrence of each unique pair.
 */
export function deduplicateSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Set<string>();
  const unique: ChatSource[] = [];

  for (const source of sources) {
    const key = `${source.sessionId}:${source.chunkText}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(source);
    }
  }

  return unique;
}

// ---------------------------------------------------------------------------
// SSE chunk parsing (client-side decoder)
// ---------------------------------------------------------------------------

export interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse SSE text chunks into typed events.
 * Handles partial chunks by maintaining a buffer — callers concatenate
 * `remaining` onto the next decoded chunk before re-parsing.
 */
export function parseSSEChunk(buffer: string): {
  events: SSEEvent[];
  remaining: string;
} {
  const events: SSEEvent[] = [];
  const lines = buffer.split("\n");
  let currentEvent = "";
  let currentData = "";
  let remaining = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7);
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    } else if (line === "" && currentEvent && currentData) {
      events.push({ event: currentEvent, data: currentData });
      currentEvent = "";
      currentData = "";
    } else if (line === "" && !currentEvent && !currentData) {
      // Empty line between events — skip
    } else {
      // Incomplete chunk — keep as remaining
      remaining = lines.slice(i).join("\n");
      break;
    }
  }

  // If we have partial event data at the end, keep it
  if (currentEvent || currentData) {
    const partial = [];
    if (currentEvent) partial.push(`event: ${currentEvent}`);
    if (currentData) partial.push(`data: ${currentData}`);
    remaining = partial.join("\n") + (remaining ? "\n" + remaining : "");
  }

  return { events, remaining };
}

// ---------------------------------------------------------------------------
// Follow-up block stripping (streaming-time)
// ---------------------------------------------------------------------------

/**
 * Strip a complete `<!--follow-ups:...-->` block OR a trailing partial one
 * (e.g. `<!--follow-ups:["What are cli`) from streaming content so
 * follow-up metadata never flashes in the message bubble during streaming.
 *
 * Distinct from `parseFollowUps` (which returns both clean content and the
 * extracted array on completion); this is a streaming-time helper that only
 * strips and trims.
 */
export function stripFollowUpBlock(text: string): string {
  const complete = text.replace(FOLLOW_UP_COMPLETE_RE, "").trimEnd();
  if (complete !== text) return complete;
  return text.replace(FOLLOW_UP_PARTIAL_RE, "").trimEnd();
}
