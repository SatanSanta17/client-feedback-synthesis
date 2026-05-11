-- Widen the role CHECK constraint on team_members and team_invitations to
-- include the new 'product_manager' role. Product manager has the same
-- effective permissions as 'sales' (non-admin) — see ARCHITECTURE.md
-- "Key Design Decisions" #9.

ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
ALTER TABLE team_members
  ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('admin', 'sales', 'product_manager'));

ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_role_check;
ALTER TABLE team_invitations
  ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('admin', 'sales', 'product_manager'));
