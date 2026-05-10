// ---------------------------------------------------------------------------
// Discovery Service — backs list_clients / list_sessions / list_themes tools.
// PRD-033 P1.R1 / TRD § 1.3.
// Framework-agnostic: no next/server imports.
// ---------------------------------------------------------------------------

import type {
  ChatClientListFilters,
  ChatClientRow,
  ChatQueryRepository,
  ChatSessionListFilters,
  ChatSessionRow,
  ChatThemeListFilters,
  ChatThemeRow,
} from "@/lib/repositories/chat-query-repository";

const LOG_PREFIX = "[discovery-service]";

export async function listClients(
  filters: ChatClientListFilters,
  deps: { chatQueryRepo: ChatQueryRepository }
): Promise<ChatClientRow[]> {
  console.log(`${LOG_PREFIX} listClients — filters: ${JSON.stringify(filters)}`);
  const result = await deps.chatQueryRepo.listClients(filters);
  console.log(`${LOG_PREFIX} listClients — returning ${result.length} clients`);
  return result;
}

export async function listSessions(
  filters: ChatSessionListFilters,
  deps: { chatQueryRepo: ChatQueryRepository }
): Promise<ChatSessionRow[]> {
  console.log(`${LOG_PREFIX} listSessions — filters: ${JSON.stringify(filters)}`);
  const result = await deps.chatQueryRepo.listSessions(filters);
  console.log(`${LOG_PREFIX} listSessions — returning ${result.length} sessions`);
  return result;
}

export async function listThemes(
  filters: ChatThemeListFilters,
  deps: { chatQueryRepo: ChatQueryRepository }
): Promise<ChatThemeRow[]> {
  console.log(`${LOG_PREFIX} listThemes — filters: ${JSON.stringify(filters)}`);
  const result = await deps.chatQueryRepo.listThemes(filters);
  console.log(`${LOG_PREFIX} listThemes — returning ${result.length} themes`);
  return result;
}
