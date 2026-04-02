# PRD-006: Master Signal Cleanup on Session Deletion

> **Status:** Implemented — Part 1 complete (2026-03-30)
> **Section:** 006-master-signal-cleanup
> **Master PRD ref:** Section 3 (Synthesis Dashboard) — integrity fix
> **Depends on:** PRD-004 (Master Signal View)

---

## Purpose

When a session is deleted, its extracted signals remain baked into the current master signal. The incremental generation flow compounds this problem: it takes the existing master signal (which already contains the deleted session's signals) and merges new sessions on top, so the deleted session's data persists indefinitely.

This means the master signal can present insights, themes, and patterns derived from sessions that no longer exist — misleading users who rely on it for cross-client analysis.

This PRD introduces a mechanism to detect when a session deletion has tainted the master signal and automatically force a full regeneration (cold-start) on the next generate action, ensuring only live sessions contribute to the output.

---

## User Story

As a sales or account team member, I want the master signal to automatically reflect session deletions, so that when I remove a session, its signals don't continue to appear in the master signal and mislead my cross-client analysis.

---

## Part 1: Tainted Flag and Auto Cold-Start Regeneration

### Requirements

**P1.R1 — Track tainted state on the master signal.**
When a session is soft-deleted, the system marks the current master signal as "tainted." This is a persistent flag (not computed at query time) so that the system knows a deletion occurred even if subsequent sessions are added or updated. The flag indicates: "this master signal contains data from at least one session that has since been deleted."

**P1.R2 — Set tainted flag during session deletion.**
The session deletion flow (soft-delete in `deleteSession`) must, after successfully soft-deleting the session, check whether a master signal exists and mark it as tainted. This happens server-side in the service layer — no additional user action required. If no master signal exists, no action is needed.

**P1.R3 — Only taint if the deleted session contributed signals.**
The tainted flag should only be set if the deleted session had non-null `structured_notes` (i.e., it actually contributed signals). Deleting a session that was never signal-extracted should not taint the master signal.

**P1.R4 — Force cold-start when tainted.**
When the user clicks "Generate Master Signal" and the current master signal is tainted, the system must use the **cold-start path** (fetch all remaining active sessions, ignore the previous master signal content) instead of the incremental path. This ensures the deleted session's signals are fully purged from the output.

**P1.R5 — Clear tainted flag after successful regeneration.**
After a successful cold-start regeneration triggered by a tainted state, the newly saved master signal must not carry the tainted flag. The flag is only set by session deletions and cleared by regeneration.

**P1.R6 — Staleness banner update for deletions.**
The existing staleness banner (amber, "X new/updated sessions since last generation") must be updated to also reflect the tainted state. When the master signal is tainted, show a distinct message:
- Text: "A session with extracted signals was deleted — regenerate to remove its data from the master signal."
- This message takes priority over the standard staleness message when both conditions are true (tainted + new sessions exist). Both facts can be combined into a single banner if desired.
- Visual treatment: use the existing amber banner style for consistency.

**P1.R7 — Multiple deletions before regeneration.**
If multiple sessions are deleted before the user regenerates, the tainted flag remains set (it's idempotent — already tainted stays tainted). The cold-start regeneration processes all remaining active sessions regardless of how many were deleted.

**P1.R8 — No auto-regeneration.**
Deleting a session does NOT automatically trigger a master signal regeneration. It only sets the tainted flag and updates the staleness banner. The user decides when to regenerate. This avoids unexpected Claude API costs and latency.

**P1.R9 — Settings tab reflects tainted state for prompt selection.**
The Settings page currently shows either the cold-start or incremental master signal prompt based on whether a master signal exists. When the master signal is tainted, the Settings page must show the **cold-start prompt** for the Master Signal tab — because that is the prompt that will be used on the next generation. This ensures admins can review and edit the correct prompt before regeneration. Once the master signal is regenerated (tainted flag cleared), the Settings page reverts to showing the incremental prompt as before.

### Acceptance Criteria

- [ ] Deleting a session with `structured_notes` marks the current master signal as tainted
- [ ] Deleting a session without `structured_notes` does not taint the master signal
- [ ] The staleness banner shows a deletion-specific message when the master signal is tainted
- [ ] Clicking "Generate Master Signal" when tainted triggers a cold-start (all active sessions), not incremental
- [ ] The newly generated master signal after a tainted cold-start is not tainted
- [ ] Multiple deletions before regeneration are handled correctly (flag stays set, cold-start processes all remaining)
- [ ] No automatic regeneration occurs on session deletion
- [ ] Existing staleness behaviour (new/updated sessions) continues to work alongside tainted state
- [ ] Settings page shows the cold-start master signal prompt when the master signal is tainted
- [ ] Settings page reverts to the incremental prompt after a successful regeneration clears the tainted flag

---

## Backlog

- Granular signal removal: instead of full cold-start, use Claude to surgically remove only the deleted session's signals from the existing master signal (cheaper but harder to verify completeness)
- Undo session deletion: allow restoring a soft-deleted session and re-tainting the master signal if it was regenerated without that session
- Deletion audit trail: log which sessions were deleted and when, visible in the master signal generation history
- Batch operations: "delete all sessions for client X" with a single taint action
