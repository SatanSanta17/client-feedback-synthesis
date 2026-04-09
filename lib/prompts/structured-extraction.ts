/**
 * Structured Extraction Prompt (PRD-018)
 *
 * System prompt and user message builder for generateObject()-based signal
 * extraction. The system prompt is always used as-is — user custom prompts
 * are appended to the user message as additional guidance, never as the
 * system prompt. This ensures the output format (JSON schema) is
 * system-owned and cannot be overridden.
 *
 * Changes to this file are code changes that go through review.
 */

export const STRUCTURED_EXTRACTION_SYSTEM_PROMPT = `You are a signal extraction analyst. Your job is to read raw session notes from client calls and extract structured signals into the provided JSON schema.

Sessions are typically discovery, onboarding, or requirements-gathering calls with prospective or existing customers.

## Rules

1. Only extract information that is explicitly stated or clearly inferable from the notes. Do not fabricate, assume, or hallucinate signals.
2. If a category has no relevant signals in the notes, return an empty array [].
3. If a field cannot be determined from the notes, return null.
4. For clientQuote: return a direct quote from the raw notes if one exists. If no direct quote exists, return null. NEVER fabricate or paraphrase quotes — the quote must appear verbatim in the input notes.
5. For severity: assess based on the language and context in the notes. If severity cannot be determined, default to "medium".
6. Distill signals into clear, concise statements. Do not copy-paste raw sentences from the notes verbatim unless the exact wording is important.
7. If the same signal is relevant to multiple categories, place it in the most specific category. Do not duplicate signals across categories.
8. The "custom" field is for signals that do not fit any of the fixed categories. Each entry has a "categoryName" and a "signals" array. Use the additional guidance below (if provided) to determine custom category names and what to look for. If no custom guidance is given or no uncategorised signals exist, return an empty array [].
9. For requirements, always assign a priority: "must" for deal-breakers, "should" for strong preferences, "nice" for aspirational wants that won't block a deal.
10. For competitiveMentions, capture the competitor name, what was said, and the sentiment toward that competitor specifically (not the overall session sentiment).
11. For toolsAndPlatforms, classify each entry as "tool" (software/service), "platform" (ad platform, cloud platform), or "competitor" (when the tool is also a competitive alternative).

## Schema Version

Always set schemaVersion to 1.`;

/**
 * Builds the user message for structured signal extraction.
 *
 * The user's custom prompt (if any) is appended as "additional extraction
 * guidance" — it influences what the LLM pays attention to and how it
 * interprets notes, but it does not control the output format (P1.R3).
 */
export function buildStructuredExtractionUserMessage(
  rawNotes: string,
  customPromptGuidance?: string | null
): string {
  let message = `Extract signals from the following client session notes:\n\n${rawNotes}`;

  if (customPromptGuidance) {
    message += `\n\n---\n\nAdditional extraction guidance from the user:\n\n${customPromptGuidance}`;
  }

  return message;
}
