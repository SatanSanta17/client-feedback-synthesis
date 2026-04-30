-- ============================================================
-- PRD-029 Part 4: Enable Supabase Realtime on workspace_notifications
-- ============================================================
-- Realtime publishes table changes (INSERT / UPDATE / DELETE) over
-- WebSocket to subscribed clients. RLS policies on the table apply to
-- the event stream — each subscriber only receives changes for rows
-- they can SELECT. Part 1's existing SELECT policy gives us per-user
-- filtering "for free": targeted notifications stream to their `user_id`
-- only; broadcasts stream to every member of `team_id`.
--
-- Default `REPLICA IDENTITY` (PRIMARY KEY) is sufficient — the bell
-- uses Realtime events as a "something changed, refetch" trigger and
-- does not read column values out of the change payload.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE workspace_notifications;
