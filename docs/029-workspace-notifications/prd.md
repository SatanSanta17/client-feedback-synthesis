# PRD-029 — Workspace Notifications

## Purpose

Today the platform has only ephemeral toasts (Sonner) for in-the-moment feedback after a user's own actions. There is no persistent surface for *workspace-level* events — actions whose visibility extends beyond the user who triggered them. Two PRDs already in flight need exactly this:

- **PRD-026 (Theme Deduplication) P4** — when an admin merges two themes, other workspace members need to know why a dashboard widget just renamed itself. A toast in the actor's session does not reach them.
- **PRD-028 (Feedback Supersession) P5** — the pending-review inbox needs an unread counter so admins notice when bulk re-extraction has deposited proposals.

Two more upcoming PRDs are likely consumers:

- **PRD-025 (Soft Delete & Purge)** — purge run completion should announce itself to the workspace.
- **PRD-017 (Bulk Re-Extraction)** — long-running bulk runs should notify the actor (and possibly the workspace) on completion.

Building four bespoke notification surfaces is wasteful and produces an inconsistent UX. This PRD introduces one shared primitive — a workspace notifications table, a service to emit and read them, and a header bell + dropdown UI — that all four (and future) consumers plug into. Sonner stays untouched for transient, in-the-moment feedback; this primitive serves the persistent "you missed something" pattern.

## User Story

> *As a workspace member returning after a few hours away,*
> I want to see what changed in my workspace while I was gone — themes merged, supersession proposals queued, bulk operations completed — without hunting through the app for renamed widgets or stale dashboards.

> *As a workspace admin acting on the dashboard, chat, or settings,*
> I want my actions to communicate themselves to the rest of the workspace without me having to send a message.

> *As a developer adding a new "X happened" event to the platform,*
> I want a single primitive to plug into rather than building a new banner / toast / inbox each time.

## Background

The codebase currently has:

- **Sonner toasts** (`components/ui/sonner.tsx`) for ephemeral, transactional feedback (form errors, save success). These are user-session-scoped and disappear after a few seconds.
- **No notifications table, no notification service, no bell UI, no realtime subscriptions** in application code (Supabase Realtime is installed but unused).

Adding a fourth pattern (banner? domain-specific inbox? per-PRD bespoke surface?) for each new workspace event is what this PRD prevents.

## Constraints & Decisions

1. **Sonner stays for transient feedback.** This PRD does not replace toasts. A user submitting a form still sees a Sonner toast on success or failure. Toasts and persistent notifications coexist.
2. **The primitive is generic; renderers are event-specific.** One bell, one dropdown, one table. Each event type plugs in its own icon, title, and deep-link via a renderer registry. Adding a new event type is a single-file change.
3. **Notification visibility scopes are workspace-broadcast or user-targeted.** Broadcast notifications (e.g., "Theme merged") are visible to every team member. User-targeted notifications (e.g., "Your bulk re-extract finished") are visible only to the actor. Both live in the same table, distinguished by a nullable `user_id`.
4. **Eventual consistency is acceptable; sub-minute delivery is the bar.** Users do not need notifications within milliseconds. The TRD picks between Supabase Realtime, polling, or a hybrid; the PRD requires that idle tabs do not busy-poll and that the bell refreshes on focus.
5. **Notifications are not an audit log.** They are user-facing cues, not compliance records. Retention is short (weeks–months, not forever). A separate admin audit log is out of scope.
6. **No external delivery channels.** Email digests, Slack, browser push, native app push — all backlog. This PRD ships in-app only.
7. **The bell view is user-centric, not workspace-active-centric.** Notifications are scoped by RLS to the user's team memberships, not by the currently-active workspace. The bell shows everything the user has visibility into across every team they belong to, with a workspace label on each row when more than one workspace is in play. The schema remains workspace-aware — `team_id` is load-bearing for RLS, broadcast scoping, and deep-link routing — but the consumer view treats notifications like an inbox addressed to the user, not a per-workspace stream the user has to switch into to discover.

---

## Part 1 — Notification Data Model & Service

The load-bearing foundation. Once this lands, other PRDs can emit events even before the UI is finished.

### Requirements

**P1.R1 — Persistent storage for workspace notifications.**
A new `workspace_notifications` table stores one row per notification with at minimum: `id`, `team_id`, `user_id` (nullable for broadcast), `event_type`, `payload` (jsonb), `read_at` (nullable), `created_at`, `expires_at` (nullable, for explicit retention windows on a per-row basis if needed).

**P1.R2 — Visibility is enforced by RLS.**
A row is visible to a user when (a) `user_id = auth.uid()` (targeted notification), or (b) `user_id IS NULL` AND the user is a member of `team_id` (workspace broadcast). Inserts are gated to the service role — application code emits via the service, not via direct inserts from the client.

**P1.R3 — A notification service exposes the public API.**
A `notification-service` under `lib/services/` provides at minimum: `emit({ teamId, userId?, eventType, payload })`, `listForUser({ userId, includeRead, limit })`, `markRead({ notificationId, userId })`, `markAllRead({ userId, teamId })`, and `unreadCount({ userId, teamId })`. The service is the single entry point — consumers never touch the table directly.

**P1.R4 — Event types are a closed registry.**
Supported event types are defined in code (a typed enum or const map), not free-form strings. Emitting an unregistered event type is rejected at the service layer. This keeps consumer expectations honest — every event type has a known payload shape and a known renderer.

**P1.R5 — Payload shapes are validated.**
Each event type has a payload schema (Zod, per project convention). The service validates payloads at emit time and renderers validate on read. Malformed payloads are rejected with a logged error rather than silently emitted.

**P1.R6 — Service follows logging conventions.**
Every service entry, exit, and error is logged per `CLAUDE.md` conventions (entry context, outcome, elapsed ms, full stack trace on errors).

**P1.R7 — Generated types include the new table.**
After the migration lands, `supabase gen types typescript` is re-run and the output committed. No hand-written types duplicate the schema.

### Acceptance Criteria

- [ ] P1.R1 — Migration creates `workspace_notifications` with all required columns, indexes (at minimum on `team_id, user_id, created_at` for the list query), and RLS policies. Verified by inspecting the migration and the generated types.
- [ ] P1.R2 — Manual SQL probes confirm: a user sees rows targeted to them, broadcast rows for their teams, and nothing else. A user not in a team sees no rows for that team.
- [ ] P1.R3 — All five service methods exist and pass unit-style tests for happy path and at least one error path each.
- [ ] P1.R4 — Emitting an unregistered event type throws a typed error and logs the rejection.
- [ ] P1.R5 — Emitting a payload that fails Zod validation for its event type throws and logs.
- [ ] P1.R6 — Service log entries include entry, outcome, elapsed ms; errors include stack trace.
- [ ] P1.R7 — `database.types.ts` includes `workspace_notifications` after regeneration.

---

## Part 2 — Header Bell UI & Dropdown

The user-facing surface. Without this, Part 1 is invisible.

### Requirements

**P2.R1 — A bell icon lives in the app header.**
The bell is visible on every authenticated route — dashboard, capture, sessions, chat, improvements, settings. Public routes (`/login`, `/signup`, etc.) do not render it.

**P2.R2 — The bell shows an unread count badge.**
The badge displays the count of unread notifications visible to the current user in the active workspace. The displayed value is bounded (e.g., "9+" beyond a threshold) to avoid layout drift. When unread count is zero, no badge renders.

**P2.R3 — Clicking the bell opens a dropdown.**
The dropdown lists recent notifications, most recent first. The default window is bounded by recency and count (e.g., last 30 days, top 50 rows) so the query is cheap. Notifications older than the window are not shown but are not deleted by this part — see Part 5.

**P2.R4 — Each row renders event-specific context.**
Every row shows: an icon for the event type, a one-line title (specific to the event — "Theme 'API Speed' merged into 'API Performance'", not generic "Theme merged"), a relative timestamp ("2 hours ago"), and — if the event has a deep-link — a click target that navigates there.

**P2.R5 — Read and unread states are visually distinct.**
Unread rows have a clear visual indicator (e.g., dot, weight, background tint) using existing global tokens. Read rows render in a quieter style.

**P2.R6 — The dropdown supports "Mark all as read".**
A single action in the dropdown header zeroes the unread badge and marks every visible row read.

**P2.R7 — Clicking a row marks it read and navigates.**
Clicking a row that has a deep-link navigates to it (e.g., `theme.merged` → `/settings/themes`; `supersession.proposed` → `/improvements/inbox`) and marks the row read. Closing the dropdown without clicking a row does not mark anything read.

**P2.R8 — Empty state renders when there is nothing to show.**
"You're all caught up" (or comparable copy) when the dropdown has no rows.

**P2.R9 — UI uses existing design tokens.**
The bell, badge, dropdown, and row styles compose from existing Tailwind tokens and `globals.css` custom properties. No new colours, sizes, or radii are introduced.

**P2.R10 — The bell aggregates across the user's workspaces.**
The bell renders notifications visible to the user across every team they belong to — not just the currently-active workspace. Each row carries a workspace label or badge so the user knows which workspace the event belongs to (the label may be suppressed when the user is in only one workspace, to avoid visual noise). The unread badge counts unread across all workspaces. Clicking a row whose `team_id` differs from the active workspace switches active workspace via the existing `setActiveTeam` flow in `AuthProvider` *before* navigating to the deep-link, so the destination renders in the correct workspace context. "Mark all as read" (P2.R6) operates across all the user's workspaces, not just the active one.

### Acceptance Criteria

- [ ] P2.R1 — Bell visible on every authenticated route; not visible on public routes.
- [ ] P2.R2 — Unread count reflects backend reality (verified by emitting a notification, refreshing, and observing the badge increment).
- [ ] P2.R3 — Dropdown lists recent notifications in correct (most-recent-first) order, bounded by the default window.
- [ ] P2.R4 — Each row shows the correct icon, specific title, relative timestamp, and (where applicable) deep-link target.
- [ ] P2.R5 — Read and unread rows are visually distinguishable.
- [ ] P2.R6 — "Mark all as read" zeroes the badge and updates all rendered rows across every workspace the user belongs to.
- [ ] P2.R7 — Clicking a row navigates to its deep-link and marks the row read; closing the dropdown without clicking does not.
- [ ] P2.R8 — Empty state renders when no notifications exist.
- [ ] P2.R9 — No new design tokens are introduced; visual review confirms consistency with the existing settings / dashboard chrome.
- [ ] P2.R10 — A user in two workspaces with unread notifications in both sees both reflected in the bell badge and dropdown; each row shows its workspace label; clicking a row whose workspace differs from the active one switches active workspace and lands on the correct deep-link.

---

## Part 3 — Event Type Catalogue & Renderers

Each event type needs a renderer. This part wires up the initial set and the extension pattern for future events.

### Requirements

**P3.R1 — A renderer registry maps event types to UI behaviour.**
A `notification-renderers` registry under `lib/notifications/` (or comparable location — TRD pins) maps each registered event type to: an icon component, a title-template function (`(payload) => string`), and a deep-link function (`(payload) => string | null`).

**P3.R2 — The initial event type set covers the immediate consumers.**
Three event types are registered at launch:
- `theme.merged` (PRD-026 P4) — payload includes archived theme name, canonical theme name, actor name.
- `supersession.proposed` (PRD-028 P5) — payload includes the count of proposals deposited and the bulk operation that produced them.
- `bulk_re_extract.completed` (PRD-017 future / stub) — payload includes session count processed and any error count.

If any of these consumer PRDs has not yet shipped, a stub event type is registered and exercised end-to-end so the extension model is proven before its first real consumer needs it.

**P3.R3 — Adding a new event type is a single-file change.**
Adding `event_type = "purge.completed"` requires only: registering the event in the registry, adding its payload Zod schema, and adding its renderer. No changes to the bell, dropdown, table, or service.

**P3.R4 — Unknown event types degrade gracefully.**
If a row's `event_type` has no renderer (e.g., a deploy rolled back the code that registered it but DB rows remain), the dropdown renders a generic icon and a "Workspace activity" fallback title rather than crashing. The fallback case is logged client-side so we notice when it happens.

**P3.R5 — Title templates render specific data.**
Title templates pull values from the payload — the user reading "Theme 'API Speed' merged into 'API Performance'" gets useful information; "Theme merged" does not. Templates are bounded in length (≤ ~80 chars) so they fit in a dropdown row without truncation in typical cases.

### Acceptance Criteria

- [ ] P3.R1 — Registry exists; each registered event type has icon, title template, and deep-link function.
- [ ] P3.R2 — Initial event types are registered. At least one is exercised end-to-end (emit → bell → click → deep-link).
- [ ] P3.R3 — Adding a stub fourth event type requires changes to one new file plus the registry index — no other code changes.
- [ ] P3.R4 — A row with an unregistered `event_type` renders the generic fallback without throwing; the case is logged.
- [ ] P3.R5 — Initial title templates render specific payload data verified against rendered output.

---

## Part 4 — Delivery Mechanism

Notifications must appear without the user manually refreshing. The PRD sets the latency bar; the TRD picks the mechanism.

### Requirements

**P4.R1 — Notifications appear within an acceptable window of being emitted.**
For real-time delivery the bar is "within seconds." For polling-only delivery the bar is "by next bell open or by next polling tick, whichever comes first." A colleague verbally telling another user "I just merged a theme" should not consistently beat the bell by minutes.

**P4.R2 — The TRD picks the mechanism.**
Options on the table: Supabase Realtime subscription on the `workspace_notifications` table, polling on a tab-visibility-aware interval, or a hybrid (realtime when available, polling fallback). The PRD's requirement is that the chosen mechanism is documented, justified, and meets the latency bar in P4.R1.

**P4.R3 — Idle tabs do not drain resources.**
When a tab is hidden (Page Visibility API), polling slows to a low cadence or stops entirely. On focus, the bell catches up. Real-time subscriptions, if used, are also paused or downgraded on hidden tabs at the implementer's discretion.

**P4.R4 — Reconnect & resync.**
If a real-time subscription drops (network blip, server restart), the bell resyncs on the next focus event, the next emit, or via an explicit refresh action. No manual page reload is required to recover.

**P4.R5 — The mechanism does not block the user-perceived UI.**
Subscription setup, polling, and resync all happen in the background. A slow or failing notification mechanism never delays page render or interaction.

### Acceptance Criteria

- [ ] P4.R1 — A notification emitted in one session is visible in another session's bell within the documented window. Verified manually with two browser windows.
- [ ] P4.R2 — TRD documents the chosen mechanism, the rationale, and any fallback.
- [ ] P4.R3 — A hidden tab's network panel does not show per-second polling. Resuming focus produces a refresh.
- [ ] P4.R4 — Manually killing the subscription (or simulating a drop) and emitting a new notification produces correct state on next focus or explicit refresh.
- [ ] P4.R5 — Disabling the notification endpoint server-side does not break page navigation or interaction.

---

## Part 5 — Retention & Cleanup

> **Status:** **Deferred to backlog (2026-04-30).** Parts 1–4 close PRD-029. Cleanup is hygiene, not correctness — the bell remains correct without it (RLS scopes reads, cursor pagination caps queries, Realtime is per-event). At expected emit rates the table grows ~20MB/year; revisit when actual size or query latency starts mattering. The spec below stays for reference when implementation resumes; the per-row `expires_at` column from Part 1 is unused until then.

Notifications are not an audit log. They expire.

### Requirements

**P5.R1 — Old notifications are deleted on a schedule.**
A periodic job deletes notifications older than a configured retention window. The TRD pins exact values; the PRD's requirement is that retention is bounded and configurable.

**P5.R2 — Read and unread retention may differ.**
Read notifications can expire sooner than unread (e.g., read for 30 days → delete; unread → 90 days). The TRD pins values. The intent: unread notifications represent something the user hasn't seen yet and deserve more grace.

**P5.R3 — Cleanup logs its work.**
Each cleanup run logs: rows deleted, age cutoffs applied, run duration. Errors are logged with full context.

**P5.R4 — The dropdown query is bounded regardless of retention.**
Even if retention is generous, the dropdown never queries more than a bounded number of rows (e.g., top 200 most recent for the user) so dropdown latency stays flat as the table grows.

**P5.R5 — Per-row override is supported.**
The `expires_at` column on `workspace_notifications` allows a specific row to be cleaned up sooner than the default policy (e.g., a transient "bulk run started" event that becomes irrelevant once the run completes). Most rows leave it null.

### Acceptance Criteria

- [ ] P5.R1 — Cleanup job runs on its schedule and deletes rows older than the configured cutoff. Verified by inserting old rows and observing deletion.
- [ ] P5.R2 — Read vs unread retention policies both honoured.
- [ ] P5.R3 — Cleanup logs include row counts, cutoff values, and elapsed ms.
- [ ] P5.R4 — Dropdown query plan limits row scan even when the table contains many rows for the user's workspace.
- [ ] P5.R5 — A row with an `expires_at` in the past is cleaned up at the next run regardless of `created_at`.

---

## Backlog

Items intentionally deferred — real follow-ups, not load-bearing on the first ship.

- **Retention & cleanup (originally Part 5).** Deferred 2026-04-30 — cleanup is hygiene, not correctness. The bell stays correct without it; table growth is ~20MB/year at expected scale. Full spec is in the Part 5 section above (and TRD-029 §"Part 5: Retention & Cleanup") for when implementation resumes. Per-row `expires_at` column from Part 1 is unused until then.
- **Email digest.** Daily or weekly summary of unread notifications via email. Useful for users who don't open the app for a few days. Out of scope until in-app delivery proves itself.
- **Per-user notification preferences.** Mute event types ("don't notify me about merges"), mute workspaces, set quiet hours. Build only when users ask.
- **Browser push notifications.** Native browser notifications via the Push API. Opt-in only; needs a service worker. Deferred.
- **Notification grouping.** "3 themes merged in the last hour" instead of three separate rows. Useful when event volumes climb; not a problem today.
- **@mentions and direct user-to-user notifications.** Different product shape (social, not workspace-event). Out of scope for this primitive.
- **Snooze / remind-me-later.** "Show this again in 4 hours." Useful but not foundational.
- **Read receipts on broadcast notifications.** "12 of 15 team members have seen this." Out of scope.

---

## Non-Goals

- **Replacing Sonner toasts.** Transient in-the-moment feedback (form errors, save success) stays with Sonner. This PRD adds a parallel surface, not a replacement.
- **Comprehensive admin audit log.** A compliance-grade record of who did what across the workspace is a different surface (admin-only, retention-heavy, often append-only). Notifications are short-lived user cues.
- **External delivery channels.** Email, Slack, MS Teams, browser push, mobile push — all backlog. In-app only for V1.
- **Inbox-style triage features** (snooze, archive, priority sort, search). The dropdown is a glance surface, not an email client. Domain-specific inboxes (PRD-028 supersession inbox) handle deeper triage in their own surfaces.
