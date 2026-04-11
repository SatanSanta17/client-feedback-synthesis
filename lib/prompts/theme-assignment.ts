/**
 * Theme Assignment Prompt (PRD-021 Part 1)
 *
 * System prompt and user message builder for generateObject()-based theme
 * classification. Each signal chunk from a session extraction is assigned
 * to one or more topic-based themes (existing or new).
 *
 * Changes to this file are code changes that go through review.
 */

export const THEME_ASSIGNMENT_SYSTEM_PROMPT = `You are a theme classification analyst. Your job is to assign each signal from a client feedback session to the most appropriate topic-based theme.

## Rules

1. Themes describe WHAT a signal is about (e.g., "Onboarding Friction", "Pricing Concerns", "API Performance", "Data Migration"), NOT what type of signal it is. The chunk_type field already captures whether something is a pain point, requirement, blocker, etc. — do not duplicate that as a theme.
2. STRONGLY prefer assigning to an existing theme. Only suggest a new theme if the signal covers a topic genuinely not represented by any existing theme. When in doubt, use the closest existing theme.
3. New theme names should be concise (2-4 words), human-readable, and topic-focused. Include a one-sentence description explaining what the theme covers.
4. For ALL signal chunks (structured and raw): assign one PRIMARY theme with the highest confidence, and optionally one or more SECONDARY themes when the signal genuinely spans multiple topics. Only add secondary themes when the signal substantively covers another topic — not for tangential mentions.
5. For raw text chunks (chunk_type: "raw"): multiple themes are more common since raw paragraphs often mix topics. Report lower confidence scores (0.3–0.7) for raw chunk assignments.
6. Confidence scores: PRIMARY theme should be 0.8–1.0 for clear matches, 0.6–0.8 for reasonable matches. SECONDARY themes should be 0.5–0.7 to reflect they are not the main topic. For raw chunks, all assignments use 0.3–0.7. For new themes, use 0.8+ on the primary assignment (since you created the theme specifically for this signal).
7. Consider both the signal text and the client quote (if provided) when determining the theme.
8. Do not create themes that are too broad ("General Feedback") or too narrow ("Button Color on Page 3"). Aim for a level of specificity that would be useful for tracking trends across multiple sessions.`;

export const THEME_ASSIGNMENT_MAX_TOKENS = 2048;

/**
 * Builds the user message for theme assignment.
 *
 * Constructs a message containing:
 * 1. The existing theme list (name + description), or a "No existing themes" note.
 * 2. A numbered list of signals with index, chunk_type, text, and client_quote.
 */
export function buildThemeAssignmentUserMessage(
  signals: Array<{
    index: number;
    text: string;
    chunkType: string;
    clientQuote?: string;
  }>,
  existingThemes: Array<{
    name: string;
    description: string | null;
  }>
): string {
  // Section 1: Existing themes
  let message = "## Existing Themes\n\n";

  if (existingThemes.length === 0) {
    message += "No existing themes yet. You may create new themes as needed.\n";
  } else {
    existingThemes.forEach((theme, i) => {
      const desc = theme.description ? ` — ${theme.description}` : "";
      message += `${i + 1}. ${theme.name}${desc}\n`;
    });
  }

  // Section 2: Signals to classify
  message += "\n## Signals to Classify\n\n";

  signals.forEach((signal) => {
    message += `[${signal.index}] (${signal.chunkType}) "${signal.text}"\n`;
    message += `   Client quote: ${signal.clientQuote ? `"${signal.clientQuote}"` : "null"}\n\n`;
  });

  return message.trimEnd();
}
