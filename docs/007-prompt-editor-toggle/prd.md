# PRD-007: Prompt Editor — View Alternate Master Signal Prompt

> **Status:** Implemented — Part 1 complete (2026-03-30)
> **Section:** 007-prompt-editor-toggle
> **Master PRD ref:** Section 3 (Synthesis Dashboard) — UX enhancement
> **Depends on:** PRD-005 (System Prompt Editor), PRD-006 (Master Signal Cleanup)

---

## Purpose

The Settings page currently auto-selects which master signal prompt to show (cold-start or incremental) based on app state. The admin edits one prompt at a time but has no visibility into the *other* prompt — they may not even know it exists.

This creates two problems:
1. An admin editing the incremental prompt has no way to check what the cold-start prompt says (and vice versa) without deleting a session or wiping the master signal to force the system to switch.
2. There's no explanation of *why* a particular prompt is showing or *when* each prompt is used, making the system feel opaque.

This PRD adds a contextual note above the editor explaining which prompt is active and when it's used, plus a small inline toggle to view and edit the alternate prompt — all within the existing single "Master Signal" tab, no new tabs.

---

## User Story

As an admin editing AI prompts, I want to understand which master signal prompt I'm editing and why, and I want to quickly switch to the alternate prompt without leaving the tab, so that I can keep both prompts aligned and understand the system's behaviour.

---

## Part 1: Contextual Note and Inline Prompt Toggle

### Requirements

**P1.R1 — Contextual note above the editor.**
When the Master Signal tab is active, show a short informational note between the tab bar and the editor textarea. The note explains which prompt variant is currently loaded and when it's used:

- **When showing the incremental prompt:** "Editing the **incremental** prompt — used when updating an existing master signal with new sessions."
- **When showing the cold-start prompt:** "Editing the **cold-start** prompt — used when no master signal exists yet or after a session with signals is deleted."

The note should be visually subtle (small text, muted colour, info-style) so it doesn't dominate the editor UI.

**P1.R2 — Toggle link to view the alternate prompt.**
Below or alongside the contextual note, show a small text link/button to switch to the other prompt variant:

- When viewing the incremental prompt: "View cold-start prompt" link
- When viewing the cold-start prompt: "View incremental prompt" link

Clicking the link switches the editor to load and display the alternate prompt. The contextual note updates to reflect the newly loaded prompt.

**P1.R3 — Toggle respects dirty state.**
If the admin has unsaved changes when clicking the toggle link, show the existing unsaved changes confirmation dialog (same as the tab-switch guard). If they discard, the alternate prompt loads. If they stay, the toggle is cancelled.

**P1.R4 — Both prompts are fully editable.**
The toggle is not read-only. When the admin switches to the alternate prompt, they can edit, save, reset to default, view version history, and revert — exactly the same as the auto-selected prompt. The toggle simply changes which `promptKey` is active in the editor.

**P1.R5 — Active prompt is visually indicated.**
The currently auto-selected prompt (the one the system will actually use on the next generation) should have a small visual indicator distinguishing it from the alternate. For example, a subtle badge or label like "(active)" next to the prompt name in the contextual note. This helps the admin understand which prompt matters *right now* vs. which one they're just reviewing.

**P1.R6 — No note on the Signal Extraction tab.**
The contextual note and toggle only appear on the Master Signal tab. Signal Extraction has only one prompt — no toggle or explanation needed.

### Acceptance Criteria

- [ ] Master Signal tab shows a contextual note explaining which prompt variant is being edited and when it's used
- [ ] A toggle link below the note allows switching to the alternate prompt variant
- [ ] Switching with unsaved changes triggers the existing discard confirmation dialog
- [ ] Both prompt variants are fully editable (save, reset, version history, revert)
- [ ] The auto-selected prompt (based on app state) is marked as "(active)"
- [ ] Signal Extraction tab does not show any note or toggle
- [ ] Toggling updates the contextual note, editor content, and version history to match the newly selected prompt

---

## Backlog

- Side-by-side diff view: show both prompts simultaneously so the admin can compare them without toggling
- Prompt sync helper: highlight differences between cold-start and incremental prompts to help keep shared sections aligned
- Prompt testing sandbox: allow the admin to test a prompt against sample session data before saving
