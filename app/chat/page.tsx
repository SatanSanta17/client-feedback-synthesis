import type { Metadata } from "next";
import { ChatPageContent } from "./_components/chat-page-content";

export const metadata: Metadata = {
  title: "Chat | Synthesiser",
  description: "Ask questions about your client feedback data",
};

export default function ChatPage() {
  return <ChatPageContent />;
}
