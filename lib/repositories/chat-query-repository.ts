// ---------------------------------------------------------------------------
// Chat Query Repository — read-only data access for the agentic chat tool
// surface (PRD-033 Part 1).
//
// Design note: deliberately separate from SessionRepository / ClientRepository
// / ThemeRepository because the chat tools need a different shape than those
// repos expose (lightweight rows, theme-name resolution, signal-level filter
// semantics via at-least-one-chunk EXISTS). Putting chat-specific methods on
// the existing repos would violate ISP — none of the dashboard / list-page
// consumers want them.
// ---------------------------------------------------------------------------

import type { ChunkType } from "@/lib/types/embedding-chunk";

export interface ChatClientRow {
  name: string;
  sessionCount: number;
  lastSessionDate: string | null;
}

export interface ChatSessionRow {
  id: string;
  clientName: string;
  sessionDate: string;
  sentiment: string | null;
  urgency: string | null;
  themeNames: string[];
}

export interface ChatSessionHeader {
  sessionId: string;
  clientName: string;
  sessionDate: string;
  sentiment: string | null;
  urgency: string | null;
  themes: string[];
  rawNotes: string | null;
}

export interface ChatThemeRow {
  name: string;
  mentionCount: number;
}

export interface ChatSessionListFilters {
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  sentiment?: string;
  // Signal-level filters (at-least-one-chunk semantics — PRD § P1.R1)
  themeName?: string;
  chunkTypes?: ChunkType[];
  severity?: "low" | "medium" | "high";
  urgency?: "low" | "medium" | "high" | "critical";
  limit?: number;
}

export interface ChatClientListFilters {
  nameSearch?: string;
  hasSessions?: boolean;
  limit?: number;
}

export interface ChatThemeListFilters {
  nameSearch?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface ChatQueryRepository {
  listClients(filters: ChatClientListFilters): Promise<ChatClientRow[]>;
  listSessions(filters: ChatSessionListFilters): Promise<ChatSessionRow[]>;
  listThemes(filters: ChatThemeListFilters): Promise<ChatThemeRow[]>;
  fetchSessionHeaders(sessionIds: string[]): Promise<ChatSessionHeader[]>;
}
