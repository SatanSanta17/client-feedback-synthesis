import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { streamText, stepCountIs, tool, zodSchema } from "ai";

import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import { resolveModel, generateConversationTitle } from "@/lib/services/ai-service";
import { createChatService } from "@/lib/services/chat-service";
import { executeQuery, type QueryAction } from "@/lib/services/database-query-service";
import { retrieveRelevantChunks } from "@/lib/services/retrieval-service";
import { createConversationRepository } from "@/lib/repositories/supabase/supabase-conversation-repository";
import { createMessageRepository } from "@/lib/repositories/supabase/supabase-message-repository";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";
import { CHAT_SYSTEM_PROMPT, CHAT_MAX_TOKENS } from "@/lib/prompts/chat-prompt";
import type { ChatSource } from "@/lib/types/chat";
import type { ChunkType } from "@/lib/types/embedding-chunk";
import type { RetrievalResult } from "@/lib/types/retrieval-result";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[api/chat/send]";
const MAX_TITLE_LENGTH = 80;

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
// Input validation
// ---------------------------------------------------------------------------

const chatSendSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  message: z.string().min(1, "Message is required").max(10000, "Message too long"),
  teamId: z.string().uuid().nullable(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a typed SSE event as a string.
 */
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse the follow-up questions from the LLM response.
 * Expected format: <!--follow-ups:["q1","q2","q3"]-->
 * Returns the cleaned content (without the block) and the follow-ups array.
 */
function parseFollowUps(text: string): { cleanContent: string; followUps: string[] } {
  const pattern = /<!--follow-ups:(\[[\s\S]*?\])-->/;
  const match = text.match(pattern);

  if (!match) {
    return { cleanContent: text, followUps: [] };
  }

  try {
    const followUps = JSON.parse(match[1]) as string[];
    if (!Array.isArray(followUps) || !followUps.every((q) => typeof q === "string")) {
      return { cleanContent: text, followUps: [] };
    }
    const cleanContent = text.replace(pattern, "").trimEnd();
    return { cleanContent, followUps };
  } catch {
    return { cleanContent: text, followUps: [] };
  }
}

/**
 * Map retrieval results to ChatSource objects for persistence.
 */
function toSource(result: RetrievalResult): ChatSource {
  return {
    sessionId: result.sessionId,
    clientName: result.clientName,
    sessionDate: result.sessionDate,
    chunkText: result.chunkText,
    chunkType: result.chunkType,
  };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  console.log(`${LOG_PREFIX} POST — chat send request`);

  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn(`${LOG_PREFIX} POST — unauthenticated request`);
    return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = chatSendSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  const { conversationId: inputConversationId, message, teamId: inputTeamId } = parsed.data;

  // Use provided teamId or fall back to active team cookie
  const teamId = inputTeamId ?? (await getActiveTeamId());

  console.log(
    `${LOG_PREFIX} POST — userId: ${user.id}, conversationId: ${inputConversationId ?? "new"}, teamId: ${teamId ?? "personal"}`
  );

  // 3. Build repositories and service
  const serviceClient = createServiceRoleClient();
  const conversationRepo = createConversationRepository(supabase);
  const messageRepo = createMessageRepository(supabase);
  const embeddingRepo = createEmbeddingRepository(serviceClient, teamId);
  const chatService = createChatService(conversationRepo, messageRepo);

  try {
    // 4. Resolve or create conversation
    let conversationId: string;
    let isNewConversation = false;

    if (inputConversationId) {
      const existing = await chatService.getConversation(inputConversationId);
      if (!existing) {
        return NextResponse.json({ message: "Conversation not found" }, { status: 404 });
      }
      conversationId = existing.id;
    } else {
      const placeholderTitle = message.slice(0, MAX_TITLE_LENGTH);
      const conversation = await chatService.createConversation(
        placeholderTitle,
        user.id,
        teamId
      );
      conversationId = conversation.id;
      isNewConversation = true;
      console.log(`${LOG_PREFIX} POST — created conversation: ${conversationId}`);
    }

    // 5. Insert user message
    const userMessage = await chatService.createMessage({
      conversation_id: conversationId,
      role: "user",
      content: message,
      status: "completed",
    });
    console.log(`${LOG_PREFIX} POST — user message created: ${userMessage.id}`);

    // 6. Insert placeholder assistant message
    const assistantMessage = await chatService.createMessage({
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      status: "streaming",
    });
    console.log(`${LOG_PREFIX} POST — assistant placeholder created: ${assistantMessage.id}`);

    // 7. Fire-and-forget title generation for new conversations
    if (isNewConversation) {
      generateConversationTitle(message).then(async (title) => {
        if (title) {
          try {
            await chatService.updateConversationTitle(conversationId, title);
            console.log(`${LOG_PREFIX} POST — title updated for ${conversationId}: "${title}"`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            console.error(`${LOG_PREFIX} POST — title update failed: ${errMsg}`);
          }
        }
      });
    }

    // 8. Build context messages from conversation history
    const contextMessages = await chatService.buildContextMessages(conversationId);
    console.log(`${LOG_PREFIX} POST — context: ${contextMessages.length} messages`);

    // 9. Resolve model
    const { model, label: modelLabel } = resolveModel();
    console.log(`${LOG_PREFIX} POST — using model: ${modelLabel}`);

    // 10. Collected sources from searchInsights calls
    const collectedSources: ChatSource[] = [];

    // 11. Create SSE stream
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Call streamText with tools
          const result = streamText({
            model,
            system: CHAT_SYSTEM_PROMPT,
            messages: contextMessages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            tools: {
              searchInsights: tool({
                description:
                  "Search client feedback sessions for qualitative insights. Use when the question is about what clients said, felt, or experienced.",
                inputSchema: zodSchema(
                  z.object({
                    query: z.string().describe("Semantic search query optimised for embedding similarity"),
                    filters: z
                      .object({
                        clientName: z.string().optional().describe("Filter by specific client name"),
                        dateFrom: z.string().optional().describe("Start date (ISO format)"),
                        dateTo: z.string().optional().describe("End date (ISO format)"),
                        chunkTypes: z
                          .array(z.string())
                          .optional()
                          .describe("Filter by chunk types (e.g., pain_point, requirement)"),
                      })
                      .optional(),
                  })
                ),
                execute: async ({ query, filters }) => {
                  console.log(`${LOG_PREFIX} tool:searchInsights — query: "${query}"`);
                  controller.enqueue(
                    encoder.encode(sseEvent("status", { text: "Searching across sessions..." }))
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

                  // Return results to the LLM (it sees these as tool results)
                  return results.map((r) => ({
                    clientName: r.clientName,
                    sessionDate: r.sessionDate,
                    chunkType: r.chunkType,
                    chunkText: r.chunkText,
                    similarityScore: r.similarityScore,
                  }));
                },
              }),
              queryDatabase: tool({
                description:
                  "Query the database for quantitative data about clients and sessions. Use when the question involves counts, lists, distributions, or factual lookups.",
                inputSchema: zodSchema(
                  z.object({
                    action: z
                      .enum(QUERY_ACTIONS)
                      .describe("The predefined query action to execute"),
                    filters: z
                      .object({
                        dateFrom: z.string().optional().describe("Start date filter (ISO format)"),
                        dateTo: z.string().optional().describe("End date filter (ISO format)"),
                        clientName: z.string().optional().describe("Filter by client name"),
                      })
                      .optional(),
                  })
                ),
                execute: async ({ action, filters }) => {
                  console.log(`${LOG_PREFIX} tool:queryDatabase — action: ${action}`);
                  controller.enqueue(
                    encoder.encode(sseEvent("status", { text: "Looking up your data..." }))
                  );

                  const result = await executeQuery(serviceClient, action as QueryAction, {
                    teamId,
                    dateFrom: filters?.dateFrom,
                    dateTo: filters?.dateTo,
                    clientName: filters?.clientName,
                  });

                  console.log(
                    `${LOG_PREFIX} tool:queryDatabase — action: ${action} completed`
                  );

                  return result.data;
                },
              }),
            },
            stopWhen: stepCountIs(3),
            maxOutputTokens: CHAT_MAX_TOKENS,
          });

          // Send "generating" status
          controller.enqueue(
            encoder.encode(sseEvent("status", { text: "Generating answer..." }))
          );

          // Consume the full stream for text deltas and tool events
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
                // Update assistant message to failed
                await chatService.updateMessage(assistantMessage.id, {
                  status: "failed",
                  content: fullText || "",
                });
                controller.enqueue(
                  encoder.encode(sseEvent("error", { message: "An error occurred while generating the response." }))
                );
                controller.close();
                return;
            }
          }

          // Stream complete — parse follow-ups and finalize
          const { cleanContent, followUps } = parseFollowUps(fullText);

          // Deduplicate sources by sessionId + chunkText
          const uniqueSources = deduplicateSources(collectedSources);

          // Update assistant message with final content
          await chatService.updateMessage(assistantMessage.id, {
            content: cleanContent,
            sources: uniqueSources.length > 0 ? uniqueSources : null,
            status: "completed",
            metadata: {
              model: modelLabel,
              toolsCalled,
            },
          });

          console.log(
            `${LOG_PREFIX} POST — stream complete, content: ${cleanContent.length} chars, sources: ${uniqueSources.length}, followUps: ${followUps.length}`
          );

          // Send final events
          if (uniqueSources.length > 0) {
            controller.enqueue(
              encoder.encode(sseEvent("sources", { sources: uniqueSources }))
            );
          }

          if (followUps.length > 0) {
            controller.enqueue(
              encoder.encode(sseEvent("follow_ups", { questions: followUps }))
            );
          }

          controller.enqueue(
            encoder.encode(
              sseEvent("done", {
                conversationId,
                assistantMessageId: assistantMessage.id,
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
            await chatService.updateMessage(assistantMessage.id, {
              status: "failed",
            });
          } catch (updateErr) {
            const updateMsg = updateErr instanceof Error ? updateErr.message : "Unknown";
            console.error(`${LOG_PREFIX} failed to update message status: ${updateMsg}`);
          }

          try {
            controller.enqueue(
              encoder.encode(sseEvent("error", { message: "An error occurred while generating the response." }))
            );
            controller.close();
          } catch {
            // Controller may already be closed
          }
        }
      },
    });

    // Return SSE response
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Conversation-Id": conversationId,
      },
    });
  } catch (err) {
    // Pre-stream errors (conversation not found, message insert failed, etc.)
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`${LOG_PREFIX} POST — pre-stream error: ${errMsg}`);
    return NextResponse.json(
      { message: "Failed to process chat request" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Source deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicates sources by sessionId + chunkText combination.
 * Keeps the first occurrence of each unique pair.
 */
function deduplicateSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Set<string>();
  const unique: ChatSource[] = [];

  for (const source of sources) {
    const key = `${source.sessionId}:${source.chunkText}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(source);
    }
  }

  return unique;
}
