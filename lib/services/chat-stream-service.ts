// ---------------------------------------------------------------------------
// Chat Stream Service (PRD-020 Part 2)
// ---------------------------------------------------------------------------
// Orchestrates the AI streaming pipeline: tool definitions, streamText call,
// SSE event emission, follow-up parsing, source collection, and message
// finalization. Returns a ReadableStream that the route handler wraps in a
// Response.
//
// Framework-agnostic: no imports from next/server or HTTP concepts.
// ---------------------------------------------------------------------------

import { streamText, stepCountIs, tool, zodSchema } from "ai";
import { z } from "zod";

import {
  sseEvent,
  parseFollowUps,
  deduplicateSources,
  toSource,
} from "@/lib/utils/chat-helpers";
import { retrieveRelevantChunks } from "@/lib/services/retrieval-service";
import { executeQuery } from "@/lib/services/database-query";
import { CHAT_SYSTEM_PROMPT, CHAT_MAX_TOKENS } from "@/lib/prompts/chat-prompt";

import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatService, ContextMessage } from "@/lib/services/chat-service";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";
import type { ChatSource } from "@/lib/types/chat";
import type { ChunkType } from "@/lib/types/embedding-chunk";
import {
  CHAT_TOOL_ACTIONS,
  buildChatToolDescription,
  type QueryAction,
} from "@/lib/services/database-query";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[chat-stream-service]";

// ---------------------------------------------------------------------------
// Dependencies interface
// ---------------------------------------------------------------------------

/**
 * All dependencies the stream service needs, injected by the route handler.
 * This keeps the service testable and decoupled from framework specifics.
 */
export interface ChatStreamDeps {
  model: LanguageModel;
  modelLabel: string;
  chatService: ChatService;
  embeddingRepo: EmbeddingRepository;
  /** RLS-protected client (carries user cookies) — used for data queries. */
  anonClient: SupabaseClient;
  userId: string;
  teamId: string | null;
  conversationId: string;
  assistantMessageId: string;
  isNewConversation: boolean;
  contextMessages: ContextMessage[];
  /**
   * Request abort signal — propagated to `streamText()` so a client-side
   * cancel cancels the upstream provider call AND throws inside the
   * for-await loop. The outer catch differentiates abort from error and
   * updates the placeholder accordingly. (Gap E14)
   */
  abortSignal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a ReadableStream that emits typed SSE events for the chat
 * streaming pipeline. The stream:
 *
 * 1. Calls streamText with searchInsights and queryDatabase tools
 * 2. Emits `status` events during tool execution
 * 3. Emits `delta` events for text chunks
 * 4. On completion: parses follow-ups, deduplicates sources, finalizes
 *    the assistant message, and emits `sources`, `follow_ups`, `done`
 * 5. On error: marks the message as failed and emits an `error` event
 */
export function createChatStream(deps: ChatStreamDeps): ReadableStream {
  const {
    model,
    modelLabel,
    chatService,
    embeddingRepo,
    anonClient,
    userId,
    teamId,
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
      // the stream is aborted or errors mid-flight (gap E14).
      let fullText = "";
      const toolsCalled: string[] = [];

      try {
        const result = streamText({
          model,
          system: `${CHAT_SYSTEM_PROMPT}\n\nToday's date is ${new Date().toISOString().split('T')[0]}. Use this to resolve relative time references (e.g. "past month", "last week").`,
          messages: contextMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          tools: {
            searchInsights: buildSearchInsightsTool(
              controller,
              encoder,
              embeddingRepo,
              teamId,
              collectedSources
            ),
            queryDatabase: buildQueryDatabaseTool(
              controller,
              encoder,
              anonClient,
              teamId
            ),
          },
          stopWhen: stepCountIs(5),
          maxOutputTokens: CHAT_MAX_TOKENS,
          abortSignal,
        });

        // Send "generating" status
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

        // Stream complete — detect step-budget exhaustion (gap E8). When
        // stopWhen fires mid-tool-calling, finishReason resolves to
        // "tool-calls" — the model wanted another step but hit the cap.
        // Append a single-line warning to the streamed content (visible to
        // the user) and to the persisted message.
        const finishReason = await result.finishReason;
        const stepCount = (await result.steps).length;
        const wasTruncated = finishReason === "tool-calls";

        if (wasTruncated) {
          const warning =
            "\n\n_Note: this answer may be incomplete — I reached my reasoning step limit before finishing. Try a follow-up to dig deeper._";
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
          },
        });

        console.log(
          `${LOG_PREFIX} stream complete — steps: ${stepCount}, finishReason: ${finishReason}, content: ${cleanContent.length} chars, sources: ${uniqueSources.length}, followUps: ${followUps.length}${wasTruncated ? " (truncated)" : ""}`
        );

        // Send final events
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
        // Differentiate client-abort from genuine errors so the placeholder
        // row reflects reality and any partial content the user already saw
        // is preserved (gap E14).
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

        // Update the placeholder row with the terminal status and whatever
        // partial content accumulated. Keeps client (which sees the partial
        // text up to the abort/error) and server in agreement.
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

        // On abort the client already knows it cancelled — no error event
        // needed (and the controller is likely already torn down). On error,
        // emit so the client renders error UI.
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
// Tool builders
// ---------------------------------------------------------------------------

/**
 * Builds the searchInsights tool definition for streamText.
 */
function buildSearchInsightsTool(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  embeddingRepo: EmbeddingRepository,
  teamId: string | null,
  collectedSources: ChatSource[]
) {
  return tool({
    description:
      "Search client feedback sessions for qualitative insights. Use when the question is about what clients said, felt, or experienced.",
    inputSchema: zodSchema(
      z.object({
        query: z
          .string()
          .describe("Semantic search query optimised for embedding similarity"),
        filters: z
          .object({
            clientName: z
              .string()
              .optional()
              .describe("Filter by specific client name"),
            dateFrom: z
              .string()
              .optional()
              .describe("Start date (ISO format)"),
            dateTo: z
              .string()
              .optional()
              .describe("End date (ISO format)"),
            chunkTypes: z
              .array(z.string())
              .optional()
              .describe(
                "Filter by chunk types (e.g., pain_point, requirement)"
              ),
          })
          .optional(),
      })
    ),
    execute: async ({ query, filters }) => {
      console.log(`${LOG_PREFIX} tool:searchInsights — query: "${query}"`);
      controller.enqueue(
        encoder.encode(
          sseEvent("status", { text: "Searching across sessions..." })
        )
      );
      const results = await retrieveRelevantChunks(
        query,
        {
          teamId,
          // Convert empty strings to undefined
          clientName: filters?.clientName?.trim() || undefined,
          dateFrom: filters?.dateFrom?.trim() || undefined,
          dateTo: filters?.dateTo?.trim() || undefined,
          // Convert empty arrays to undefined
          chunkTypes: filters?.chunkTypes && filters.chunkTypes.length > 0
            ? (filters.chunkTypes as ChunkType[])
            : undefined,
        },
        embeddingRepo
      );

      // Collect sources for persistence
      collectedSources.push(...results.map(toSource));

      // Deduplicate client names for the status message
      const uniqueClients = new Set(results.map((r) => r.clientName));

      controller.enqueue(
        encoder.encode(
          sseEvent("status", {
            text: `Found ${results.length} relevant insights from ${uniqueClients.size} client${uniqueClients.size !== 1 ? "s" : ""}`,
          })
        )
      );

      console.log(
        `${LOG_PREFIX} tool:searchInsights — returned ${results.length} results from ${uniqueClients.size} clients`
      );

      return results.map((r) => ({
        clientName: r.clientName,
        sessionDate: r.sessionDate,
        chunkType: r.chunkType,
        chunkText: r.chunkText,
        similarityScore: r.similarityScore,
      }));
    },
  });
}

/**
 * Builds the queryDatabase tool definition for streamText.
 */
function buildQueryDatabaseTool(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  supabaseClient: SupabaseClient,
  teamId: string | null
) {
  return tool({
    description: buildChatToolDescription(),
    inputSchema: zodSchema(
      z.object({
        action: z
          .enum(CHAT_TOOL_ACTIONS)
          .describe("The predefined query action to execute"),
        filters: z
          .object({
            dateFrom: z
              .string()
              .optional()
              .describe("Start date filter (ISO format YYYY-MM-DD)"),
            dateTo: z
              .string()
              .optional()
              .describe("End date filter (ISO format YYYY-MM-DD)"),
            clientName: z
              .string()
              .optional()
              .describe(
                "Single-client convenience: matches by client name when no UUID is known"
              ),
            clientIds: z
              .array(z.string().uuid())
              .optional()
              .describe("Filter by one or more client UUIDs"),
            severity: z
              .enum(["low", "medium", "high"])
              .optional()
              .describe("Filter signals by severity tier"),
            urgency: z
              .enum(["low", "medium", "high", "critical"])
              .optional()
              .describe("Filter signals by urgency tier"),
            granularity: z
              .enum(["week", "month"])
              .optional()
              .describe(
                "Time bucketing granularity. Used by sessions_over_time and theme_trends"
              ),
            confidenceMin: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe(
                "Minimum theme-assignment confidence score 0–1. Used by theme actions (top_themes, theme_trends, theme_client_matrix)"
              ),
          })
          .optional(),
      })
    ),
    execute: async ({ action, filters }) => {
      console.log(
        `${LOG_PREFIX} tool:queryDatabase — action: ${action}, filters: ${JSON.stringify(filters ?? {})}`
      );
      controller.enqueue(
        encoder.encode(
          sseEvent("status", { text: "Looking up your data..." })
        )
      );
      const result = await executeQuery(
        supabaseClient,
        action as QueryAction,
        {
          teamId,
          dateFrom: filters?.dateFrom?.trim() || undefined,
          dateTo: filters?.dateTo?.trim() || undefined,
          clientName: filters?.clientName?.trim() || undefined,
          clientIds:
            filters?.clientIds && filters.clientIds.length > 0
              ? filters.clientIds
              : undefined,
          severity: filters?.severity,
          urgency: filters?.urgency,
          granularity: filters?.granularity,
          confidenceMin: filters?.confidenceMin,
        }
      );
      console.log(
        `${LOG_PREFIX} tool:queryDatabase — action: ${action} completed`
      );

      return result.data;
    },
  });
}
