# PRD-024: Multi-Stream Chat Architecture

## Purpose

Today, chat streaming state lives inside a single instance of `useChat` mounted on the chat page. Three product limitations follow from this shape:

1. **Only one stream can be in flight per browser tab.** The chat-input is gated by a single global `streamState`; while a response is generating in any conversation, the user cannot start a new send anywhere. There is no way to fire a slow research query in one conversation and keep working in another.
2. **Switching conversations mid-stream causes UI bleed.** The streaming bubble — and the final assistant-message append — render against whichever conversation the user is currently viewing, even when the stream belongs to a different conversation. The bug is purely client-side (the server persists each message to the correct conversation regardless), but it produces ghost messages that disappear on the next refetch.
3. **Navigating away from `/chat` abandons the client-side stream entirely.** Even though the server completes and persists the response, the user loses the live stream view the moment they leave `/chat`. There is no surface anywhere else in the product that signals "a response is being generated" or that lets the user return to it.

This PRD lifts streaming state out of the chat-page hook into an app-root streaming context keyed by conversation ID. The result is per-conversation streaming with no UI bleed, multi-conversation streaming as a first-class capability, and stream survival across in-app navigation. The `useChat` decomposition originally scoped as Part 4 of PRD-023 is subsumed into this rework — the cleanup goal is delivered as a side-effect of the architectural lift.

## User Story

**As a user**, I want to:

- Start a slow query in one conversation, switch to another conversation to handle a quick task, and come back to find my response either still streaming live or completed — without losing my place or seeing UI artefacts in the conversation I switched to.
- Have multiple conversations streaming in parallel, so I'm not blocked behind one slow response when I have unrelated work to do in another conversation.
- See at a glance which conversations are currently generating responses, so I know where to look when a stream completes.
- Be alerted when a backgrounded response has completed — even from outside `/chat` — so I don't miss it.
- Navigate away from the chat surface (to the dashboard, capture, etc.) while a response is being generated, and find that response present and complete when I return.

**As a developer**, I want streaming state to live in one well-scoped place — outside the per-page hook — so the central chat hook is small, conversation-scoped, and free of streaming concerns. SSE consumption, abort handling, and stream-to-message-list reconciliation should all live in a single owner module that consumers subscribe to.

---

## Part 1 — Streaming Context Foundation

**Severity:** High — establishes the new architecture. All later parts depend on this shape.

### Requirements

**P1.R1 — A single streaming context owns all stream state.**
Streaming state — content being accumulated, state machine (idle/streaming/error), status text, sources, follow-ups, abort handle, assistant message ID, and any partial accumulators — lives in one application-scoped context. Streaming state is keyed by conversation ID; there is no shared "global" streaming bag. Multiple conversations may have independent slices simultaneously.

**P1.R2 — The context exposes a stable, conversation-scoped consumer surface.**
Components subscribe to the slice for a single conversation ID and receive only that conversation's streaming state. A separate subscription exposes the set of conversation IDs currently streaming (for sidebar indicators and global gates). Components subscribed to conversation A do not re-render on deltas from conversation B.

**P1.R3 — The context exposes start, cancel, and lookup primitives.**
Starting a stream is a context method that takes a conversation ID and the user message. Cancelling a stream is a context method that takes a conversation ID and aborts only that stream. Querying "is this conversation currently streaming" is a context lookup. The context owns the SSE loop, the abort controller, and all state writes.

**P1.R4 — The context lives at app root.**
The streaming context is mounted in the app's root (authenticated) layout, not in the chat page. Streams started on `/chat/<id>` survive navigation between authenticated pages within the same session. Sign-out tears the context down.

**P1.R5 — The chat page continues to function unchanged behaviorally during this part.**
With Part 1 alone, the chat page still works as it does today. Part 1 is scaffolding: the context exists, but `useChat` and its consumers continue to function via the legacy in-hook path. Migration happens in Part 2.

### Acceptance Criteria

- [ ] P1.R1 — A single streaming-context module exists and owns all streaming state, keyed by conversation ID.
- [ ] P1.R2 — Per-conversation subscription and active-streams subscription both work; selective re-rendering is verified manually (deltas in A do not re-render a chat-area subscribed to B).
- [ ] P1.R3 — Start, cancel, and lookup methods exist and are typed.
- [ ] P1.R4 — Streams started before navigating to a non-chat page do not throw or get torn down on navigation; they continue running in the background.
- [ ] P1.R5 — Chat page (with the legacy hook still in place) functions identically to pre-PRD behavior.

---

## Part 2 — `useChat` Migration

**Severity:** High — the central chat hook changes shape. All chat-surface components (chat-area, message thread, chat-input) will read streaming state via `useChat`'s passthrough from the new context.

### Requirements

**P2.R1 — `useChat` reads streaming state from the context.**
`useChat`'s streaming fields (`streamingContent`, `streamState`, `statusText`, `latestSources`, `latestFollowUps`, `error`) are sourced from the streaming context's slice for the active conversation ID. The hook no longer owns streaming state internally.

**P2.R2 — `useChat`'s send/cancel/retry call the context.**
`sendMessage`, `cancelStream`, and `retryLastMessage` delegate to context methods. The hook supplies the conversation ID; the context owns the SSE loop, the abort controller, and state writes.

**P2.R3 — `useChat` retains its message-list role.**
Loading messages on conversation change, paginating older messages via `fetchMoreMessages`, merging the final assistant message into the message list on stream completion, and exposing `clearMessages` and `isConversationNotFound` remain `useChat`'s responsibility.

**P2.R4 — The pre-existing UI-bleed bug does not exist after this part.**
Switching from conversation A to B mid-stream produces no streaming bubble in B and no final assistant message in B. Each conversation's streaming UI is bound to its own slice; switching the displayed conversation simply switches which slice the chat-area is reading from. This requirement is a behavioral correction, not a preservation.

**P2.R5 — The consumer-facing passthrough surface of `useChat` is preserved.**
Chat-surface components that consume `useChat` (chat-area, message-thread, chat-input, etc.) compile and run with no changes to the field names or types they read. Internal-only details of `useChat` may change freely; the passthrough surface they depend on does not.

**P2.R6 — Cancellation, retry, and conversation switching behave correctly.**
Aborting a stream mid-response cancels only that conversation's stream and preserves partial content under status `cancelled`. Retrying a failed message replays through the context. Switching conversations during a stream displays the destination conversation's slice (which may be empty, may be streaming, or may be completed); the source conversation's stream continues independently in the background.

**P2.R7 — Stream completion produces no visible flicker on the active conversation.**
When the active conversation's stream transitions from streaming to idle, the swap from the live streaming bubble to the final persisted assistant message happens in a single render commit. There is no intermediate state where neither is visible.

### Acceptance Criteria

- [ ] P2.R1 — `lib/hooks/use-chat.ts` has no internal streaming state; all streaming fields come from the context.
- [ ] P2.R2 — `useChat` does not contain the SSE loop, the abort controller, or the streaming state machine.
- [ ] P2.R3 — Message-list functionality (load, paginate, append on completion, clear, not-found) lives in `useChat`.
- [ ] P2.R4 — Manual reproduction of the pre-existing bleed bug — send in A, switch to B mid-stream — produces no bubble or message in B; the message appears in A on return.
- [ ] P2.R5 — Chat-surface components compile and run; the streaming-related fields they consume have unchanged names and types.
- [ ] P2.R6 — Manual smoke test: send + abort + retry + cross-conversation switch all behave coherently.
- [ ] P2.R7 — Manual test: complete a stream while viewing the active conversation — the streaming bubble disappears and the final message appears in the same frame; no gap, no flicker.

---

## Part 3 — Multi-Conversation Streaming

**Severity:** High — feature change. Multiple conversations may stream concurrently, and the chat-input's disable rule changes from "any stream active" to "this conversation streaming."

### Requirements

**P3.R1 — The chat-input is gated per conversation.**
The Send button is disabled only when *this* conversation has an active stream. Other conversations' streams do not block Send. The button transitions to a Stop button when this conversation is streaming.

**P3.R2 — Multiple streams may run in parallel.**
A user may start a stream in conversation A, switch to conversation B, send a message in B, and have both streams running concurrently. Each stream has its own abort controller; cancelling one does not affect the other. Each stream persists its assistant message to its own conversation server-side.

**P3.R3 — A soft concurrency cap is enforced.**
A maximum of **5 concurrent streams per user** is enforced client-side. Attempting to start a stream while at the cap surfaces an inline blocking message rendered above the disabled Send button: *"Already running 5 chats — wait until one of them completes before starting another."* The Send button remains disabled with this hint until a slot frees up. The cap is a single source-controlled constant.

**P3.R4 — Stream completion is decoupled from active conversation.**
A stream that completes while the user is viewing a different conversation persists its assistant message to the source conversation correctly. When the user navigates back to the source conversation, the completed message is present.

**P3.R5 — Cancellation is per-stream.**
The Stop button on conversation A's chat-input cancels only A's stream. Conversation B's stream — if running — continues unaffected. Cancellation preserves partial content as a `cancelled` message in the originating conversation.

### Acceptance Criteria

- [ ] P3.R1 — Send is disabled and becomes Stop only on the conversation whose stream is active. Other conversations remain sendable.
- [ ] P3.R2 — Two streams run in parallel: each emits deltas independently; the chat-area shows the correct stream when displayed; both messages are persisted to the correct conversations.
- [ ] P3.R3 — Hitting the 5-stream cap surfaces the locked inline message above Send; Send remains disabled until a slot frees up.
- [ ] P3.R4 — A stream completed while the user was viewing a different conversation produces a message visible on return — verified via DB inspection and navigation.
- [ ] P3.R5 — Cancelling A while B is also streaming leaves B alive; A's partial content is preserved as a cancelled message.

---

## Part 4 — Sidebar Streaming Indicators

**Severity:** Medium — the UX surface that makes multi-stream legible. Without it, users have no signal that a stream is alive in a conversation they're not viewing, and no signal that a backgrounded stream has completed and is waiting to be read.

### Requirements

**P4.R1 — Streaming conversations show a pulsating indicator on their sidebar entry.**
Each conversation entry in the conversations sidebar carries a small **pulsating brand-accent dot** when that conversation has an active stream. The dot appears immediately on stream start.

**P4.R2 — Completed-but-unseen responses show a solid indicator until viewed.**
When a stream reaches a terminal state (completed, cancelled, or errored with content persisted) while the user is not viewing that conversation, the conversation entry's pulsating dot transitions to a **solid brand-accent dot**. The solid dot persists until the user opens that conversation, at which point it clears. Streams that reach a terminal state while the user *is* viewing the conversation do not produce a solid dot — the message swap (per P2.R7) is the user's signal.

**P4.R3 — Indicators are consistent across active and archived lists.**
The sidebar's grouped lists (active, archived) both honor pulsating and solid indicators if a streaming or unseen-completed conversation appears in either group.

**P4.R4 — The conversations sidebar footer reflects aggregate streaming status.**
A footer line in the conversations sidebar shows *"N chats are streaming"* when one or more of the current user's streams are active in the current workspace, and *"Start a conversation"* otherwise. The text updates reactively as streams start and complete. Singular form (*"1 chat is streaming"*) is used for N=1.

**P4.R5 — Indicators are keyboard- and screen-reader-accessible.**
Users navigating by keyboard or with assistive tech are informed of streaming and unseen-completed states — for instance, via an extended `aria-label` or a visually-hidden status element. Pure visual cues are not the only signal.

**P4.R6 — Clicking a streaming or unseen-completed conversation entry behaves identically to clicking any other entry.**
Selection navigates to the conversation; the chat-area then displays the streaming slice (live bubble + Stop button if mid-stream) or the persisted message (if completed). The unseen-solid dot clears on selection.

### Acceptance Criteria

- [ ] P4.R1 — Pulsating brand-accent dot appears next to streaming conversations and clears (or transitions to solid per P4.R2) on terminal state.
- [ ] P4.R2 — Solid brand-accent dot appears on terminal state when the viewer is not on that conversation, persists across in-app navigation until the conversation is opened, then clears.
- [ ] P4.R3 — Indicators work in both active and archived sidebar groups.
- [ ] P4.R4 — Footer text toggles between *"N chats are streaming"* (with correct singular/plural) and *"Start a conversation"* based on aggregate streaming state in the current workspace.
- [ ] P4.R5 — Screen-reader test exposes streaming and unseen-completed states for affected entries.
- [ ] P4.R6 — Click-to-navigate to a streaming or unseen entry shows the live stream (or persisted message); cancellation and indicator-clear behave correctly from the destination.

---

## Part 5 — Cross-Page Stream Survival

**Severity:** Medium — leverages the app-root context placement from Part 1 to deliver a UX that was impossible before.

### Requirements

**P5.R1 — Streams survive in-app navigation.**
A stream started on `/chat/<id>` continues running when the user navigates to `/dashboard`, `/capture`, or any other authenticated page. On return to the originating conversation, the stream is either still streaming (live bubble + Stop button) or completed (assistant message present).

**P5.R2 — The AppSidebar chat icon reflects global streaming and unseen-completed state.**
On every authenticated page (chat and non-chat), the Chat nav icon in the AppSidebar carries a brand-accent dot:
- **Pulsating** when one or more of the current user's streams are active in the current workspace.
- **Solid** when no streams are active but one or more conversations have unseen completed responses in the current workspace.
- **No dot** when neither condition holds.

Clicking the Chat icon navigates to `/chat` per existing behavior; the user then resolves which conversation to open via the per-conversation indicators (Part 4). The AppSidebar dot is the off-chat in-flight surface — its presence guarantees the user is never unaware that a stream is alive or that a backgrounded response is waiting.

**P5.R3 — Streams do not survive a hard refresh or sign-out.**
A browser refresh or sign-out cancels all client-side streams. The server may still complete and persist them; the client simply re-fetches on next load. No client-side resume from a still-running server stream is in scope for this PRD.

**P5.R4 — Streams do not leak across users on the same browser.**
If user A signs out and user B signs in on the same browser session, no stream from A is visible or controllable by B. The streaming context is cleared on sign-out alongside the existing auth/team-cookie cleanup.

**P5.R5 — Workspace switch isolates UI state without aborting streams.**
Switching the active workspace via the workspace switcher does not abort in-flight streams. Each slice in the streaming context is keyed by `team_id` (NULL = personal). Sidebar streaming indicators (Part 4) and the AppSidebar chat icon dot only reflect slices belonging to the *current* workspace. Cross-workspace slices continue to run server-side; their indicators re-surface when the user switches back to the originating workspace. No streaming, message, or indicator data leaks across workspaces in any UI surface.

### Acceptance Criteria

- [ ] P5.R1 — Manual test: start a stream on `/chat/<id>`, navigate to `/dashboard`, return — assistant message is present (or stream still live, depending on timing).
- [ ] P5.R2 — AppSidebar chat icon dot is visible and accurate on every authenticated page: pulsating during active streams, solid when only unseen-completed responses exist, absent when neither.
- [ ] P5.R3 — Refresh during a stream produces no client-side stream after reload; the persisted message (if completed server-side) appears on next chat load.
- [ ] P5.R4 — Sign-out clears all streaming slices; the next user sees no residual state.
- [ ] P5.R5 — Manual test: start a stream in personal workspace, switch to a team workspace — all streaming indicators clear; switch back — indicators reflect the still-running or unseen-completed state correctly. No cross-workspace bleed in any indicator surface.

---

## Part 6 — `useChat` Cleanup (subsumes PRD-023 P4)

**Severity:** Medium — closes out the cleanup intent of PRD-023 P4, made trivial by the migration in Part 2.

### Requirements

**P6.R1 — `useChat` is concise.**
After the migration in Part 2 and the per-conversation gating in Part 3, `useChat` no longer carries streaming refs, abort controllers, SSE loops, or state machines. It is a focused message-list hook: load on conversation change, paginate older messages, append the final message on stream completion, expose the not-found state, and expose `clearMessages` for in-app navigation.

**P6.R2 — SSE parsing and follow-up extraction live in one place.**
The SSE chunk parser, the follow-up comment regex, and the strip helper exist in shared utility modules owned by the streaming context. The server-side stream service (`chat-stream-service.ts`) imports the same utilities. The patterns appear in exactly one source file.

**P6.R3 — Dead code from the legacy hook is removed.**
References, helpers, types, and refs that supported the in-hook streaming model are deleted, not commented out. No "just in case" residual exports.

**P6.R4 — `useChat` (or its successor name) is under 200 LOC.**
The size goal originally scoped under PRD-023 P4.R1 is met as a side-effect of the migration.

### Acceptance Criteria

- [ ] P6.R1 — `lib/hooks/use-chat.ts` has no streaming-related internals.
- [ ] P6.R2 — A repo-wide grep for the follow-up regex pattern returns hits in exactly one source module.
- [ ] P6.R3 — No dead imports, helpers, or refs remain in the hook.
- [ ] P6.R4 — `lib/hooks/use-chat.ts` (or successor) is under 200 LOC.

---

## Part 7 — Documentation

**Severity:** Low — pure documentation. Runs last so it reflects the post-implementation state.

### Requirements

**P7.R1 — `ARCHITECTURE.md` describes the streaming context.**
A section documents: the streaming context's role and placement, the per-conversation slice model, the multi-stream concurrency cap, the cross-page survival behavior, and how `useChat` consumes the context.

**P7.R2 — `ARCHITECTURE.md` file map includes the new modules.**
Every file introduced by Parts 1–6 is added to the file map. Removed files (any legacy `useChat` internals split out as separate modules) are reflected.

**P7.R3 — `ARCHITECTURE.md` Key Design Decisions has an entry for the streaming-context choice.**
A new decision entry documents: why streaming state was lifted out of `useChat` (per-conversation slices, multi-stream support, bug elimination), why it sits at app root (cross-page survival), and the chosen concurrency cap.

**P7.R4 — `CHANGELOG.md` has an entry per completed part.**
Each of Parts 1–6 lands a dated entry summarizing what shipped (e.g., "PRD-024 P3: enable multiple concurrent chat streams per user").

**P7.R5 — The PRD-023 P4 deferral note is reconciled.**
PRD-023 already marks Part 4 as deferred to PRD-024. After PRD-024 ships, the PRD-023 deferral block may optionally point at the specific PRD-024 parts that delivered the work. No code references to "PRD-023 P4" remain in the codebase or docs.

### Acceptance Criteria

- [ ] P7.R1 — `ARCHITECTURE.md` has documentation for the streaming context.
- [ ] P7.R2 — File map walk against the actual filesystem produces zero diffs.
- [ ] P7.R3 — Key Design Decisions includes the streaming-context entry.
- [ ] P7.R4 — `CHANGELOG.md` has dated entries for Parts 1–6.
- [ ] P7.R5 — A grep for "PRD-023 P4" or equivalent references returns no code-level hits.

---

## Backlog

Items deferred from this PRD — each is a real enhancement but lower leverage than the work above. They can be picked up as standalone follow-ups.

- **Cancel-all from the global in-flight surface.** A single button to cancel every in-flight stream. Rare use case; can be a follow-up.
- **Toast or push notification when a background stream completes.** While the user is on `/dashboard` or off-chat, a transient surface announces "Response in <conversation> ready." Useful for slow queries; deferred to keep the initial scope tight.
- **Per-stream queueing when at cap.** Today's behavior at cap is "block until one finishes." A queue would let the user fire-and-forget and have streams start as slots free. Lower priority — the cap is generous.
- **Server-side stream resume on reload.** If a user hard-refreshes mid-stream, the client doesn't reattach to the still-running server stream — it just sees the persisted state on next load. A reattach mechanism (server keeps the SSE alive briefly for client reconnect) would be a separate workstream.
- **Mobile-specific UX.** The sidebar streaming indicator and global in-flight surface are designed desktop-first. A mobile-tailored treatment (e.g., a system-tray-style indicator) is a follow-up.
- **Per-conversation rate limit / cooldown.** Today, a user could spam Send in a conversation as soon as one stream finishes. A small per-conversation cooldown after a stream ends would prevent accidental double-sends.
