-- ============================================================
-- PRD-029 Part 7: Per-user fan-out + actor suppression
-- ============================================================
-- Restructures the table from one-row-per-event to
-- one-row-per-recipient. Existing broadcast rows (user_id IS NULL)
-- are dropped (PRD-029 §P7.R5).
--
-- Idempotent — every object guarded with IF NOT EXISTS / OR REPLACE
-- so re-applying against an already-migrated environment is safe.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop in-flight broadcast rows (PRD-029 §P7.R5).
-- ------------------------------------------------------------
-- Reconstructing recipient sets for historical broadcasts is brittle —
-- team membership at emit time vs now may differ. Notifications are
-- ephemeral by design, so a one-time cutover loss is acceptable.
DELETE FROM workspace_notifications WHERE user_id IS NULL;

-- ------------------------------------------------------------
-- 2. Schema changes — relax team_id, tighten user_id.
-- ------------------------------------------------------------
-- team_id NULL = personal-workspace notification (no team).
-- user_id is now the recipient on every row; broadcasts are fanned
-- out at emit time, so a row without a recipient is invalid.
ALTER TABLE workspace_notifications ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE workspace_notifications ALTER COLUMN user_id SET NOT NULL;

-- ------------------------------------------------------------
-- 3. Drop the old broadcast-aware policies.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read their own and broadcast notifications"
  ON workspace_notifications;
DROP POLICY IF EXISTS "Users can mark visible notifications as read"
  ON workspace_notifications;

-- ------------------------------------------------------------
-- 4. New simplified policies — visibility purely by user_id.
-- ------------------------------------------------------------
-- Cross-user leakage is now structurally impossible: each row has
-- exactly one recipient, the SELECT predicate matches that one
-- recipient, and there are no other code paths into the table from
-- the authenticated role.
DROP POLICY IF EXISTS "Users read their own notifications"
  ON workspace_notifications;
CREATE POLICY "Users read their own notifications"
  ON workspace_notifications
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users mark their own notifications as read"
  ON workspace_notifications;
CREATE POLICY "Users mark their own notifications as read"
  ON workspace_notifications
  FOR UPDATE
  USING (user_id = auth.uid());

-- INSERT and DELETE: still no policy = service-role only.

-- ------------------------------------------------------------
-- 5. Indexes — drop the now-unused team_id partials and replace
--    the user_id partials with full indexes (user_id is NOT NULL
--    now, so partial WHEREs are redundant).
-- ------------------------------------------------------------
DROP INDEX IF EXISTS workspace_notifications_team_recent_idx;
DROP INDEX IF EXISTS workspace_notifications_user_recent_idx;
DROP INDEX IF EXISTS workspace_notifications_user_unread_idx;

-- Hot path: dropdown listing for one user.
CREATE INDEX IF NOT EXISTS workspace_notifications_user_recent_idx
  ON workspace_notifications (user_id, created_at DESC);

-- Hot path: unread badge count.
CREATE INDEX IF NOT EXISTS workspace_notifications_user_unread_idx
  ON workspace_notifications (user_id)
  WHERE read_at IS NULL;

-- expires_at index from migration 001 is unchanged.
