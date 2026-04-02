# PRD-009: AI Provider Abstraction — Multi-Provider Support via Vercel AI SDK

> **Master PRD Section:** Section 3 — Synthesis Dashboard (amendment)
> **Status:** Implemented (2026-04-02)
> **Deliverable:** Developers can switch AI provider and model via environment variables. No code changes required to swap between Anthropic, OpenAI, Google, and others.

## Purpose

The AI layer is currently hardcoded to Anthropic's Claude API. The `ai-service.ts` file directly imports the `@anthropic-ai/sdk`, uses Anthropic-specific error classes for retry logic, and reads `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` environment variables. Switching to a different provider (OpenAI, Google, Mistral, etc.) requires rewriting the entire service.

This PRD replaces the direct Anthropic integration with the Vercel AI SDK — a unified interface that supports 20+ providers behind a single `generateText()` API. The result: switching providers becomes a one-line env var change.

This matters for three reasons:

1. **Cost flexibility.** Different models have different price/performance profiles. A developer should be able to test with a cheaper model and run production with a stronger one — without touching code.
2. **Provider resilience.** If one provider has an outage, switching to another is an env var change and a redeploy — not a code change, PR, and deploy cycle.
3. **Model evaluation.** As new models launch, developers can evaluate them against their own prompts instantly by swapping the model string.

## User Story

As a developer deploying Synthesiser, I want to set my preferred AI provider and model in environment variables, so that I can use whichever LLM best fits my cost, quality, and availability needs — without modifying application code.

---

## Part 1: Replace Anthropic SDK with Vercel AI SDK

**Scope:** Swap the internal `callClaude()` function in `ai-service.ts` to use the Vercel AI SDK's `generateText()`. The public API of the service (`extractSignals`, `synthesiseMasterSignal`) does not change.

### Requirements

- **P1.R1** Install the Vercel AI SDK core package (`ai`) and provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`). Remove the direct `@anthropic-ai/sdk` dependency.
- **P1.R2** Replace the `callClaude()` function with a provider-agnostic `callModel()` function that uses `generateText()` from the Vercel AI SDK.
- **P1.R3** Create a `resolveModel()` helper that reads `AI_PROVIDER` and `AI_MODEL` from environment variables and returns the appropriate SDK model instance. Supported providers at launch: `anthropic`, `openai`, `google`.
- **P1.R4** The `resolveModel()` helper throws a clear `AIConfigError` if `AI_PROVIDER` or `AI_MODEL` is missing or if the provider is not supported.
- **P1.R5** Replace Anthropic-specific retry logic (checking `Anthropic.RateLimitError`, `Anthropic.InternalServerError`, etc.) with generic error handling. The Vercel AI SDK normalises errors — retry on network errors, rate limits, and 5xx responses. Do not retry 4xx errors (prompt/config bugs).
- **P1.R6** The existing error classes (`AIServiceError`, `AIEmptyResponseError`, `AIRequestError`, `AIConfigError`) are retained so API routes continue to map errors to the correct HTTP status codes.
- **P1.R7** The public functions `extractSignals()` and `synthesiseMasterSignal()` are unchanged. No caller modifications needed.
- **P1.R8** Replace `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` environment variables with `AI_PROVIDER`, `AI_MODEL`, and per-provider API key variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`). Only the key for the active provider needs to be set.
- **P1.R9** Update `.env.example` with the new variables and inline comments explaining the format.
- **P1.R10** Update `ARCHITECTURE.md`, `CLAUDE.md`, and `CHANGELOG.md` to reflect the new AI integration pattern.

### Acceptance Criteria

- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] `@anthropic-ai/sdk` is no longer in `package.json` dependencies
- [ ] Setting `AI_PROVIDER=anthropic` and `AI_MODEL=claude-sonnet-4-20250514` with a valid `ANTHROPIC_API_KEY` produces the same signal extraction and master signal output as before
- [ ] Setting `AI_PROVIDER=openai` and `AI_MODEL=gpt-4o` with a valid `OPENAI_API_KEY` produces signal extraction and master signal output
- [ ] Setting `AI_PROVIDER=google` and `AI_MODEL=gemini-2.0-flash` with a valid `GOOGLE_GENERATIVE_AI_API_KEY` produces signal extraction and master signal output
- [ ] Missing or invalid `AI_PROVIDER` or `AI_MODEL` returns a clear error message
- [ ] Retry logic works for transient failures (rate limit, server error, network timeout)
- [ ] Non-retryable errors (bad request / 400) are thrown immediately without retrying
- [ ] No references to `@anthropic-ai/sdk`, `Anthropic`, or `CLAUDE_MODEL` remain in application code

---

## Backlog (Future — Not Part of This PRD)

- **Fully user-configurable AI.** Users can select their preferred provider and model from the Settings page — no env vars, no developer involvement. The choice is stored per user in the database and used at runtime for all AI operations. Every user can run a different model if they want.
- **Per-user API keys.** Users provide their own API keys so the platform doesn't bear the cost. Keys are stored encrypted in the database and used transparently when making AI calls.
- **Cost visibility.** Token usage and estimated cost are logged per call. Users can see their AI spend on the Settings page — broken down by operation (signal extraction vs. master signal), model, and time period.
- **Streaming responses.** Use `streamText()` instead of `generateText()` for real-time output in the UI (e.g., progressive signal extraction rendering).
- **Structured output via `generateObject()`.** Use the SDK's built-in Zod schema validation for structured JSON output instead of manual `JSON.parse()` + Zod.
- **Additional providers.** Add support for Mistral, Groq, DeepSeek, Amazon Bedrock, and other providers supported by the Vercel AI SDK as demand arises.
