# TRD-031: Workflow Improvements

> **Status:** Part 1 in progress
>
> Mirrors **PRD-031**. Each part maps to the corresponding PRD part. **Part 1** (Drop Markdown Extraction) is detailed below. **Part 2** (Positive Signal Chunk Type and Hide-Empty Sections) and **Part 3** (Looser Chat Response Limits) are stubbed and will be filled in once their respective PRD parts begin implementation. Per the project rule that each TRD part references the entire PRD, forward-compatibility constraints from Parts 2 and 3 are noted in Part 1 where relevant (e.g., the chunking pipeline that survives Part 1 must remain trivially extensible to a tenth chunk type in Part 2).

---

## Part 1: Drop Markdown Extraction

> Implements **P1.R1–P1.R6** from PRD-031.

### Overview

Today every signal extraction does two things that produce equivalent data: it returns a typed JSON object via `generateObject()` against `extractionSchema`, and it derives a markdown rendering of that JSON via `renderExtractedSignalsToMarkdown()`. Both are persisted to the `sessions` row (`structured_json` JSONB and `structured_notes` TEXT). The capture UI, embeddings, themes, dashboard, drill-down, and chat citations all read from `structured_json`. The only surface that still consumes `structured_notes` is the master-signal backend (retired UI per ARCHITECTURE.md Decision 17, but the backend is wired and the master-signal prompt embeds `session.structuredNotes` directly into its user message).

The change is to stop generating and persisting markdown on extraction, while preserving the master-signal backend's ability to operate over both new sessions (only `structured_json`) and pre-PRD-018 legacy sessions (only `structured_notes`). The DB column `sessions.structured_notes` is retained as-is — its hard-delete is parked in the PRD backlog. The derived markdown helper (`renderExtractedSignalsToMarkdown`) is also retained — it becomes a *consumed-on-demand* helper at the master-signal site instead of a pre-persisted output.

The user-perceived flow is unchanged (P1.R5): the capture page already renders from JSON via `StructuredSignalView`, the past-sessions row, the drill-down dialog, and chat citations all read JSON. No UI components change behaviour.

The core risk of this part is **breaking the master-signal backend on the first extraction after deploy** (a session would have `structured_json` populated but `structured_notes = null`, and the master-signal repository today filters with `.not("structured_notes", "is", null)`). The implementation order eliminates that risk by migrating the master-signal repository *before* the extraction stops writing markdown.

### Dependencies (npm)

None. No new packages, no version bumps.

### Database Changes

**None.** The `sessions.structured_notes` column is retained, untouched, with all its existing indexes, RLS policies, and constraints. New rows will simply have `structured_notes = NULL` from the moment Part 1 ships. Hard-deletion of the column is in the PRD-031 backlog and requires a follow-up migration once the master-signal backend is itself retired or migrated to render markdown on demand for every consumer.

### API Endpoints

**Modified — request and response shapes only, no route additions or removals.**

| Method | Route | Change |
|--------|-------|--------|
| POST | `/api/ai/extract-signals` | Response body: drop `structuredNotes` field. Returns `{ structuredJson, promptVersionId }` only. |
| POST | `/api/sessions` | Request body: `structuredNotes` field becomes optional and is ignored when `isExtraction === true`. The route persists `null` for `structured_notes` on extraction. The field is still accepted on non-extraction paths so legacy markdown-edit fallback continues to work for pre-PRD-018 sessions. |
| PUT | `/api/sessions/[id]` | Same change as POST `/api/sessions`. |
| GET | `/api/master-signal` | No external change. Internally, the repository now reads `structured_json` first and falls back to `structured_notes` for legacy rows. |

### Design Token Changes

None.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/repositories/master-signal-repository.ts` | **Modify** | Extend the `MasterSignalSessionRow` shape returned by `getAllSignalSessions()` and `getSignalSessionsSince()` to include `structured_json`. Update the staleness count contract to "has `structured_json` OR `structured_notes`." |
| `lib/repositories/supabase/supabase-master-signal-repository.ts` | **Modify** | Update SELECT lists and filter predicates: `.select("id, session_date, structured_notes, structured_json, updated_at, clients(name)")` and replace `.not("structured_notes", "is", null)` with `or("structured_notes.not.is.null,structured_json.not.is.null")`. Update `mapRow` to compose `structuredNotes`: prefer `renderExtractedSignalsToMarkdown(structured_json)` when JSON is present, fall back to `structured_notes` for legacy rows, and surface an empty string only if both are null (filter should prevent this case from reaching `mapRow`). |
| `lib/services/ai-service.ts` | **Modify** | Drop `structuredNotes` field from `ExtractionResult`. Remove the `renderExtractedSignalsToMarkdown(structuredJson)` call in `extractSignals()`. Remove the `import { renderExtractedSignalsToMarkdown }` line. Add a one-line log of token usage (input + output) per extraction so we can measure the saving in production. |
| `lib/utils/render-extracted-signals-to-markdown.ts` | **Keep, no changes** | Still consumed by the master-signal repository's `mapRow` for legacy-row composition. The header comment is updated to reflect the new sole consumer; no behaviour change. |
| `app/api/ai/extract-signals/route.ts` | **Modify** | Drop `structuredNotes` from the response object. Update the route's exit log line to reflect the new response shape. |
| `app/api/sessions/route.ts` | **Modify** | When `isExtraction === true`, force `structured_notes = null` in the create payload regardless of what the body sent. When `isExtraction === false`, preserve current behaviour (manual edits to legacy markdown still flow through). |
| `app/api/sessions/[id]/route.ts` | **Modify** | Same `isExtraction` handling as POST `/api/sessions`. The PUT route already passes `structuredNotes` through `parsed.data.structuredNotes` to `updateSession()`; the new logic short-circuits that to `null` on extraction. |
| `lib/services/session-service.ts` | **Modify** | Inside `updateSession()`, the `if (isExtraction)` branch (lines ~272–277) explicitly sets the eventual repository payload's `structured_notes` to `null` rather than letting the caller-supplied value pass through. The `structuredNotesEdited` flag continues to be reset to `false` on extraction (no change). The "manual markdown edit" branch (`else if (structuredNotes !== undefined)`) is left intact for legacy-session compatibility. |
| `lib/hooks/use-signal-extraction.ts` | **Modify** | Drop `structuredNotes` and `lastExtractedNotes` state. Drop `setStructuredNotes`, `isStructuredDirty`, and the dirty-on-extract confirmation path *that depends on markdown content*. Replace dirty-tracking with a `lastExtractedJson` reference (deep-equal check against `structuredJson`) so the re-extract confirmation still fires correctly when the user has manually edited the JSON. The hook continues to expose `structuredJson` and `promptVersionId` for the form. |
| `app/capture/_components/structured-notes-panel.tsx` | **Modify** | Branch: if `structured_json` is present (which is now true for every post-Part-1 session), render `StructuredSignalView` (no markdown edit toggle). The `MarkdownPanel` fallback is preserved for legacy sessions where `structured_json IS NULL AND structured_notes IS NOT NULL`. |
| `app/capture/_components/session-capture-form.tsx` | **Modify** | Submit payload no longer sends `structuredNotes` on extraction. Form local state is read from the hook's revised shape. |
| `app/capture/_components/expanded-session-row.tsx` | **Modify** | Same submit-payload change as session-capture-form. |
| `lib/prompts/signal-extraction.ts` | **Modify** | Replace `SIGNAL_EXTRACTION_SYSTEM_PROMPT` content (currently a markdown-output system prompt that's been demoted to "guidance" since PRD-018) with a short, neutral guidance template that contains *no* output-format instructions, *no* markdown examples, *no* section-heading requirements. The export name and signature are unchanged so `app/api/prompts/route.ts` and `use-extraction-prompt.ts` continue to compile. The replacement content reads as advisory ("Look for X, Y, Z; treat technical complaints as pain points; treat workflow gaps as blockers; etc.") — what the LLM should pay attention to, not how it should format output. |
| `lib/prompts/structured-extraction.ts` | **Review-only** | Audit the system prompt for any remaining markdown-era residue. Current content (read at TRD-write time) appears clean — no markdown formatting instructions. Confirm and leave unchanged unless the audit surfaces dead clauses. |

### Service / Repository Changes

#### `lib/repositories/master-signal-repository.ts` (modify)

The repository interface signature for `getAllSignalSessions()` and `getSignalSessionsSince()` returns `MasterSignalSessionRow[]`. That row shape is extended:

```ts
export interface MasterSignalSessionRow {
  id: string;
  session_date: string;
  structured_notes: string | null;       // unchanged — null on post-Part-1 rows
  structured_json: ExtractedSignals | null;  // new — null on legacy rows
  updated_at: string;
  client_name: string | null;
}
```

`getStaleSessionCount(since)` continues to return a `number`. Its contract becomes "count of non-deleted sessions that have either `structured_json` OR `structured_notes` populated, optionally bounded by `updated_at > since`." Personal-workspace and team-scoped variants both apply the same predicate.

#### `lib/repositories/supabase/supabase-master-signal-repository.ts` (modify)

Three concrete query changes:

1. **`getAllSignalSessions()`** — change `.select("id, session_date, structured_notes, updated_at, clients(name)")` to include `structured_json`. Replace the `.not("structured_notes", "is", null)` filter with the OR predicate noted above. Continue to apply team scoping via `scopeByTeam()`.
2. **`getSignalSessionsSince()`** — same change as above plus the existing `.gt("updated_at", since)` clause.
3. **`getStaleSessionCount(since)`** — replace the same null filter with the OR predicate. The optional `since` clause is preserved.

The `mapRow()` function maps a row to the service-layer `SignalSession` shape (`{ id, sessionDate, clientName, structuredNotes }`). The new logic computes `structuredNotes` as:

```ts
function composeMarkdown(row): string {
  if (row.structured_json !== null) {
    return renderExtractedSignalsToMarkdown(row.structured_json);
  }
  return row.structured_notes ?? "";  // legacy row
}
```

The empty-string branch is defensive — the repository filter prevents it from being reached. A warn-level log is emitted if it ever fires.

#### `lib/services/ai-service.ts` (modify)

`ExtractionResult` becomes:

```ts
export interface ExtractionResult {
  structuredJson: ExtractedSignals;
  promptVersionId: string | null;
}
```

`extractSignals()` returns `{ structuredJson, promptVersionId }`. The token-usage observability addition (P1.R6 implicit — needed to *prove* the saving):

```ts
const { object, usage } = await generateObject({ ... });
console.log(
  `[ai-service] extractSignals — usage: input=${usage.inputTokens}, output=${usage.outputTokens}, model=${label}`
);
```

The Vercel AI SDK already exposes `usage` from `generateObject`. This unlocks before/after measurement once Part 1 ships.

#### `lib/services/session-service.ts` (modify)

`createSession()` and `updateSession()` already accept an optional `structuredNotes` field. The Part-1 change is a single guard inside both: if `isExtraction === true`, set the eventual repository payload's `structured_notes` to `null` regardless of input. The `structured_notes_edited` flag handling stays as-is (the existing `structuredNotesEdited = false` on extraction is correct).

Comment audit: lines like *"manual markdown edits don't sync back to JSON (Part 3)"* refer to PRD-018's Part 3, not PRD-031's Part 3. Leave them. Do *not* rewrite history.

### Frontend Changes

#### `lib/hooks/use-signal-extraction.ts` (modify)

The hook's exported state changes from "markdown is the dirty-tracking surface" to "JSON is the dirty-tracking surface." Today the hook stores `structuredNotes` and `lastExtractedNotes` and computes `isStructuredDirty = structuredNotes !== lastExtractedNotes`. After Part 1:

- New state: `structuredJson` (already exists) and `lastExtractedJson` (new).
- `isStructuredDirty` is computed via shallow-stringify or a small deep-equal helper against `lastExtractedJson`.
- Drop `structuredNotes`, `lastExtractedNotes`, `setStructuredNotes`.
- The re-extract confirmation flow (`handleExtractSignals` → `setShowReextractConfirm(true)` when in `done` state with dirty content) preserves identical user-visible behaviour.

The `forceConfirmOnReextract` parameter (today driven by the server-side `structured_notes_edited` flag) continues to fire correctly — it does not depend on markdown content.

#### `app/capture/_components/structured-notes-panel.tsx` (modify)

The panel today branches: render `StructuredSignalView` when `structured_json` exists, otherwise render `MarkdownPanel`. Part 1's change is to *retain* this branching unchanged — it already does the right thing. But a hidden assumption flips: today every fresh-extracted session has both `structured_json` and `structured_notes`; after Part 1, fresh-extracted sessions have only `structured_json`. The `MarkdownPanel` arm becomes legacy-display-only.

The implication: the panel's "Edit as markdown" toggle is now reachable only for legacy rows. New sessions can never reach it (no markdown to edit). No visible change to the user, just a narrowing of the toggle's reachability that follows the data shape.

#### `app/capture/_components/session-capture-form.tsx` and `expanded-session-row.tsx` (modify)

Both submit a session create / update body. Both source `structuredNotes` from the hook today. Both stop sending `structuredNotes` once the hook stops exposing it. The submit body retains `structuredJson`, `promptVersionId`, `isExtraction`, and the rest unchanged.

### Observability and Verification

A clean before/after measurement is part of the deliverable, not a nice-to-have.

1. **Per-extraction token usage log.** Added in `extractSignals()` (see above). After Part 1 deploys, two days of production logs gives the team a real number for "tokens saved per extraction by dropping markdown."
2. **Extraction success rate.** No new metric — the existing `[ai-service] extractSignals — success` log line is the canary. If the success rate drops in the 24 hours after Part 1 deploys, suspect the prompt cleanup (P1.R6) and roll back the `signal-extraction.ts` content change first.
3. **Master-signal regeneration smoke test.** Manually trigger `POST /api/ai/generate-master-signal` against a workspace that contains both pre-Part-1 and post-Part-1 sessions. Verify the prompt user-message includes both flavours of session content (markdown for legacy, derived-from-JSON for new) and the resulting master signal reads coherently.

### Test Plan

| Scenario | Verification |
|---|---|
| Capture a new session with raw notes only, click Extract | Capture page renders the structured view; `sessions.structured_json` is populated; `sessions.structured_notes` is `NULL` |
| Capture a new session with raw notes + attachments, click Extract | Same as above; attachments persist and the post-response chain (embeddings → themes) still runs |
| Re-extract an existing session (notes edited) | Re-extract confirmation fires correctly when JSON is dirty; new `structured_json` replaces the old; `structured_notes` remains whatever it was (NULL for post-Part-1, the legacy markdown for pre-Part-1) |
| Re-extract a pre-PRD-018 legacy session that has `structured_notes` but no `structured_json` | Extract produces `structured_json`, leaves `structured_notes` untouched (legacy data preserved); UI now renders from JSON |
| Open the capture page for a pre-Part-1 session that has both `structured_notes` and `structured_json` | Renders from JSON via `StructuredSignalView` (no behaviour change vs. today) |
| Open the capture page for a pre-PRD-018 legacy session with markdown only | Renders via `MarkdownPanel` (existing fallback path) |
| Trigger master-signal cold-start generation on a workspace with mixed legacy + post-Part-1 sessions | All sessions appear in the user message; the master-signal completes successfully; `master_signals.content` is non-empty |
| Trigger master-signal incremental generation after a new post-Part-1 session is added | The new session is included via its derived markdown; output is coherent |
| Read past sessions table, drill-down on a dashboard widget into a post-Part-1 session, click "View Session" | Same UI as today (all surfaces read JSON) |
| Open `/settings/prompts` extraction prompt page | Loads the new neutral guidance template as the default content; existing user-saved prompts in `prompt_versions` continue to load and remain editable |

### Implementation Increments

Five small, independently shippable PRs. Each is a standalone unit of work; no PR after the first leaves the system in a broken state. Quality gates from CLAUDE.md (read every modified file before push, no regressions, doc consistency) apply to each PR.

#### Increment 1 — Master-signal repository reads JSON (no extraction change yet)

**Goal:** make the master-signal backend tolerant of `structured_notes IS NULL` rows *before* the extraction pipeline starts producing them.

**Changes:**

- `lib/repositories/master-signal-repository.ts` — extend `MasterSignalSessionRow` with `structured_json`.
- `lib/repositories/supabase/supabase-master-signal-repository.ts` — update SELECTs, filter predicates, and `mapRow` composition logic.
- Verify against current production data: every existing extracted session has both columns, so the OR filter and the `structured_json`-first composition produce identical output to today's `structured_notes`-only path.

**Verification:** trigger master-signal generation locally on a seeded workspace; confirm the prompt body and the saved master signal are byte-equivalent (modulo whitespace) to a pre-change run on the same data. The derived markdown from `renderExtractedSignalsToMarkdown(structured_json)` should match `structured_notes` exactly for any post-PRD-018 row, since `structured_notes` was originally produced by the same renderer.

**Risk:** zero behavioural change in production at this point. If the verification step reveals a subtle drift between `renderExtractedSignalsToMarkdown(json)` and the historical `structured_notes` value, that's a renderer bug — fix in the renderer, do not patch the repo.

**Rollback:** `git revert` the PR. No data has changed.

#### Increment 2 — Stop generating markdown in `extractSignals`

**Goal:** remove the markdown rendering call from the extraction service and drop `structuredNotes` from the API response.

**Changes:**

- `lib/services/ai-service.ts` — drop `structuredNotes` from `ExtractionResult`; remove the `renderExtractedSignalsToMarkdown` call; remove its import; add the token-usage log.
- `app/api/ai/extract-signals/route.ts` — drop `structuredNotes` from the response body.

**Verification:** Hit `POST /api/ai/extract-signals` with a sample raw-notes payload. Response shape is `{ structuredJson, promptVersionId }`. The frontend hook still works because Increment 3 hasn't shipped yet — *but* until Increment 3, the hook's `setStructuredNotes(data.structuredNotes)` will store `undefined`, which is benign for the UI (the panel branches on `structured_json`). This is the only window where the system is mid-migration; the next increment closes it.

**Risk:** the hook briefly stores `undefined` for `structuredNotes`. Verified to be cosmetic — no UI consumes it once `structured_json` is present.

**Rollback:** `git revert` the PR.

#### Increment 3 — Stop persisting markdown on session create / update / extract

**Goal:** route handlers and service layer write `null` to `structured_notes` on extraction.

**Changes:**

- `app/api/sessions/route.ts` — force `null` when `isExtraction === true`.
- `app/api/sessions/[id]/route.ts` — same.
- `lib/services/session-service.ts` — guard inside `createSession()` and `updateSession()` for the `isExtraction` branch.
- `lib/hooks/use-signal-extraction.ts` — drop the `structuredNotes` / `lastExtractedNotes` state, switch dirty-tracking to JSON.
- `app/capture/_components/session-capture-form.tsx` and `expanded-session-row.tsx` — stop sending `structuredNotes` on extraction submits.

**Verification:** end-to-end smoke — capture a fresh session, extract, save. Inspect the row in DB: `structured_json` populated, `structured_notes` null. Re-open the session — UI renders from JSON. Re-extract — confirmation fires, new JSON replaces old, `structured_notes` stays null.

**Risk:** the hook surface changes. Any component that imports the dropped fields fails to compile — the TypeScript build is the gate.

**Rollback:** `git revert` the PR. New post-Part-1 sessions written before rollback will have `structured_notes IS NULL`. The system tolerates this because Increment 1 already shipped — the master-signal repository's OR predicate handles those rows.

#### Increment 4 — Prompt cleanup (P1.R6)

**Goal:** strip dead markdown-era content from the legacy `signal-extraction.ts` default and audit the structured prompt for residue.

**Changes:**

- `lib/prompts/signal-extraction.ts` — replace `SIGNAL_EXTRACTION_SYSTEM_PROMPT` content with neutral, output-format-free guidance. Keep the export name and the `buildSignalExtractionUserMessage` signature (still consumed by `app/api/prompts/route.ts` defaults and `use-extraction-prompt.ts`).
- `lib/prompts/structured-extraction.ts` — read it; if any markdown residue is present (none expected based on TRD-write-time inspection), trim it.

**Verification:** open `/settings/prompts`, confirm the extraction prompt page loads the new neutral default. Save a small custom prompt (e.g., "Pay extra attention to data residency mentions"); trigger an extraction; confirm the JSON output still validates against `extractionSchema` and contains the additional emphasis the custom prompt requested. No regression in extraction quality.

**Risk:** if any user has a saved custom prompt that depended on the *system* prompt's markdown framing, they may see a small quality shift. Mitigation: the system prompt for extraction has been `STRUCTURED_EXTRACTION_SYSTEM_PROMPT` since PRD-018 — the markdown one was already demoted to optional guidance. So this risk is theoretical. Inspect `prompt_versions` rows before deploy to count workspaces with active custom prompts; spot-check two or three to confirm none reference markdown structure.

**Rollback:** `git revert` the PR.

#### Increment 5 — End-of-part audit and documentation update

**Goal:** the end-of-part audit checklist from CLAUDE.md, plus `ARCHITECTURE.md` and `CHANGELOG.md` updates.

**Changes:**

- Run the SOLID + dead-code + design-token + logging checklist across every file touched in Increments 1–4.
- `ARCHITECTURE.md`:
  - "Current State" paragraph adds a one-line note that PRD-031 Part 1 is implemented and that `structured_notes` is no longer written on extraction.
  - The `sessions` table description footnote updates: "`structured_notes` retained for backward compatibility; populated only for sessions captured before PRD-031 Part 1, and for any future user-driven manual markdown edit on legacy rows."
  - Decision 17 ("Master Signal — retained backend, retired UI") is updated to note that the backend now derives markdown on demand from `structured_json` for post-Part-1 sessions.
- `CHANGELOG.md` adds a PRD-031 Part 1 entry summarising what shipped.
- Verify file references in docs still resolve.
- Run `npx tsc --noEmit`.

**Verification:** the checklist itself; no new functional behaviour.

**Rollback:** documentation-only PR; revert if any doc reference rots.

### Forward Compatibility Notes

- **Part 2 (positive signal chunk type)** introduces a new chunk-type bucket in `extractionSchema`, the chunking service, the embedding pipeline metadata, the theme-assignment surface, and the structured signal view. None of those touch `structured_notes` — Part 1 leaves the markdown renderer (`renderExtractedSignalsToMarkdown`) consumed only by the master-signal site, where Part 2's new bucket can be appended to the rendered markdown the same way `custom` categories are today. No Part-1 work needs to anticipate Part 2 specifically; the renderer's structure already accommodates new sections.
- **Part 3 (chat response cap, step count, prompt softening)** is fully orthogonal to Part 1 — no shared files, no shared interfaces.

### Open Questions Deferred to Implementation

- The exact phrasing of the new neutral guidance template in `signal-extraction.ts`. Drafted during Increment 4 review; one paragraph max.
- Whether to also drop the `structured_notes_edited` boolean from `sessions`. **Deferred** — it is still meaningful for legacy rows where the user may have manually edited the markdown. Hard-deletion of the column belongs in the same future PRD that drops `structured_notes` itself.

---

## Part 2: Positive Signal Chunk Type and Hide-Empty Sections

> Implements **P2.R1–P2.R8** from PRD-031.

**Status:** Stubbed. Detailed implementation plan to be filled in once Part 1 ships and Part 2 begins.

### Forward-compatibility commitments inherited from Part 1

- The chunking service in `lib/services/chunking-service.ts` continues to be a pure function — Part 1 does not touch it, so Part 2's addition of a new branch for `positive_signal` is a purely additive change in one file.
- `chunk_type` is already a TEXT column on `session_embeddings` (not an enum) per ARCHITECTURE.md — no DB migration is required to introduce a new chunk-type literal.
- Theme-assignment shapes are generic across chunk types (Part 1 verified).

---

## Part 3: Looser Chat Response Limits

> Implements **P3.R1–P3.R6** from PRD-031.

**Status:** Stubbed. Detailed implementation plan to be filled in once Parts 1 and 2 ship and Part 3 begins.

### Forward-compatibility commitments inherited from Part 1

None. Part 3 touches `lib/prompts/chat-prompt.ts`, `lib/services/chat-stream-service.ts`, and observability around chat completions — no overlap with Part 1's scope.
