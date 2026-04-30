"use client";

// ---------------------------------------------------------------------------
// useNotificationRealtime — shared subscription hook (PRD-029 Part 4)
// ---------------------------------------------------------------------------
// Subscribes to `workspace_notifications` row changes via Supabase Realtime
// and invokes `onChange` on every INSERT / UPDATE / DELETE the user has RLS
// visibility to. Used by both `use-unread-count` and `use-notifications` so
// the badge and list both update within seconds of any change.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

const LOG_PREFIX = "[useNotificationRealtime]";
const CHANNEL_NAME = "workspace-notifications";

/**
 * Subscribes to `workspace_notifications` row changes via Supabase Realtime.
 *
 * The callback is held in a ref so changing its identity across renders does
 * not tear down the subscription — without this, every parent re-render that
 * produced a new `onChange` would trigger a WebSocket round-trip cleanup +
 * reconnect.
 *
 * The channel name `"workspace-notifications"` is a convention — multiple
 * consumers (badge + list) each create their own channel object under this
 * name; supabase-js multiplexes them onto one underlying WebSocket. Because
 * each consumer holds its own channel reference, `removeChannel` on cleanup
 * is unambiguous: it tears down only this consumer's listener, never affects
 * the other consumer's subscription.
 *
 * Subscription lifecycle is `useEffect` mount/unmount: the channel is torn
 * down when the consumer unmounts. Sign-out flows naturally cascade through
 * `AuthenticatedLayout` swapping to a public route, which unmounts the bell
 * tree and triggers cleanup.
 */
export function useNotificationRealtime(onChange: () => void): void {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(CHANNEL_NAME)
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
        console.log(`${LOG_PREFIX} subscription status: ${status}`);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}
