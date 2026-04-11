import { NextRequest, NextResponse } from "next/server";

import { createClient, getActiveTeamId } from "@/lib/supabase/server";
import { createChatService } from "@/lib/services/chat-service";
import { createConversationRepository } from "@/lib/repositories/supabase/supabase-conversation-repository";
import { createMessageRepository } from "@/lib/repositories/supabase/supabase-message-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[api/chat/conversations]";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// GET — List conversations (paginated, filterable)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  console.log(`${LOG_PREFIX} GET — list conversations`);

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
  const archived = searchParams.get("archived") === "true";
  const search = searchParams.get("search") || undefined;
  const cursor = searchParams.get("cursor") || undefined;
  const cursorId = searchParams.get("cursorId") || undefined;
  const limitParam = parseInt(searchParams.get("limit") || "", 10);
  const limit = Number.isNaN(limitParam)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(limitParam, 1), MAX_LIMIT);

  const teamId = await getActiveTeamId();

  console.log(
    `${LOG_PREFIX} GET — userId: ${user.id}, archived: ${archived}, limit: ${limit}, cursor: ${cursor ?? "none"}`
  );

  // 3. Fetch via chat service
  const conversationRepo = createConversationRepository(supabase);
  const messageRepo = createMessageRepository(supabase);
  const chatService = createChatService(conversationRepo, messageRepo);

  try {
    const conversations = await chatService.getConversations(user.id, teamId, {
      archived,
      search,
      limit: limit + 1, // Fetch one extra to determine hasMore
      cursor,
      cursorId,
    });

    const hasMore = conversations.length > limit;
    const page = hasMore ? conversations.slice(0, limit) : conversations;

    console.log(
      `${LOG_PREFIX} GET — returning ${page.length} conversations, hasMore: ${hasMore}`
    );

    return NextResponse.json({ conversations: page, hasMore });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`${LOG_PREFIX} GET — error: ${errMsg}`);
    return NextResponse.json(
      { message: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}
