/**
 * Conversation Title Generation Prompt (PRD-020 Part 2)
 *
 * Lightweight prompt for generating a concise 5-8 word title for a new
 * conversation based on the user's first message. Used by the fire-and-forget
 * title generation flow in ai-service.ts.
 *
 * Changes to this file are code changes that go through review.
 */

export const GENERATE_TITLE_SYSTEM_PROMPT = `Generate a concise 5-8 word title that summarises the user's question or intent. The title should be descriptive enough to recognise the conversation later in a list.

Rules:
- Return ONLY the title text — no quotes, no preamble, no explanation.
- Do not start with "Title:" or any label.
- Use sentence case (capitalise only the first word and proper nouns).
- Keep it under 60 characters.
- If the message is vague or very short, create the best title you can from what's given.`;

export const GENERATE_TITLE_MAX_TOKENS = 30;
