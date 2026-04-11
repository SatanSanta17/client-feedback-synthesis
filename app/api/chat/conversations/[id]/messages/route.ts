import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createChatService } from "@/lib/services/chat-service";
import { createConversationRepository } from "@/lib/repositories/supabase/supabase-conversation-repository";
import { createMessageRepository } from "@/lib/repositories/supabase/supabase-message-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[api/chat/conversations/[id]/messages]";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// GET — List messages for a conversation (paginated)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;
  console.log(`${LOG_PREFIX} GET — conversationId: ${conversationId}`);

  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn(`${LOG_PREFIX} GET — unauthenticated request`);
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  // 2. Parse query params
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") || undefined;
  const limitParam = parseInt(searchParams.get("limit") || "", 10);
  const limit = Number.isNaN(limitParam)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(limitParam, 1), MAX_LIMIT);

  console.log(
    `${LOG_PREFIX} GET — userId: ${user.id}, limit: ${limit}, cursor: ${cursor ?? "none"}`
  );

  // 3. Verify conversation exists
  const conversationRepo = createConversationRepository(supabase);
  const messageRepo = createMessageRepository(supabase);
  const chatService = createChatService(conversationRepo, messageRepo);

  try {
    const conversation = await chatService.getConversation(conversationId);
    if (!conversation) {
      return NextResponse.json(
        { message: "Conversation not found" },
        { status: 404 }
      );
    }

    // 4. Fetch messages (newest first from repo)
    const messages = await chatService.getMessages(
      conversationId,
      limit + 1, // Fetch one extra to determine hasMore
      cursor
    );

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;

    // 5. Reverse to chronological order (oldest first) for the client
    page.reverse();

    console.log(
      `${LOG_PREFIX} GET — returning ${page.length} messages, hasMore: ${hasMore}`
    );

    return NextResponse.json({ messages: page, hasMore });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`${LOG_PREFIX} GET — error: ${errMsg}`);
    return NextResponse.json(
      { message: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
