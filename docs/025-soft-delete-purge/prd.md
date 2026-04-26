# PRD-025: Soft-Delete Purge of Session Data

## Purpose

When a session is soft-deleted, only the `sessions.deleted_at` column is set. Two downstream stores keep their data indefinitely:

- **Supabase Storage** — files in `SYNTHESISER_FILE_UPLOAD` linked to the session's attachments are never removed. The `session_attachments` rows are soft-deleted with the parent, but the storage objects they reference remain.
- **`session_embeddings`** — pgvector rows for the session remain in place. Dashboard and chat queries hide them via `WHERE sessions.deleted_at IS NULL`, but the rows continue to consume storage and influence index size.

On the Supabase free tier (1GB storage, finite pgvector capacity) this is silent debt — every soft-delete leaves bytes behind that we keep paying to retain forever, with no recovery UI to justify the cost.

This PRD bundles E6 (storage orphans) from the gap analysis with its sibling embedding-orphan issue under one mechanism: a deferred purge that respects a recovery window, then hard-deletes everything tied to a soft-deleted session.

## User Story

As an end user, I want soft-deleted sessions to remain recoverable for a defined window — so an accidental delete is not an immediate, irreversible loss.

As an operator, I want session data (files and embeddings) hard-deleted automatically once the recovery window expires — so storage doesn't accumulate orphans I have to chase manually.

As a developer, I want one purge mechanism that covers both stores — so a future "what data lives where for a deleted session" question has one answer, not two.

---

## Part 1 — Deferred Purge of Soft-Deleted Session Data

**Severity:** Medium-High — silent storage accumulation on a tier-bounded backend. Not user-facing, but compounding.

### Requirements

**P1.R1 — A retention window is defined and documented.**
Soft-deleted sessions stay fully recoverable (in DB, in storage, and in pgvector) for a fixed window after `deleted_at`. The window is a single configuration value, not per-session, and lives alongside the existing constants in `lib/constants.ts` so the value is discoverable and code-reviewable. The TRD pins the actual duration (the working assumption is 30 days; the PRD does not constrain it).

**P1.R2 — After the window, all attachment files are hard-deleted from Supabase Storage.**
For every session where `deleted_at + retention_window < now()`, every storage object referenced by its `session_attachments` rows is removed from `SYNTHESISER_FILE_UPLOAD`. After purge, the bucket contains zero files belonging to that session.

**P1.R3 — After the window, all `session_embeddings` rows for the session are hard-deleted.**
The pgvector rows are removed. Existing `ON DELETE CASCADE` relationships (e.g., `signal_themes.embedding_id`) clean up dependent rows automatically; the purge does not require additional table-by-table cleanup.

**P1.R4 — Hard-delete of the session row itself is sequenced after both purges complete.**
Storage and embedding cleanup happen first; the `sessions` row (and its `session_attachments` children) are hard-deleted only after both succeed for that session. Partial failure leaves the session in a "soft-deleted, awaiting purge" state that the next run retries — no audit gaps, no half-purged sessions.

**P1.R5 — The purge runs on a defined schedule with no manual trigger.**
The job runs at least once per day without operator intervention. The schedule and the runtime (cron-style trigger, scheduled function, or DB-level scheduler) are pinned in the TRD; the PRD's requirement is that a soft-deleted session past the retention window does not survive longer than ~24 hours past the boundary.

**P1.R6 — Purge actions are logged.**
Each run logs the count of sessions inspected, the count purged, the count of storage objects removed, the count of embedding rows removed, and any per-session failures (with `sessionId` and the error). A "silent zero-action" run is itself logged — so a misconfigured or non-running purge is observable, not invisible.

**P1.R7 — The purge is idempotent and re-entrant.**
Running the purge twice in quick succession (or running it while the previous run is still in flight) does not double-delete, error on missing files, or leave inconsistent state. Already-purged sessions are no-ops on subsequent runs.

**P1.R8 — Sessions inside the recovery window are untouched.**
A session soft-deleted yesterday (with a 30-day window) is fully recoverable: its attachments still in storage, its embeddings still in pgvector, its row still present with `deleted_at` set. The purge only acts on sessions past the retention boundary.

### Acceptance Criteria

- [ ] P1.R1 — Retention window is exported as a named constant from `lib/constants.ts`; its value appears in exactly one place.
- [ ] P1.R2 — A soft-deleted session past the retention window has zero remaining files in `SYNTHESISER_FILE_UPLOAD` after the next purge cycle. Verified by listing the bucket prefix for a known purged session.
- [ ] P1.R3 — A soft-deleted session past the retention window has zero remaining rows in `session_embeddings` after the next purge cycle. Verified by `SELECT count(*) FROM session_embeddings WHERE session_id = …`.
- [ ] P1.R4 — Forcing P1.R2 or P1.R3 to fail (manually, in a test harness) leaves the `sessions` row intact with `deleted_at` set; the next purge run completes the work.
- [ ] P1.R5 — The purge runs on schedule with no manual invocation; a soft-deleted session past the window is gone within ~24 hours of crossing it.
- [ ] P1.R6 — A purge run produces a log line summarizing inspected/purged counts and per-session failures (if any). A no-op run still logs.
- [ ] P1.R7 — Running the purge twice back-to-back is observably safe — no double-delete errors, no orphan complaints, no inconsistent state.
- [ ] P1.R8 — A session soft-deleted 1 day ago (with a 30-day window) is fully recoverable via the existing data layer — DB row present, attachments listable, embeddings present.

---

## Backlog

Items deferred from this PRD — real follow-ups, but lower leverage than the core purge.

- **User-facing recovery UI.** Soft-delete is technically reversible today but has no UI to undo it. Adding a "Recently deleted" view + restore action would make the retention window meaningful for end users, not just operators.
- **Per-team retention policy.** A single global window is the right starting point. Larger workspaces may eventually want a longer window; tier-gated would be a future product decision.
- **Storage / embedding usage dashboard.** A surface that shows orphan-pending vs. live storage would let operators sanity-check the purge before bumping the window.
- **Hard-delete on explicit user request.** Today the only purge path is time-based. A "delete now, skip retention" flow could land later if/when GDPR-style requests become real.
- **Same purge mechanism for other soft-deleted entities.** Clients, teams, and master signals all soft-delete but have similar long-tail orphan questions. Out of scope here; their orphan profiles are smaller.
