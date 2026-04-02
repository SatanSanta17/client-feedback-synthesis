import Anthropic from "@anthropic-ai/sdk";
import {
  SIGNAL_EXTRACTION_SYSTEM_PROMPT,
  buildSignalExtractionUserMessage,
} from "@/lib/prompts/signal-extraction";
import {
  MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
  buildMasterSignalUserMessage,
} from "@/lib/prompts/master-signal-synthesis";
import { getActivePrompt } from "@/lib/services/prompt-service";
import type { SignalSession } from "@/lib/services/master-signal-service";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// Token limits per operation
const EXTRACT_SIGNALS_MAX_TOKENS = 4096;
const MASTER_SIGNAL_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Extract signals from raw session notes using Claude.
 * Returns a markdown-formatted signal extraction report.
 * Retries transient failures (429, 500, timeout) with exponential backoff.
 * Throws on non-retryable errors or after exhausting retries.
 */
export async function extractSignals(rawNotes: string): Promise<string> {
  const dbPrompt = await getActivePrompt("signal_extraction");
  const systemPrompt = dbPrompt ?? SIGNAL_EXTRACTION_SYSTEM_PROMPT;

  const userMessage = buildSignalExtractionUserMessage(rawNotes);

  return callClaude({
    systemPrompt,
    userMessage,
    maxTokens: EXTRACT_SIGNALS_MAX_TOKENS,
    operationName: "extractSignals",
  });
}

/**
 * Input for the master signal synthesis function.
 */
export interface MasterSignalInput {
  /** The previous master signal markdown. Null/undefined for cold start. */
  previousMasterSignal?: string | null;
  /** The session signals to incorporate. */
  sessions: SignalSession[];
}

/**
 * Synthesise a master signal document from individual session signals.
 *
 * - Cold start (no previousMasterSignal): synthesises from all provided sessions.
 * - Incremental (previousMasterSignal provided): merges new sessions into the
 *   existing master signal.
 *
 * Returns a markdown-formatted master signal document.
 * Retries transient failures with exponential backoff.
 */
export async function synthesiseMasterSignal(
  input: MasterSignalInput
): Promise<string> {
  const { previousMasterSignal, sessions } = input;

  const isIncremental = !!previousMasterSignal;
  const promptKey = isIncremental
    ? "master_signal_incremental" as const
    : "master_signal_cold_start" as const;

  const dbPrompt = await getActivePrompt(promptKey);
  const systemPrompt = dbPrompt
    ?? (isIncremental
      ? MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT
      : MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT);

  const userMessage = buildMasterSignalUserMessage(
    sessions,
    previousMasterSignal
  );

  console.log(
    `[ai-service] synthesiseMasterSignal — mode: ${isIncremental ? "incremental" : "cold start"}, sessions: ${sessions.length}`
  );

  return callClaude({
    systemPrompt,
    userMessage,
    maxTokens: MASTER_SIGNAL_MAX_TOKENS,
    operationName: "synthesiseMasterSignal",
  });
}

// ---------------------------------------------------------------------------
// Shared Claude call with retry logic
// ---------------------------------------------------------------------------

interface CallClaudeOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  operationName: string;
}

/**
 * Calls the Claude API with retry logic for transient failures.
 * Returns the text content from the response.
 * Throws typed errors that the API route can map to HTTP status codes.
 */
async function callClaude(options: CallClaudeOptions): Promise<string> {
  const { systemPrompt, userMessage, maxTokens, operationName } = options;

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const model = process.env.CLAUDE_MODEL;
  if (!model) {
    throw new AIConfigError("CLAUDE_MODEL environment variable is not set");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[ai-service] ${operationName} — attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${model}`
      );

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      // Extract text from the response
      const textBlock = response.content.find(
        (block) => block.type === "text"
      );
      if (!textBlock || textBlock.type !== "text" || !textBlock.text.trim()) {
        throw new AIEmptyResponseError("Claude returned an empty response");
      }

      console.log(
        `[ai-service] ${operationName} — success, ${textBlock.text.length} chars`
      );
      return textBlock.text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry non-transient errors
      if (err instanceof Anthropic.BadRequestError) {
        console.error(
          `[ai-service] ${operationName} — bad request (not retrying):`,
          lastError.message
        );
        throw new AIRequestError(
          `Claude rejected the request: ${lastError.message}`
        );
      }

      // Don't retry our own validation errors
      if (
        err instanceof AIEmptyResponseError ||
        err instanceof AIConfigError
      ) {
        throw err;
      }

      // Retry transient errors (rate limit, server error, timeout)
      const isRetryable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError;

      if (!isRetryable || attempt >= MAX_RETRIES) {
        console.error(
          `[ai-service] ${operationName} — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw new AIServiceError(
          `${operationName} failed after ${attempt + 1} attempts: ${lastError.message}`
        );
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[ai-service] ${operationName} — retryable error (attempt ${attempt + 1}), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should not reach here, but TypeScript needs it
  throw new AIServiceError(
    `${operationName} failed: ${lastError?.message ?? "unknown error"}`
  );
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Error classes for AI service failures.
 * These allow the API route to map errors to appropriate HTTP status codes.
 */
export class AIServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIServiceError";
  }
}

export class AIEmptyResponseError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIEmptyResponseError";
  }
}

export class AIRequestError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIRequestError";
  }
}

export class AIConfigError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}
