// ---------------------------------------------------------------------------
// Chat Stream Service (PRD-020 Part 2; cutover at PRD-033 Part 3)
// ---------------------------------------------------------------------------
// Orchestrates the AI streaming pipeline: builds the ChatToolContext, wires
// the agentic primitive tool surface (PRD-033 Parts 1 & 2), applies prompt-
// cache markers (Part 3), wraps tools with the per-turn cost circuit breaker
// (Part 3), emits SSE events, and finalises the assistant message.
//
// Framework-agnostic: no imports from next/server or HTTP concepts.
// ---------------------------------------------------------------------------

import { streamText, stepCountIs } from "ai";

import {
  sseEvent,
  parseFollowUps,
  deduplicateSources,
} from "@/lib/utils/chat-helpers";
import { clampOutputTokens } from "@/lib/services/ai-provider-limits";
import {
  buildSystemPrompt,
  CHAT_MAX_TOKENS,
  CHAT_PROMPT_VERSION,
} from "@/lib/prompts/chat-prompt";
import { createChatTools } from "@/lib/services/chat-tools";
import { createChatQueryRepository } from "@/lib/repositories/supabase/supabase-chat-query-repository";
import {
  CHAT_PER_TURN_BUDGET,
  createCostBudgetTracker,
} from "@/lib/services/chat-cost-budget";
import {
  applyPromptCacheMarkers,
  readCacheTelemetry,
} from "@/lib/services/chat-prompt-cache";

import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatService, ContextMessage } from "@/lib/services/chat-service";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";
import type { ChatSource } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[chat-stream-service]";
const CHAT_STEP_CAP = 10;

// ---------------------------------------------------------------------------
// Dependencies interface
// ---------------------------------------------------------------------------

export interface ChatStreamDeps {
  model: LanguageModel;
  modelLabel: string;
  chatService: ChatService;
  embeddingRepo: EmbeddingRepository;
  /** RLS-protected client (carries user cookies) — used for aggregation tools. */
  anonClient: SupabaseClient;
  /** Service-role client — used for the ChatQueryRepository cross-table joins. */
  serviceClient: SupabaseClient;
  teamId: string | null;
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  isNewConversation: boolean;
  contextMessages: ContextMessage[];
  abortSignal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a ReadableStream that emits typed SSE events for the chat
 * streaming pipeline. The stream:
 *
 * 1. Builds the ChatToolContext (workspace, repos, status emitter, cost tracker)
 * 2. Calls streamText with the wrapped agentic tool surface
 * 3. Emits `status` events during tool execution
 * 4. Emits `delta` events for text chunks
 * 5. On completion: parses follow-ups, deduplicates sources, finalises
 *    the assistant message, and emits `sources`, `follow_ups`, `done`
 * 6. On error: marks the message as failed and emits an `error` event
 */
export function createChatStream(deps: ChatStreamDeps): ReadableStream {
  const {
    model,
    modelLabel,
    chatService,
    embeddingRepo,
    anonClient,
    serviceClient,
    teamId,
    userId,
    conversationId,
    assistantMessageId,
    isNewConversation,
    contextMessages,
    abortSignal,
  } = deps;

  const encoder = new TextEncoder();
  const collectedSources: ChatSource[] = [];

  return new ReadableStream({
    async start(controller) {
      // Lifted to outer scope so the catch can preserve partial content when
      // the stream is aborted or errors mid-flight.
      let fullText = "";
      const toolsCalled: string[] = [];

      const emitStatus = (text: string): void => {
        controller.enqueue(encoder.encode(sseEvent("status", { text })));
      };

      // Build the per-turn cost circuit breaker. Logs telemetry on trip.
      const budgetTracker = createCostBudgetTracker(CHAT_PER_TURN_BUDGET, {
        onBudgetExceeded: (info) => {
          console.warn(
            `${LOG_PREFIX} per-turn cost budget exceeded — totalTokensAtTrip: ${info.totalTokensAtTrip}, callsBeforeTrip: ${info.callsBeforeTrip}, callsRejected: ${info.callsRejected}, toolCounts: ${JSON.stringify(info.toolCounts)}`
          );
          emitStatus("Query is broad — synthesising a partial answer.");
        },
      });

      const chatQueryRepo = createChatQueryRepository(
        serviceClient,
        teamId,
        userId
      );

      // Build the tool registry, then wrap each tool's execute() with the
      // per-turn cost budget guard. Tool factories never see the budget
      // logic — the wrapper records tool-result tokens internally.
      const baseTools = createChatTools({
        workspace: { teamId, userId },
        chatQueryRepo,
        embeddingRepo,
        supabaseClient: anonClient,
        emitStatus,
      });
      const tools = budgetTracker.wrap(baseTools);

      try {
        // System prompt is passed via `messages[0]` (not the `system` field)
        // so provider-specific cache markers (Anthropic `cache_control`) can
        // apply. No-op for providers without explicit caching.
        const systemPrompt = buildSystemPrompt({
          date: new Date().toISOString().split("T")[0],
        });
        const messages = applyPromptCacheMarkers(
          systemPrompt,
          contextMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );

        const result = streamText({
          model,
          messages,
          tools,
          stopWhen: stepCountIs(CHAT_STEP_CAP),
          maxOutputTokens: clampOutputTokens(CHAT_MAX_TOKENS, modelLabel),
          abortSignal,
        });

        controller.enqueue(
          encoder.encode(sseEvent("status", { text: "Generating answer..." }))
        );

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              fullText += part.text;
              controller.enqueue(
                encoder.encode(sseEvent("delta", { text: part.text }))
              );
              break;

            case "tool-call":
              toolsCalled.push(part.toolName);
              // Collect source citations from retrieval-shaped tool calls.
              // The new surface emits chunk results via semantic_search and
              // fetch_signals (both return clientName + sessionDate + text).
              break;

            case "tool-result":
              collectSourcesFromToolResult(part, collectedSources);
              break;

            case "error":
              console.error(`${LOG_PREFIX} stream error:`, part.error);
              await chatService.updateMessage(assistantMessageId, {
                status: "failed",
                content: fullText || "",
              });
              controller.enqueue(
                encoder.encode(
                  sseEvent("error", {
                    message:
                      "An error occurred while generating the response.",
                  })
                )
              );
              controller.close();
              return;
          }
        }

        // Stream complete — detect truncation modes.
        const finishReason = await result.finishReason;
        const stepCount = (await result.steps).length;
        const usage = await result.usage;
        const cacheTelemetry = readCacheTelemetry(
          usage as unknown as Record<string, unknown> | undefined
        );
        const wasStepTruncated = finishReason === "tool-calls";
        const wasLengthTruncated = finishReason === "length";

        if (wasStepTruncated) {
          const warning =
            "\n\n_Note: this answer may be incomplete — I reached my reasoning step limit before finishing. Try a follow-up to dig deeper._";
          fullText += warning;
          controller.enqueue(
            encoder.encode(sseEvent("delta", { text: warning }))
          );
        } else if (wasLengthTruncated) {
          const warning =
            "\n\n_Note: this answer was cut off before completing — try a more focused follow-up to see the rest._";
          fullText += warning;
          controller.enqueue(
            encoder.encode(sseEvent("delta", { text: warning }))
          );
        }

        const { cleanContent, followUps } = parseFollowUps(fullText);
        const uniqueSources = deduplicateSources(collectedSources);

        await chatService.updateMessage(assistantMessageId, {
          content: cleanContent,
          sources: uniqueSources.length > 0 ? uniqueSources : null,
          status: "completed",
          metadata: {
            model: modelLabel,
            toolsCalled,
            promptVersion: CHAT_PROMPT_VERSION,
          },
        });

        console.log(
          `${LOG_PREFIX} stream complete — steps: ${stepCount}, finishReason: ${finishReason}, usage: input=${usage?.inputTokens ?? "?"}, output=${usage?.outputTokens ?? "?"}, total=${usage?.totalTokens ?? "?"}, cache-hit-input=${cacheTelemetry.cacheHitInputTokens}, cache-miss-input=${cacheTelemetry.cacheMissInputTokens}, tool-result-tokens=${budgetTracker.total()}, budget-exceeded=${budgetTracker.isExceeded()}, content: ${cleanContent.length} chars, sources: ${uniqueSources.length}, followUps: ${followUps.length}, promptVersion: ${CHAT_PROMPT_VERSION}${wasStepTruncated ? " (step-truncated)" : wasLengthTruncated ? " (length-truncated)" : ""}`
        );

        if (uniqueSources.length > 0) {
          controller.enqueue(
            encoder.encode(sseEvent("sources", { sources: uniqueSources }))
          );
        }

        if (followUps.length > 0) {
          controller.enqueue(
            encoder.encode(
              sseEvent("follow_ups", { questions: followUps })
            )
          );
        }

        controller.enqueue(
          encoder.encode(
            sseEvent("done", {
              conversationId,
              assistantMessageId,
              isNewConversation,
            })
          )
        );

        controller.close();
      } catch (err) {
        const isAbort =
          abortSignal.aborted ||
          (err instanceof Error && err.name === "AbortError");
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        if (isAbort) {
          console.log(
            `${LOG_PREFIX} stream aborted by client — preserving ${fullText.length} chars of partial content`
          );
        } else {
          console.error(
            `${LOG_PREFIX} stream fatal error: ${errMsg} — preserving ${fullText.length} chars of partial content`
          );
        }

        try {
          await chatService.updateMessage(assistantMessageId, {
            status: isAbort ? "cancelled" : "failed",
            content: fullText || "",
          });
        } catch (updateErr) {
          const updateMsg =
            updateErr instanceof Error ? updateErr.message : "Unknown";
          console.error(
            `${LOG_PREFIX} failed to update message status: ${updateMsg}`
          );
        }

        if (!isAbort) {
          try {
            controller.enqueue(
              encoder.encode(
                sseEvent("error", {
                  message:
                    "An error occurred while generating the response.",
                })
              )
            );
          } catch {
            // Controller may already be closed
          }
        }

        try {
          controller.close();
        } catch {
          // Controller may already be closed
        }
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Source collection — pulls citation-shaped rows from retrieval tool results
// (semantic_search, fetch_signals, fetch_session_content). Other tools return
// counts / distributions / digests and don't produce citation rows.
// ---------------------------------------------------------------------------

interface ToolResultPart {
  type: "tool-result";
  toolName: string;
  output?: unknown;
}

function collectSourcesFromToolResult(
  part: unknown,
  acc: ChatSource[]
): void {
  if (!part || typeof part !== "object") return;
  const p = part as Partial<ToolResultPart>;
  if (p.type !== "tool-result") return;
  const toolName = p.toolName;
  const output = p.output;
  if (!toolName || !output) return;

  // semantic_search → array of { sessionId, clientName, sessionDate, chunkType, text, score }
  if (toolName === "semantic_search" && Array.isArray(output)) {
    for (const row of output) {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        if (
          typeof r.sessionId === "string" &&
          typeof r.clientName === "string" &&
          typeof r.sessionDate === "string" &&
          typeof r.text === "string"
        ) {
          acc.push({
            sessionId: r.sessionId,
            clientName: r.clientName,
            sessionDate: r.sessionDate,
            chunkType: typeof r.chunkType === "string" ? r.chunkType : "raw",
            chunkText: r.text,
          });
        }
      }
    }
    return;
  }

  // fetch_signals → array of { sessionId, clientName, sessionDate, chunkType, text, ... }
  if (toolName === "fetch_signals" && Array.isArray(output)) {
    for (const row of output) {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        if (
          typeof r.sessionId === "string" &&
          typeof r.clientName === "string" &&
          typeof r.sessionDate === "string" &&
          typeof r.text === "string"
        ) {
          acc.push({
            sessionId: r.sessionId,
            clientName: r.clientName,
            sessionDate: r.sessionDate,
            chunkType: typeof r.chunkType === "string" ? r.chunkType : "raw",
            chunkText: r.text,
          });
        }
      }
    }
    return;
  }

  // fetch_session_content → { sessions: [...] }, each session has chunks[]
  if (
    toolName === "fetch_session_content" &&
    output &&
    typeof output === "object"
  ) {
    const o = output as Record<string, unknown>;
    const sessions = o.sessions;
    if (Array.isArray(sessions)) {
      for (const session of sessions) {
        if (!session || typeof session !== "object") continue;
        const s = session as Record<string, unknown>;
        if (typeof s.sessionId !== "string") continue;
        const sessionId = s.sessionId;
        const clientName =
          typeof s.clientName === "string" ? s.clientName : "Unknown";
        const sessionDate =
          typeof s.sessionDate === "string" ? s.sessionDate : "";
        const chunks = s.chunks;
        if (Array.isArray(chunks)) {
          for (const chunk of chunks) {
            if (!chunk || typeof chunk !== "object") continue;
            const c = chunk as Record<string, unknown>;
            if (typeof c.text === "string") {
              acc.push({
                sessionId,
                clientName,
                sessionDate,
                chunkType: typeof c.type === "string" ? c.type : "raw",
                chunkText: c.text,
              });
            }
          }
        }
      }
    }
  }
}
