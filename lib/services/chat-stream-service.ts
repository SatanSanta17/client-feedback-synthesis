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
import { executeQuery } from "@/lib/services/database-query-service";
import { CHAT_SYSTEM_PROMPT, CHAT_MAX_TOKENS } from "@/lib/prompts/chat-prompt";

import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatService, ContextMessage } from "@/lib/services/chat-service";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";
import type { ChatSource } from "@/lib/types/chat";
import type { ChunkType } from "@/lib/types/embedding-chunk";
import type { QueryAction } from "@/lib/services/database-query-service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[chat-stream-service]";

const QUERY_ACTIONS = [
  "count_clients",
  "count_sessions",
  "sessions_per_client",
  "sentiment_distribution",
  "urgency_distribution",
  "recent_sessions",
  "client_list",
] as const;

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
  } = deps;

  const encoder = new TextEncoder();
  const collectedSources: ChatSource[] = [];

  return new ReadableStream({
    async start(controller) {
      try {
        const result = streamText({
          model,
          system: CHAT_SYSTEM_PROMPT,
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
          stopWhen: stepCountIs(3),
          maxOutputTokens: CHAT_MAX_TOKENS,
        });

        // Send "generating" status
        controller.enqueue(
          encoder.encode(sseEvent("status", { text: "Generating answer..." }))
        );

        // Consume the full stream
        let fullText = "";
        const toolsCalled: string[] = [];

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

        // Stream complete — finalize
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
          `${LOG_PREFIX} stream complete — content: ${cleanContent.length} chars, sources: ${uniqueSources.length}, followUps: ${followUps.length}`
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
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`${LOG_PREFIX} stream fatal error: ${errMsg}`);

        // Attempt to mark message as failed
        try {
          await chatService.updateMessage(assistantMessageId, {
            status: "failed",
          });
        } catch (updateErr) {
          const updateMsg =
            updateErr instanceof Error ? updateErr.message : "Unknown";
          console.error(
            `${LOG_PREFIX} failed to update message status: ${updateMsg}`
          );
        }

        try {
          controller.enqueue(
            encoder.encode(
              sseEvent("error", {
                message:
                  "An error occurred while generating the response.",
              })
            )
          );
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
          clientName: filters?.clientName,
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          chunkTypes: filters?.chunkTypes as ChunkType[] | undefined,
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
    description:
      "Query the database for quantitative data about clients and sessions. Use when the question involves counts, lists, distributions, or factual lookups.",
    inputSchema: zodSchema(
      z.object({
        action: z
          .enum(QUERY_ACTIONS)
          .describe("The predefined query action to execute"),
        filters: z
          .object({
            dateFrom: z
              .string()
              .optional()
              .describe("Start date filter (ISO format)"),
            dateTo: z
              .string()
              .optional()
              .describe("End date filter (ISO format)"),
            clientName: z
              .string()
              .optional()
              .describe("Filter by client name"),
          })
          .optional(),
      })
    ),
    execute: async ({ action, filters }) => {
      console.log(`${LOG_PREFIX} tool:queryDatabase — action: ${action}`);
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
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          clientName: filters?.clientName,
        }
      );

      console.log(
        `${LOG_PREFIX} tool:queryDatabase — action: ${action} completed`
      );

      return result.data;
    },
  });
}
