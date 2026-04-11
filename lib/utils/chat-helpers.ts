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

/**
 * Parse the follow-up questions from the LLM response.
 * Expected format: <!--follow-ups:["q1","q2","q3"]-->
 * Returns the cleaned content (without the block) and the follow-ups array.
 */
export function parseFollowUps(text: string): {
  cleanContent: string;
  followUps: string[];
} {
  const pattern = /<!--follow-ups:(\[[\s\S]*?\])-->/;
  const match = text.match(pattern);

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
    const cleanContent = text.replace(pattern, "").trimEnd();
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
