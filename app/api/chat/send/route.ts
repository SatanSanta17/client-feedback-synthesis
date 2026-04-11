import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import { resolveModel, generateConversationTitle } from "@/lib/services/ai-service";
import { createChatService } from "@/lib/services/chat-service";
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
  conversationId: z.string().uuid().nullable(),
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

  const { conversationId: inputConversationId, message } = parsed.data;

  // Always read teamId from the server-side cookie — never trust the client.
  // This matches how all other API routes resolve workspace context and ensures
  // data isolation: the cookie is HttpOnly and managed by the auth layer.
  const teamId = await getActiveTeamId();

  console.log(
    `${LOG_PREFIX} POST — userId: ${user.id}, conversationId: ${inputConversationId ?? "new"}, teamId: ${teamId ?? "personal"}`
  );

  // 3. Build repositories and service
  const serviceClient = createServiceRoleClient();
  const conversationRepo = createConversationRepository(supabase);
  const messageRepo = createMessageRepository(supabase);
  const embeddingRepo = createEmbeddingRepository(serviceClient, teamId, user.id);
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
    });

    // 11. Return SSE response
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
