import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createChatService } from "@/lib/services/chat-service";
import { createConversationRepository } from "@/lib/repositories/supabase/supabase-conversation-repository";
import { createMessageRepository } from "@/lib/repositories/supabase/supabase-message-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[api/chat/conversations/[id]]";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  is_pinned: z.boolean().optional(),
  is_archived: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// PATCH — Update conversation (title, pin, archive)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  console.log(`${LOG_PREFIX} PATCH — id: ${id}`);

  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn(`${LOG_PREFIX} PATCH — unauthenticated request`);
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  const updates = parsed.data;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { message: "No fields to update" },
      { status: 400 }
    );
  }

  console.log(
    `${LOG_PREFIX} PATCH — userId: ${user.id}, fields: ${Object.keys(updates).join(", ")}`
  );

  // 3. Update via chat service
  const conversationRepo = createConversationRepository(supabase);
  const messageRepo = createMessageRepository(supabase);
  const chatService = createChatService(conversationRepo, messageRepo);

  try {
    // Verify conversation exists and belongs to user
    const existing = await chatService.getConversation(id);
    if (!existing) {
      return NextResponse.json(
        { message: "Conversation not found" },
        { status: 404 }
      );
    }

    const conversation = await chatService.updateConversation(id, updates);

    console.log(`${LOG_PREFIX} PATCH — updated conversation: ${id}`);
    return NextResponse.json({ conversation });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`${LOG_PREFIX} PATCH — error: ${errMsg}`);
    return NextResponse.json(
      { message: "Failed to update conversation" },
      { status: 500 }
    );
  }
}
