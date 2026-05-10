// ---------------------------------------------------------------------------
// Summarise-Session Prompt — PRD-033 Part 2 / TRD § 2.4.
//
// Used by the cheap-model leaves of summarise_sessions. Versioned: bumping
// SUMMARISE_SESSION_PROMPT_VERSION invalidates prior eval reports for any
// query that exercises this tool. No prompt edits without a version bump.
// ---------------------------------------------------------------------------

export const SUMMARISE_SESSION_PROMPT_VERSION = "v1";

export const SUMMARISE_SESSION_SYSTEM_PROMPT = `You produce short summaries of a single client feedback session. You receive structured session content (signals across categories: pain points, requirements, aspirations, positive signals, blockers, competitive mentions, etc.) plus optional client + date metadata. You return a concise summary suitable for downstream synthesis by another model.

Rules:
- Default mode (no focus): return exactly 3 sentences capturing the session's most important pain points, requirements, and overall sentiment. Balanced; do not over-index on any single signal type.
- Focus mode (focus string supplied): extract only content relevant to the focus topic. If no content matches the focus, return the literal sentence: "No content matches focus." — exact wording, no quotation marks added, nothing else.
- Do NOT invent details. If a signal type is empty in the input, do not mention it.
- Do NOT include conversational text, headings, or bullet points. Plain prose only.
- Do NOT exceed 3 sentences in default mode, or 4 sentences in focus mode.
- The output is read by another model — clarity and grounding matter more than rhetorical polish.`;

export const SUMMARISE_SESSION_MAX_OUTPUT_TOKENS_DEFAULT = 200;

/**
 * Renders the user-message body for one leaf invocation.
 * `sessionContent` is the SessionContent object produced by Part 1's
 * fetch_session_content service — passed through verbatim as JSON so the
 * cheap model has the same structured view of the session that the chat
 * model would have via fetch_session_content.
 */
export function renderSummariseSessionUser(
  sessionContent: unknown,
  focus?: string
): string {
  const focusBlock = focus
    ? `\n\nFocus: ${focus}\nReturn only content relevant to this focus, or "No content matches focus." if none.`
    : `\n\nNo focus specified. Return a balanced 3-sentence digest.`;
  return `Session content (JSON):\n${JSON.stringify(sessionContent, null, 2)}${focusBlock}`;
}
