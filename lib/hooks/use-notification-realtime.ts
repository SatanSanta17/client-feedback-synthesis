"use client";

// ---------------------------------------------------------------------------
// useNotificationRealtime — shared subscription hook (PRD-029 Part 4)
// ---------------------------------------------------------------------------
// Subscribes to `workspace_notifications` row changes via Supabase Realtime
// and invokes `onChange` on every INSERT / UPDATE / DELETE the user has RLS
// visibility to. Used by both `use-unread-count` and `use-notifications` so
// the badge and list both update within seconds of any change.
// ---------------------------------------------------------------------------

import { useEffect, useId, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

const LOG_PREFIX = "[useNotificationRealtime]";
const CHANNEL_NAME_PREFIX = "workspace-notifications";

/**
 * Subscribes to `workspace_notifications` row changes via Supabase Realtime.
 *
 * The callback is held in a ref so changing its identity across renders does
 * not tear down the subscription — without this, every parent re-render that
 * produced a new `onChange` would trigger a WebSocket round-trip cleanup +
 * reconnect.
 *
 * Each consumer gets its own uniquely-named channel via `useId()`. Supabase
 * Realtime treats the channel topic as the dedup key — two consumers calling
 * `.channel("same-name")` end up sharing the underlying channel object, and
 * the second consumer's `.on("postgres_changes", ...)` registration is
 * rejected because the channel is already subscribed. Per-consumer channel
 * names sidestep that entirely: each hook instance has its own channel with
 * its own listener, multiplexed onto the one underlying WebSocket. Cleanup
 * is unambiguously local — `removeChannel` only tears down this consumer.
 *
 * Subscription lifecycle is `useEffect` mount/unmount: the channel is torn
 * down when the consumer unmounts. Sign-out flows naturally cascade through
 * `AuthenticatedLayout` swapping to a public route, which unmounts the bell
 * tree and triggers cleanup.
 */
export function useNotificationRealtime(onChange: () => void): void {
  const onChangeRef = useRef(onChange);
  const consumerId = useId();
  const channelName = `${CHANNEL_NAME_PREFIX}:${consumerId}`;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_notifications",
        },
        () => {
          onChangeRef.current();
        }
      )
      .subscribe((status) => {
        // Statuses: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'.
        // Worth observing — silent drops are exactly what the polling
        // fallback in `use-unread-count` exists to compensate for.
        console.log(`${LOG_PREFIX} ${channelName} status: ${status}`);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName]);
}
