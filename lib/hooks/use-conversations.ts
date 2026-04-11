"use client";

// ---------------------------------------------------------------------------
// useConversations — Conversation list management hook (PRD-020 Part 3)
// ---------------------------------------------------------------------------
// Manages dual active/archived conversation lists with cursor-based pagination,
// client-side search, and optimistic CRUD operations.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

import type { Conversation } from "@/lib/types/chat";
import type { ConversationUpdate } from "@/lib/repositories/conversation-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[useConversations]";
const PAGE_SIZE = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseConversationsOptions {
  teamId: string | null;
  activeConversationId: string | null;
}

interface UseConversationsReturn {
  /** Active (non-archived) conversations, paginated. */
  conversations: Conversation[];
  /** Archived conversations, paginated (loaded separately). */
  archivedConversations: Conversation[];
  /** Whether viewing archived or active list. */
  isArchiveView: boolean;
  /** Toggle between active and archived views. */
  toggleArchiveView: () => void;
  /** Loading state for initial fetch. */
  isLoading: boolean;
  /** Whether more conversations can be fetched for the current view. */
  hasMore: boolean;
  /** Fetch the next page of conversations (active or archived). */
  fetchMore: () => Promise<void>;
  /** Client-side title filter. */
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** Filtered conversations (applies searchQuery to current view). */
  filteredConversations: Conversation[];
  /** CRUD operations (optimistic). */
  renameConversation: (id: string, title: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  archiveConversation: (id: string) => Promise<void>;
  unarchiveConversation: (id: string) => Promise<void>;
  /** Add a newly created conversation to the top of the active list. */
  prependConversation: (conversation: Conversation) => void;
  /** Update a conversation in-place (e.g., title from async LLM generation). */
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchConversationsPage(
  archived: boolean,
  limit: number,
  cursor?: string,
  search?: string
): Promise<{ conversations: Conversation[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  params.set("archived", String(archived));
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  if (search) params.set("search", search);

  const res = await fetch(`/api/chat/conversations?${params.toString()}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  return res.json();
}

async function patchConversation(
  id: string,
  updates: ConversationUpdate
): Promise<Conversation> {
  const res = await fetch(`/api/chat/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.conversation;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversations(
  options: UseConversationsOptions
): UseConversationsReturn {
  const { teamId } = options;

  // Dual lists
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<
    Conversation[]
  >([]);

  // View state
  const [isArchiveView, setIsArchiveView] = useState(false);

  // Pagination state (separate for each list)
  const [activeHasMore, setActiveHasMore] = useState(true);
  const [archivedHasMore, setArchivedHasMore] = useState(true);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Track whether initial fetches have occurred
  const activeFetched = useRef(false);
  const archivedFetched = useRef(false);

  // -------------------------------------------------------------------------
  // Initial fetch — active conversations
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    activeFetched.current = false;

    async function load() {
      setIsLoading(true);
      try {
        console.log(`${LOG_PREFIX} fetching active conversations`);
        const data = await fetchConversationsPage(false, PAGE_SIZE);
        if (!cancelled) {
          setConversations(data.conversations);
          setActiveHasMore(data.hasMore);
          activeFetched.current = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`${LOG_PREFIX} failed to fetch active conversations: ${msg}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // -------------------------------------------------------------------------
  // Fetch archived on first toggle
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isArchiveView || archivedFetched.current) return;

    let cancelled = false;

    async function load() {
      try {
        console.log(`${LOG_PREFIX} fetching archived conversations`);
        const data = await fetchConversationsPage(true, PAGE_SIZE);
        if (!cancelled) {
          setArchivedConversations(data.conversations);
          setArchivedHasMore(data.hasMore);
          archivedFetched.current = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `${LOG_PREFIX} failed to fetch archived conversations: ${msg}`
        );
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isArchiveView, teamId]);

  // -------------------------------------------------------------------------
  // Pagination — fetch more
  // -------------------------------------------------------------------------

  const fetchMore = useCallback(async () => {
    const currentList = isArchiveView ? archivedConversations : conversations;
    const setList = isArchiveView
      ? setArchivedConversations
      : setConversations;
    const setHasMore = isArchiveView ? setArchivedHasMore : setActiveHasMore;

    if (currentList.length === 0) return;

    const lastItem = currentList[currentList.length - 1];
    const cursor = lastItem.updatedAt;

    try {
      console.log(
        `${LOG_PREFIX} fetching more ${isArchiveView ? "archived" : "active"} conversations`
      );
      const data = await fetchConversationsPage(
        isArchiveView,
        PAGE_SIZE,
        cursor
      );
      setList((prev) => [...prev, ...data.conversations]);
      setHasMore(data.hasMore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`${LOG_PREFIX} fetchMore failed: ${msg}`);
    }
  }, [isArchiveView, conversations, archivedConversations]);

  // -------------------------------------------------------------------------
  // View toggle
  // -------------------------------------------------------------------------

  const toggleArchiveView = useCallback(() => {
    setIsArchiveView((prev) => !prev);
  }, []);

  // -------------------------------------------------------------------------
  // Client-side search filter
  // -------------------------------------------------------------------------

  const filteredConversations = useMemo(() => {
    const list = isArchiveView ? archivedConversations : conversations;
    if (!searchQuery.trim()) return list;

    const q = searchQuery.toLowerCase();
    return list.filter((c) => c.title.toLowerCase().includes(q));
  }, [isArchiveView, conversations, archivedConversations, searchQuery]);

  // -------------------------------------------------------------------------
  // CRUD operations (optimistic)
  // -------------------------------------------------------------------------

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      // Optimistic update
      const updateInList = (prev: Conversation[]) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c));

      setConversations(updateInList);
      setArchivedConversations(updateInList);

      try {
        await patchConversation(id, { title });
        console.log(`${LOG_PREFIX} renamed conversation: ${id}`);
      } catch (err) {
        // Rollback: refetch
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`${LOG_PREFIX} rename failed, rolling back: ${msg}`);
        // Simple rollback: refetch active list
        const data = await fetchConversationsPage(false, PAGE_SIZE);
        setConversations(data.conversations);
        setActiveHasMore(data.hasMore);
      }
    },
    []
  );

  const pinConversation = useCallback(
    async (id: string, pinned: boolean) => {
      // Optimistic update
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isPinned: pinned } : c))
      );

      try {
        await patchConversation(id, { is_pinned: pinned });
        console.log(
          `${LOG_PREFIX} ${pinned ? "pinned" : "unpinned"} conversation: ${id}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`${LOG_PREFIX} pin toggle failed: ${msg}`);
        // Rollback
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, isPinned: !pinned } : c))
        );
      }
    },
    []
  );

  const archiveConversation = useCallback(async (id: string) => {
    // Optimistic: remove from active, add to archived
    let archivedItem: Conversation | undefined;

    setConversations((prev) => {
      archivedItem = prev.find((c) => c.id === id);
      return prev.filter((c) => c.id !== id);
    });

    if (archivedItem) {
      const item = { ...archivedItem, isArchived: true };
      setArchivedConversations((prev) => [item, ...prev]);
    }

    try {
      await patchConversation(id, { is_archived: true });
      console.log(`${LOG_PREFIX} archived conversation: ${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`${LOG_PREFIX} archive failed: ${msg}`);
      // Rollback: move back from archived to active
      if (archivedItem) {
        setConversations((prev) => [archivedItem!, ...prev]);
        setArchivedConversations((prev) =>
          prev.filter((c) => c.id !== id)
        );
      }
    }
  }, []);

  const unarchiveConversation = useCallback(async (id: string) => {
    // Optimistic: remove from archived, add to active
    let unarchivedItem: Conversation | undefined;

    setArchivedConversations((prev) => {
      unarchivedItem = prev.find((c) => c.id === id);
      return prev.filter((c) => c.id !== id);
    });

    if (unarchivedItem) {
      const item = { ...unarchivedItem, isArchived: false };
      setConversations((prev) => [item, ...prev]);
    }

    try {
      await patchConversation(id, { is_archived: false });
      console.log(`${LOG_PREFIX} unarchived conversation: ${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`${LOG_PREFIX} unarchive failed: ${msg}`);
      // Rollback
      if (unarchivedItem) {
        setArchivedConversations((prev) => [unarchivedItem!, ...prev]);
        setConversations((prev) => prev.filter((c) => c.id !== id));
      }
    }
  }, []);

  // -------------------------------------------------------------------------
  // Prepend + update (for new conversations and async title)
  // -------------------------------------------------------------------------

  const prependConversation = useCallback((conversation: Conversation) => {
    setConversations((prev) => [conversation, ...prev]);
  }, []);

  const updateConversation = useCallback(
    (id: string, updates: Partial<Conversation>) => {
      const updateInList = (prev: Conversation[]) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c));

      setConversations(updateInList);
      setArchivedConversations(updateInList);
    },
    []
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    conversations,
    archivedConversations,
    isArchiveView,
    toggleArchiveView,
    isLoading,
    hasMore: isArchiveView ? archivedHasMore : activeHasMore,
    fetchMore,
    searchQuery,
    setSearchQuery,
    filteredConversations,
    renameConversation,
    pinConversation,
    archiveConversation,
    unarchiveConversation,
    prependConversation,
    updateConversation,
  };
}
