import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import { resolveModel, generateConversationTitle } from "@/lib/services/ai-service";
import {
  createChatService,
  ConversationNotAccessibleError,
  MessageDuplicateError,
} from "@/lib/services/chat-service";
import { createChatStream } from "@/lib/services/chat-stream-service";
import { createConversationRepository } from "@/lib/repositories/supabase/supabase-conversation-repository";
import { createMessageRepository } from "@/lib/repositories/supabase/supabase-message-repository";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[api/chat/send]";
const MAX_TITLE_LENGTH = 80;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const chatSendSchema = z.object({
  // Client-owned UUID for the conversation — generated at "New chat" / on
  // mount, sent here so the conversation has a stable identifier from the
  // first render. Server idempotently creates the row on first POST or
  // reuses the existing row on subsequent ones (gap E15).
  conversationId: z.string().uuid(),
  // Client-owned UUID for the user message — generated via crypto.randomUUID()
  // before the optimistic render, sent here to keep client and server IDs in
  // sync end-to-end. Duplicate retries map to 409 (gap E14).
  userMessageId: z.string().uuid(),
  message: z.string().min(1, "Message is required").max(10000, "Message too long"),
});

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

  const {
    conversationId: inputConversationId,
    userMessageId,
    message,
  } = parsed.data;

  // Always read teamId from the server-side cookie — never trust the client.
  // This matches how all other API routes resolve workspace context and ensures
  // data isolation: the cookie is HttpOnly and managed by the auth layer.
  const teamId = await getActiveTeamId();

  console.log(
    `${LOG_PREFIX} POST — userId: ${user.id}, conversationId: ${inputConversationId}, userMessageId: ${userMessageId}, teamId: ${teamId ?? "personal"}`
  );

  // 3. Build repositories and service
  const serviceClient = createServiceRoleClient();
  const conversationRepo = createConversationRepository(supabase);
  const messageRepo = createMessageRepository(supabase);
  const embeddingRepo = createEmbeddingRepository(serviceClient, teamId, user.id);
  const chatService = createChatService(conversationRepo, messageRepo);

  try {
    // 4. Resolve or create the conversation idempotently using the
    //    client-supplied UUID (gap E15). First POST creates the row;
    //    subsequent POSTs reuse it. Cross-user UUID collisions surface as
    //    ConversationNotAccessibleError (mapped to 404 below).
    const placeholderTitle = message.slice(0, MAX_TITLE_LENGTH);
    const { conversation, isNew: isNewConversation } =
      await chatService.getOrCreateConversation(
        inputConversationId,
        placeholderTitle,
        user.id,
        teamId
      );
    const conversationId = conversation.id;
    if (isNewConversation) {
      console.log(`${LOG_PREFIX} POST — created conversation: ${conversationId}`);
    }

    // 5. Insert user message — uses client-supplied UUID so optimistic UI
    // and DB row share the same identifier end-to-end (gap E14).
    const userMessage = await chatService.createMessage({
      id: userMessageId,
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

    // 10. Delegate to chat stream service
    const stream = createChatStream({
      model,
      modelLabel,
      chatService,
      embeddingRepo,
      anonClient: supabase,
      userId: user.id,
      teamId,
      conversationId,
      assistantMessageId: assistantMessage.id,
      isNewConversation,
      contextMessages,
      // Propagate request abort so a client-side cancel cancels the upstream
      // provider call and lets the server flip the placeholder row to
      // `cancelled` instead of leaving it stuck at `streaming` (gap E14).
      abortSignal: request.signal,
    });

    // 11. Return SSE response
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Conversation-Id": conversationId,
        // Surface the assistant placeholder's UUID so the client has it at
        // fetch-response time (not just at stream completion via `done`).
        // Used by the cancel path to attach a real ID to the cancelled
        // bubble instead of a temp ID. (Gap E14)
        "X-Assistant-Message-Id": assistantMessage.id,
      },
    });
  } catch (err) {
    // Cross-user UUID collision: the client supplied a conversationId that
    // exists for a different user. RLS hides it; we can't tell the user
    // whether the row exists or not without leaking. Return 404. (Gap E15)
    if (err instanceof ConversationNotAccessibleError) {
      console.warn(
        `${LOG_PREFIX} POST — conversation not accessible — returning 404`
      );
      return NextResponse.json(
        { message: "Conversation not found" },
        { status: 404 }
      );
    }

    // Idempotent retry: client re-posted with the same userMessageId after a
    // network hiccup. The DB primary key constraint blocked the duplicate
    // insert; signal "already accepted" so the client can ignore (gap E14).
    if (err instanceof MessageDuplicateError) {
      console.warn(
        `${LOG_PREFIX} POST — duplicate userMessageId — returning 409`
      );
      return NextResponse.json(
        { message: "Message already received" },
        { status: 409 }
      );
    }

    // Pre-stream errors (conversation not found, message insert failed, etc.)
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`${LOG_PREFIX} POST — pre-stream error: ${errMsg}`);
    return NextResponse.json(
      { message: "Failed to process chat request" },
      { status: 500 }
    );
  }
}
