import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatPageContent } from "../_components/chat-page-content";

export const metadata: Metadata = {
  title: "Chat | Synthesiser",
  description: "Ask questions about your client feedback data",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Reject malformed URLs at the route boundary so downstream code can
  // assume a valid UUID. Cross-user / non-existent UUIDs surface via the
  // messages-fetch 404 inside the chat shell with a dedicated UI panel
  // (gap P9 Increment 3).
  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  return <ChatPageContent initialConversationId={id} />;
}
