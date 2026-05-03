/**
 * Default extraction guidance (user-editable).
 *
 * Since PRD-018, the extraction system prompt is owned by `structured-extraction.ts`
 * and produces a JSON object validated against `extractionSchema`. The content
 * exported from this file is the default value the user sees in the prompt
 * editor at `/settings/prompts` for the `signal_extraction` key. It is appended
 * to the user message as *additional guidance* (see
 * `buildStructuredExtractionUserMessage` in `structured-extraction.ts`) — it
 * cannot change the output schema or override the system prompt.
 *
 * PRD-031 Part 1: previous content was the legacy markdown-output system prompt
 * (section headings, formatting rules, "No signals identified." placeholders).
 * That content was carried forward as user-editable guidance after the JSON
 * migration even though the formatting rules became irrelevant — and in some
 * cases actively confusing to the model. The replacement is short, advisory,
 * and explicit about what guidance can and cannot do.
 */

export const SIGNAL_EXTRACTION_SYSTEM_PROMPT = `Add any extra guidance the model should follow when extracting signals — for example, industry-specific terminology, recurring competitor names, severity heuristics, or rules for how to interpret particular phrases. Leave this blank to use the default extraction logic with no additional guidance.

Examples:
- "Treat any mention of 'data residency' or 'compliance' as a pain point."
- "When the customer references a quarter-end timeline, set urgency to 'high' even if the wording is mild."
- "If the customer names a tool we treat as a direct competitor, classify it as type='competitor' in toolsAndPlatforms."

Note: the output structure (categories, fields, schema) is fixed by the system prompt and cannot be changed from here. This guidance only shapes how the model interprets the raw notes — what it pays attention to, what wording to weigh more heavily, and how to disambiguate between categories.`;
