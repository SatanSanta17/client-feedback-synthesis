# PRD-028 — Feedback Supersession & Resolution Tracking

## Purpose

Customer feedback evolves over time. A complaint from one quarter may be addressed by the next; a previously-positive remark may regress. Today the platform treats every captured signal as eternally true: dashboards count a March pain point exactly the same way three years later, even if the same client has since told us the issue is fixed.

This PRD introduces a resolution-tracking layer so that:

- Dashboards reflect **where the product stands today**, not the cumulative history of every issue ever raised.
- The "from X to Y" journey of a client's experience is preserved and surfaced in a dedicated improvements view.
- AI-detected supersessions never silently distort data — every link is user-confirmed.
- Positive feedback ("what's working") becomes a first-class signal type rather than a session-level afterthought.

## Background

The current extraction schema captures negative-leaning signals (`painPoints`, `requirements`, `blockers`, `aspirations`) plus session-level `sentiment`. There is no per-chunk sentiment and no first-class "praise" category. Once a session is captured, its embeddings live forever and are aggregated into widgets without any notion of "this issue has since been resolved."

This PRD closes both gaps in one coherent feature: positive feedback becomes capturable, and the platform learns to recognise (with the user's consent) when a new signal supersedes an older one.

## User Story

> *As a sales rep capturing a follow-up call with a client who previously had concerns,*
> when I save my session notes, the platform should detect that something I wrote may resolve (or contradict) feedback from a past session with the same client, and ask me to confirm before linking the two.

> *As a product leader reviewing the dashboard,*
> I want widgets to show the current state of the product (with resolved issues excluded from active counts), and I want a separate Improvements view that shows the full resolution journey per client.

> *As a sales lead coordinating with my team,*
> I want supersession proposals from bulk operations (e.g. bulk re-extraction) to land in a review inbox rather than block on individual dialogs.

## Scope

**In scope:**

- Per-chunk sentiment + a first-class "what's working" category in the extraction schema
- Embedding-level supersession links (same client, latest wins)
- AI detection with user confirmation at save time
- Pending-review inbox for bulk and deferred proposals
- Dashboard widgets respecting supersession by default, with a toggle to opt back in
- A dedicated Improvements view
- Resolution-driven milestone insights

**Out of scope:**

- Cross-client supersession (only same-client linking)
- Themes-level merge / dedup (PRD-026 territory)
- Sentiment trend forecasting
- Automatic conversion of feedback into ticketed work items

## Constraints & Decisions

1. **Same client only.** A supersession link only forms between two embeddings whose parent sessions share the same `client_id`. Cross-client improvements do not negate other clients' complaints.
2. **Embedding-level, not theme-level.** Links live on the `session_embeddings` row, not on themes. Theme assignments remain untouched on both sides; dashboards filter at query time by supersession state.
3. **Junction table for links.** A separate `signal_supersessions` table holds `predecessor_embedding_id` and `successor_embedding_id`, both `ON DELETE CASCADE`. No twin-pointer columns on `session_embeddings`.
4. **Single link kind: `supersedes`.** The direction-of-change (resolution vs regression) is *derived* from the per-chunk sentiment of predecessor vs successor — not stored as a separate kind.
5. **Lookback cap: last 15 sessions ∩ past 3 years.** Detection scans only the same client's most recent 15 sessions and only those within the past 3 years — whichever window is smaller wins.
6. **User confirms every link.** No confidence threshold gates auto-application. Confidence becomes a UI sort/badge on the dialog and inbox.
7. **Two save paths:**
   - **Inline dialog (α)** — fresh saves prompt the user with batched proposals in the same flow as the save.
   - **Pending-review inbox (β)** — bulk re-extraction, single-session re-extraction, dismissed inline dialogs, and timed-out detections deposit proposals into an inbox for later review.
8. **Latest wins, transitively.** If A → B → C is a confirmed chain, only C is "active." Default dashboard counts treat A and B as superseded. Transitivity is computed at query time, not stored.
9. **Rejected and deferred links are persisted.** Rejections are kept (auditable). Deferrals stay `pending` in the inbox until acted upon.

---

## Part 1 — Positive Feedback as a First-Class Signal

Capture praise / "what's working" with the same fidelity as pain points so supersession detection has both sides to reason over.

### Requirements

- **P1.R1.** The extraction schema gains a `whatsWorking` category — an array of signal chunks describing what the client has called out as working well, including direct praise.
- **P1.R2.** Every signal chunk (across `painPoints`, `requirements`, `aspirations`, `blockers`, `whatsWorking`, `custom.signals`) carries a `sentiment` field with values `positive | neutral | negative`. Existing categories supply a sensible default sentiment based on category semantics (e.g., `painPoints` defaults to `negative`); the LLM may override per chunk.
- **P1.R3.** The extraction system prompt is updated to instruct the LLM to capture praise in `whatsWorking` and to assign per-chunk sentiment.
- **P1.R4.** The `chunk_type` convention on `session_embeddings` adds `whats_working`. Backward compatibility: existing rows remain valid; old data is not backfilled by this PRD.
- **P1.R5.** `EXTRACTION_SCHEMA_VERSION` increments to 2. Existing v1 extractions remain readable; no backfill is required for this PRD (covered in backlog).
- **P1.R6.** `StructuredSignalView` renders `whatsWorking` as a section with a positive-leaning visual treatment, distinct from pain points and aspirations.
- **P1.R7.** The chunking service emits per-chunk sentiment into embedding `metadata` so downstream services (supersession detection, dashboards, insights) can read it without re-parsing `structured_json`.

### Acceptance Criteria

- [ ] `extractionSchema` includes `whatsWorking` and per-chunk `sentiment` on all signal-chunk variants.
- [ ] System prompt asks the LLM to capture praise and assign per-chunk sentiment.
- [ ] `chunk_type` accepts `whats_working`.
- [ ] `EXTRACTION_SCHEMA_VERSION` is 2; v1 sessions still render correctly in `StructuredSignalView`.
- [ ] `StructuredSignalView` renders the new section.
- [ ] Embedding metadata for newly-extracted sessions includes `sentiment` per chunk.
- [ ] No regressions in extraction output for sessions that contain no praise content.

---

## Part 2 — Supersession Data Model

Persist links between superseded and superseding embeddings.

### Requirements

- **P2.R1.** A new `signal_supersessions` table stores one row per link with at minimum: `id`, `predecessor_embedding_id`, `successor_embedding_id`, `client_id`, `team_id`, `confidence`, `llm_rationale`, `status`, `confirmed_by`, `confirmed_at`, `created_at`.
- **P2.R2.** `status` values: `pending` (awaiting user action), `confirmed` (active link), `rejected` (user explicitly rejected — kept for audit).
- **P2.R3.** Both embedding FKs use `ON DELETE CASCADE` so re-extraction of either side cleanly removes affected links.
- **P2.R4.** A unique index prevents duplicate `(predecessor_embedding_id, successor_embedding_id)` pairs.
- **P2.R5.** RLS mirrors the parent embeddings: personal users access their own links; team members access team links.
- **P2.R6.** A repository (`SupersessionRepository`) abstracts persistence per the dependency-inversion convention. A Supabase adapter implements it.
- **P2.R7.** Generated Supabase types are regenerated to include the new table.
- **P2.R8.** Same-client constraint: predecessor and successor embeddings must belong to sessions sharing the same `client_id`. Enforced at the service layer at minimum; database-level constraint preferred where practical.

### Acceptance Criteria

- [ ] Migration creates `signal_supersessions` with all columns, indexes, and RLS policies.
- [ ] FK cascade verified — deleting either parent embedding removes the link.
- [ ] Same-client constraint rejects mismatched pairs.
- [ ] Repository interface and Supabase adapter implemented and used by callers.
- [ ] Supabase types committed and reflect the new table.

---

## Part 3 — AI Supersession Detection

Generate proposed links during save / re-extract.

### Requirements

- **P3.R1.** A new service (`supersession-service`) accepts the new embedding IDs for a session and returns a list of proposed supersessions.
- **P3.R2.** For each new chunk, the service searches the same client's existing embeddings within the lookback window — most-recent 15 sessions AND past 3 years (intersection) — using the existing similarity-search RPC.
- **P3.R3.** The service prompts the LLM with side-by-side text + metadata for each candidate pair (or batched candidates per new chunk) and asks: "does the new chunk supersede the older one?" The LLM returns `{ supersedes: boolean, confidence: 0–1, rationale: string }` per pair.
- **P3.R4.** Multiple candidate pairs from the same session are batched into one LLM call where possible, to keep cost at one supersession LLM call per session.
- **P3.R5.** Returned proposals are persisted to `signal_supersessions` with `status = 'pending'` and surfaced via the appropriate path (inline dialog or inbox).
- **P3.R6.** The service follows the existing logging conventions (entry, exit, error, elapsed ms).
- **P3.R7.** Detection is skipped (no LLM call) when the lookback window contains no candidates — e.g., the client's first session.
- **P3.R8.** Detection failure does not block the save or the rest of the post-response chain. Errors are logged and the proposal step is skipped for that session.

### Acceptance Criteria

- [ ] `supersession-service` produces correctly-shaped proposals for a synthetic test session.
- [ ] Lookback cap enforced (last 15 sessions ∩ past 3 years).
- [ ] No detection LLM call fires for a brand-new client's first session.
- [ ] LLM prompt and response schema live under `lib/prompts/` and `lib/schemas/` respectively.
- [ ] Batched proposals reduce per-session LLM calls to one regardless of new-chunk count.
- [ ] Service errors are caught, logged, and do not break the save.

---

## Part 4 — Inline Confirmation Dialog (Fresh Saves)

User confirms supersessions in the moment, with full call context.

### Requirements

- **P4.R1.** On a fresh session save (i.e., not re-extract, not bulk), supersession detection runs in the same user-perceived flow as the save when at least one candidate exists.
- **P4.R2.** When proposals are returned, the client surfaces a single batched dialog listing every proposal — predecessor and successor text snippets side-by-side, client name, both session dates, theme(s), and a confidence badge.
- **P4.R3.** The dialog exposes per-proposal **Accept**, **Reject**, and a single batch-level **Decide later** action that defers the entire batch to the inbox.
- **P4.R4.** Accepted proposals persist with `status = 'confirmed'` (with `confirmed_by`, `confirmed_at`). Rejected proposals persist with `status = 'rejected'`. Deferred proposals retain `status = 'pending'`.
- **P4.R5.** The user-perceived save flow shows a clear in-progress state ("Checking for related past feedback…") while detection runs. The mechanism (synchronous-before-save, parallel-with-save, or post-save fetch) is a TRD decision; the user-facing requirement is that the dialog appears in the same flow as the save and not as a delayed notification.
- **P4.R6.** If detection exceeds a configured timeout, the save completes and the proposals fall through to the inbox without showing the dialog (graceful degradation).
- **P4.R7.** Detection failure degrades silently — the save succeeds, no dialog appears, and the failure is logged server-side.
- **P4.R8.** Closing the dialog without a per-proposal decision is treated as **Decide later** for those untouched items.

### Acceptance Criteria

- [ ] First save of a session that has at least one candidate triggers the dialog.
- [ ] Batched dialog displays all proposals with the required fields side-by-side.
- [ ] Per-proposal Accept / Reject and batch-level Decide later all persist correctly.
- [ ] Saves with no proposals do not show the dialog.
- [ ] Detection timeout falls through to the inbox cleanly.
- [ ] Detection failure does not break the save.

---

## Part 5 — Pending-Review Inbox

A surface for proposals deferred from bulk operations or dismissed dialogs.

### Requirements

- **P5.R1.** A new surface (e.g., `/improvements/inbox`) lists `pending` supersession proposals scoped to the active workspace.
- **P5.R2.** Each row shows the same context as the inline dialog: predecessor and successor text, client, both session dates, theme(s), and confidence badge. Per-row Accept and Reject actions are inline.
- **P5.R3.** Bulk re-extraction (PRD-017) generates proposals via the same service but never opens dialogs — all proposals land in the inbox with `status = 'pending'`.
- **P5.R4.** Single-session re-extraction also routes proposals to the inbox (no inline dialog).
- **P5.R5.** A badge or counter (e.g., on the navigation entry) reflects the number of pending proposals.
- **P5.R6.** Bulk actions (Accept all / Reject all) are supported on a per-client and per-theme grouping.
- **P5.R7.** RLS — users only see proposals belonging to their workspace.
- **P5.R8.** Dashboard "current state" widgets do **not** count `pending` proposals. Only `confirmed` links suppress predecessor chunks. This keeps the dashboard honest while items await review.

### Acceptance Criteria

- [ ] Inbox lists pending proposals for the active workspace.
- [ ] Bulk re-extract deposits proposals to the inbox without showing dialogs.
- [ ] Single-session re-extract also routes to the inbox.
- [ ] Per-row Accept and Reject work.
- [ ] Bulk per-client and per-theme actions work.
- [ ] Inbox counter updates as proposals are resolved.
- [ ] Pending proposals do not affect dashboard aggregates.

---

## Part 6 — Dashboard "Current State" Semantics

Widgets reflect the product as it stands today.

### Requirements

- **P6.R1.** All count-based theme widgets (`top_themes`, `theme_trends`, `theme_client_matrix`, `competitive_mention_frequency`) and sentiment / urgency widgets exclude superseded chunks from their aggregates by default.
- **P6.R2.** A chunk is considered "superseded" if there exists a **confirmed** supersession link where this chunk is the predecessor and the successor is itself not superseded (transitive — only the latest in any chain counts as active).
- **P6.R3.** The global filter bar gains an "Include superseded" toggle (default off). When on, all widgets revert to all-time aggregates.
- **P6.R4.** Drill-down panels respect the toggle.
- **P6.R5.** A subtle visual indicator on widgets ("X superseded excluded") communicates that supersession is in effect when results are filtered.
- **P6.R6.** Insight aggregates (used by the headline-insights generator) honor supersession by default for "current state" framings.

### Acceptance Criteria

- [ ] Widgets default to excluding superseded chunks.
- [ ] Filter toggle reverses the behaviour across all widgets.
- [ ] Transitive chains correctly identify only the latest link as active.
- [ ] Drill-downs respect the toggle.
- [ ] Visual indicator is present when supersession is excluding data.

---

## Part 7 — Improvements View

A dedicated surface showing the resolution journey per client.

### Requirements

- **P7.R1.** A new route (`/improvements` or a tab on the dashboard) lists all `confirmed` supersession links scoped to the active workspace.
- **P7.R2.** Each entry shows predecessor → successor text snippets, client, both session dates, the elapsed time between them, and theme(s).
- **P7.R3.** Entries can be filtered by client, theme, and date range.
- **P7.R4.** Entries can be grouped by client (default) or theme.
- **P7.R5.** Each entry links back to both source sessions via the existing session preview dialog.
- **P7.R6.** A summary counter at the top reflects the workspace's resolution activity (e.g., "47 issues resolved across 12 clients in the last quarter").
- **P7.R7.** The view distinguishes resolution chains (negative → positive) from regression chains (positive → negative) using the per-chunk sentiment of predecessor and successor.

### Acceptance Criteria

- [ ] Improvements view lists confirmed links with all required fields.
- [ ] Filtering and grouping work.
- [ ] Summary counter reflects current data.
- [ ] Source session links open existing preview dialogs.
- [ ] Resolutions and regressions are visually distinguished.

---

## Part 8 — Resolution Milestone Insights

Surface confirmed resolutions as headline insights on the dashboard.

### Requirements

- **P8.R1.** The headline-insights generator (`generateHeadlineInsights`) gains a new aggregate input: recently-confirmed supersessions (e.g., last 14 days), grouped by theme and client count.
- **P8.R2.** When meaningful resolution patterns exist (e.g., a theme with multiple recent confirmed supersessions), an insight of type `milestone` is emitted.
- **P8.R3.** Milestone insight content references the theme and the count of resolutions (e.g., "Onboarding friction reported by 4 clients now resolved per 3 of them").
- **P8.R4.** The insight prompt is updated to recognise and prioritise resolution-shaped data.
- **P8.R5.** No regression in existing trend / anomaly insight generation.

### Acceptance Criteria

- [ ] Headline-insights generator receives supersession aggregates.
- [ ] Milestone insights are generated when resolution patterns exist.
- [ ] Insight content correctly references resolution counts and themes.
- [ ] Trend and anomaly insight types are unaffected.

---

## Backlog (post-PRD)

- **Manual unlink action.** Admin-level action to flip a `confirmed` link back to `rejected` if the LLM was wrong and the user accepted by mistake.
- **Cross-client supersession.** Aggregate-level "this issue is broadly resolved" detection across clients.
- **Partial supersession.** A `partial` link kind for cases where a new chunk only addresses part of an old one.
- **Supersession audit log.** A per-team log of who confirmed / rejected / deferred which proposals.
- **Inbox notifications.** Email or in-app notification when bulk-re-extract deposits proposals.
- **Backfill positive feedback for historical sessions.** A one-time job that re-extracts old sessions to populate `whatsWorking` and per-chunk sentiment.
- **Supersession from chat.** Allow users to confirm / propose links from the RAG chat surface when the model surfaces a contradiction across sessions.

---

## Non-Goals

- Themes-level deduplication or merging (PRD-026).
- Forecasting or predictive sentiment analytics.
- Automatic conversion of feedback into ticketed work items.
- Cross-team supersession.
