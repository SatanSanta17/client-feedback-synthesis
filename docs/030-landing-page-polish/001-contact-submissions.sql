-- ============================================================
-- PRD-030 Part 3: Contact submissions
-- ============================================================
-- Persists every successful submission from the public landing-page
-- contact form. Service-role only — RLS denies all anon and authenticated
-- reads/writes; the /api/contact route handler bypasses RLS via the
-- service-role Supabase client.
--
-- The form is intentionally low-friction (3 fields: name, email, message).
-- Length caps are enforced at both Zod (route) and DB (CHECK constraints
-- here) so a malformed direct DB write would still be rejected.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE contact_submissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  email       CITEXT      NOT NULL CHECK (char_length(email) <= 254),
  message     TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  user_agent  TEXT,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------

-- Operator's eventual admin UI (deferred to PRD-030 backlog) reads
-- most-recent submissions first. No email/name indexes — there is no
-- query path that needs them at this scale.
CREATE INDEX contact_submissions_recent_idx
  ON contact_submissions (created_at DESC);

-- ------------------------------------------------------------
-- Row-Level Security
-- ------------------------------------------------------------

ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;

-- Deny all reads for anon and authenticated roles. The /api/contact
-- route uses the service-role client which bypasses RLS.
CREATE POLICY "No client reads of contact submissions"
  ON contact_submissions
  FOR SELECT
  USING (false);

-- No INSERT, UPDATE, or DELETE policies = no anon access. Service-role
-- client only.
