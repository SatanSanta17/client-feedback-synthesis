# TRD-009: AI Provider Abstraction — Multi-Provider Support via Vercel AI SDK

> **Status:** Implemented (2026-04-02)
> **PRD:** `docs/009-ai-provider-abstraction/prd.md` (implemented)
> **Mirrors:** PRD Part 1

---

## Part 1: Replace Anthropic SDK with Vercel AI SDK

### Technical Decisions

- **Vercel AI SDK as the abstraction layer.** The `ai` package provides a unified `generateText()` function that works identically across providers. Each provider has a thin adapter package (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`). The SDK calls provider APIs directly — no proxy, no middleware.
- **`resolveModel()` factory driven by env vars.** A single function reads `AI_PROVIDER` and `AI_MODEL`, imports the correct provider, and returns a model instance. Adding a new provider in the future is a single `case` block.
- **Keep custom retry logic.** The Vercel AI SDK does not provide built-in configurable retries with exponential backoff for `generateText()`. We retain the existing retry loop (3 retries, exponential backoff) but replace Anthropic-specific error class checks with generic error inspection (HTTP status codes from the error object).
- **Keep existing error classes.** `AIServiceError`, `AIEmptyResponseError`, `AIRequestError`, `AIConfigError` are unchanged. API routes already map these to HTTP status codes — no caller changes needed.
- **Provider API keys use their standard env var names.** The Vercel AI SDK provider packages read API keys from their standard environment variables automatically (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`). No need to pass keys explicitly in code.
- **Remove `@anthropic-ai/sdk` entirely.** After migration, no direct Anthropic SDK import remains. The `@ai-sdk/anthropic` package handles the Anthropic integration internally.

### New `ai-service.ts` Structure

The file keeps the same structure but replaces the internals:

```
ai-service.ts
├── extractSignals()              — unchanged public API
├── synthesiseMasterSignal()      — unchanged public API
├── resolveModel()                — NEW: reads AI_PROVIDER + AI_MODEL, returns SDK model
├── callModel()                   — RENAMED from callClaude(), uses generateText()
└── Error classes                 — unchanged (AIServiceError, AIEmptyResponseError, etc.)
```

### `resolveModel()` Implementation

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

type SupportedProvider = "anthropic" | "openai" | "google";

const PROVIDER_MAP: Record<SupportedProvider, (modelId: string) => LanguageModel> = {
  anthropic: (modelId) => anthropic(modelId),
  openai: (modelId) => openai(modelId),
  google: (modelId) => google(modelId),
};

function resolveModel(): { model: LanguageModel; label: string } {
  const provider = process.env.AI_PROVIDER;
  const modelId = process.env.AI_MODEL;

  if (!provider) {
    throw new AIConfigError("AI_PROVIDER environment variable is not set");
  }
  if (!modelId) {
    throw new AIConfigError("AI_MODEL environment variable is not set");
  }

  const factory = PROVIDER_MAP[provider as SupportedProvider];
  if (!factory) {
    throw new AIConfigError(
      `Unsupported AI_PROVIDER: "${provider}". Supported: ${Object.keys(PROVIDER_MAP).join(", ")}`
    );
  }

  return {
    model: factory(modelId),
    label: `${provider}/${modelId}`,
  };
}
```

### `callModel()` Implementation

```typescript
import { generateText, APICallError } from "ai";

interface CallModelOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  operationName: string;
}

async function callModel(options: CallModelOptions): Promise<string> {
  const { systemPrompt, userMessage, maxTokens, operationName } = options;
  const { model, label } = resolveModel();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[ai-service] ${operationName} — attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${label}`
      );

      const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: userMessage,
        maxTokens,
      });

      if (!text.trim()) {
        throw new AIEmptyResponseError("Model returned an empty response");
      }

      console.log(
        `[ai-service] ${operationName} — success, ${text.length} chars`
      );
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry our own validation/config errors
      if (err instanceof AIEmptyResponseError || err instanceof AIConfigError) {
        throw err;
      }

      // Don't retry client errors (4xx) — these are prompt/config bugs
      if (APICallError.isInstance(err) && err.statusCode !== undefined && err.statusCode < 500 && err.statusCode !== 429) {
        console.error(
          `[ai-service] ${operationName} — client error (not retrying):`,
          lastError.message
        );
        throw new AIRequestError(
          `Model rejected the request: ${lastError.message}`
        );
      }

      // Retry transient errors (429 rate limit, 5xx server errors, network errors)
      if (attempt >= MAX_RETRIES) {
        console.error(
          `[ai-service] ${operationName} — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw new AIServiceError(
          `${operationName} failed after ${attempt + 1} attempts: ${lastError.message}`
        );
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[ai-service] ${operationName} — retryable error (attempt ${attempt + 1}), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new AIServiceError(
    `${operationName} failed: ${lastError?.message ?? "unknown error"}`
  );
}
```

### Caller Changes

The public functions update their internal call from `callClaude()` to `callModel()`. No signature changes:

```typescript
// Before
return callClaude({ systemPrompt, userMessage, maxTokens, operationName });

// After
return callModel({ systemPrompt, userMessage, maxTokens, operationName });
```

JSDoc comments on `extractSignals` and `synthesiseMasterSignal` are updated to say "AI model" instead of "Claude".

### Environment Variables

**Before:**

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-20250514
```

**After:**

```
# AI Provider — which LLM provider to use
# Supported: anthropic, openai, google
AI_PROVIDER=anthropic

# AI Model — provider-specific model identifier
# Examples: claude-sonnet-4-20250514 (anthropic), gpt-4o (openai), gemini-2.0-flash (google)
AI_MODEL=claude-sonnet-4-20250514

# Provider API keys — only the key for the active provider is required
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GOOGLE_GENERATIVE_AI_API_KEY=...
```

`ANTHROPIC_API_KEY` keeps the same name — the `@ai-sdk/anthropic` package reads it automatically. `CLAUDE_MODEL` is removed.

### Package Changes

**Install:**

```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google
```

**Remove:**

```bash
npm uninstall @anthropic-ai/sdk
```

### Files Changed

| Action | File | Change |
|--------|------|--------|
| Modify | `lib/services/ai-service.ts` | Replace `callClaude()` with `callModel()` + `resolveModel()`. Remove `@anthropic-ai/sdk` import. Update JSDoc. |
| Modify | `package.json` | Add `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`. Remove `@anthropic-ai/sdk`. |
| Modify | `.env.example` | Replace `CLAUDE_MODEL` with `AI_PROVIDER` + `AI_MODEL`. Add commented provider keys. |
| Modify | `ARCHITECTURE.md` | Update AI integration section, env vars table, file map, key design decisions. |
| Modify | `CLAUDE.md` | Update AI conventions — model name env var, provider abstraction. |
| Modify | `CHANGELOG.md` | Add PRD-009 Part 1 entry. |

### Implementation Increments

#### Increment 1.1: Install Packages and Rewrite ai-service.ts

**PR scope:** Package swap + service rewrite + env config update.

**Steps:**

1. Run `npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google`.
2. Run `npm uninstall @anthropic-ai/sdk`.
3. Rewrite `lib/services/ai-service.ts`:
   - Remove `import Anthropic from "@anthropic-ai/sdk"`.
   - Add imports: `import { generateText, APICallError } from "ai"`, `import { anthropic } from "@ai-sdk/anthropic"`, `import { openai } from "@ai-sdk/openai"`, `import { google } from "@ai-sdk/google"`, `import type { LanguageModel } from "ai"`.
   - Add `resolveModel()` function (see implementation above).
   - Replace `callClaude()` with `callModel()` (see implementation above).
   - Update `extractSignals()` and `synthesiseMasterSignal()` to call `callModel()` instead of `callClaude()`.
   - Update JSDoc comments to say "AI model" instead of "Claude".
4. Update `.env.example`: replace `CLAUDE_MODEL` section with `AI_PROVIDER`, `AI_MODEL`, and commented provider key examples.
5. Update `.env` (local): set `AI_PROVIDER=anthropic` and `AI_MODEL=<current model>`. Keep `ANTHROPIC_API_KEY`. Remove `CLAUDE_MODEL`.

**Verify:**
- `npm run build` succeeds
- No references to `@anthropic-ai/sdk`, `Anthropic`, or `CLAUDE_MODEL` in application code
- Signal extraction works with `AI_PROVIDER=anthropic`
- Missing `AI_PROVIDER` or `AI_MODEL` throws a clear error

#### Increment 1.2: Documentation Updates

**PR scope:** Can be combined with 1.1 or shipped separately.

**Steps:**

1. Update `ARCHITECTURE.md`:
   - Replace `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` in env vars table with `AI_PROVIDER`, `AI_MODEL`, and per-provider API key entries.
   - Update the AI integration section in the current state paragraph.
   - Update the `ai-service.ts` description in the file map.
   - Update key design decisions.
2. Update `CLAUDE.md`:
   - Replace `CLAUDE_MODEL` references with `AI_PROVIDER` + `AI_MODEL`.
   - Update the AI integration conventions to describe the provider-agnostic approach.
3. Update `CHANGELOG.md` with PRD-009 Part 1 entry.

**Verify:**
- All file references in documentation exist in the codebase
- Env var names in docs match `.env.example`
- No stale references to `CLAUDE_MODEL` or `@anthropic-ai/sdk`

---

## Full File Impact Summary

| Action | File |
|--------|------|
| Modify | `lib/services/ai-service.ts` |
| Modify | `package.json` |
| Modify | `package-lock.json` (auto-generated) |
| Modify | `.env.example` |
| Modify | `ARCHITECTURE.md` |
| Modify | `CLAUDE.md` |
| Modify | `CHANGELOG.md` |
