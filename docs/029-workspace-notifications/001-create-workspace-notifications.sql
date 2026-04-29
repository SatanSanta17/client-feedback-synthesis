-- ============================================================
-- PRD-029 Part 1: Workspace notifications primitive
-- ============================================================
-- Persistent notifications for workspace-level events. One row per
-- notification. Visibility is decided by the (team_id, user_id) pair:
--   - user_id IS NOT NULL → targeted, visible only to that user
--   - user_id IS NULL     → broadcast, visible to every member of team_id
-- Event-type strings are governed by the application-layer registry
-- (lib/notifications/events.ts); no DB-level CHECK constraint is enforced
-- here so adding a new event type is a single-file code change.
-- ============================================================

CREATE TABLE workspace_notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id     UUID                  REFERENCES auth.users (id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------

-- Hot path: targeted dropdown listing for one user.
CREATE INDEX workspace_notifications_user_recent_idx
  ON workspace_notifications (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Hot path: targeted unread count for the bell badge.
CREATE INDEX workspace_notifications_user_unread_idx
  ON workspace_notifications (user_id)
  WHERE user_id IS NOT NULL AND read_at IS NULL;

-- Hot path: broadcast dropdown listing per team. Broadcast volume is
-- bounded so a separate broadcast-unread index is unjustified.
CREATE INDEX workspace_notifications_team_recent_idx
  ON workspace_notifications (team_id, created_at DESC)
  WHERE user_id IS NULL;

-- Forward-compat: Part 5 cleanup query reads through this.
CREATE INDEX workspace_notifications_expires_idx
  ON workspace_notifications (expires_at)
  WHERE expires_at IS NOT NULL;

-- ------------------------------------------------------------
-- Row-Level Security
-- ------------------------------------------------------------

ALTER TABLE workspace_notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: targeted rows the user owns OR broadcast rows for teams they
-- belong to.
CREATE POLICY "Users can read their own and broadcast notifications"
  ON workspace_notifications
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM team_members
        WHERE team_members.team_id = workspace_notifications.team_id
          AND team_members.user_id = auth.uid()
      )
    )
  );

-- UPDATE: same visibility set as SELECT. The service layer enforces
-- that only read_at is mutated; column-level enforcement is not offered
-- by RLS.
CREATE POLICY "Users can mark visible notifications as read"
  ON workspace_notifications
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM team_members
        WHERE team_members.team_id = workspace_notifications.team_id
          AND team_members.user_id = auth.uid()
      )
    )
  );

-- INSERT and DELETE: no policy = no anon access. Service-role client only.
