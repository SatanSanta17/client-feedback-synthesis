# TRD-031: Workflow Improvements

> **Status:** Part 1 shipped. Part 2 in progress.
>
> Mirrors **PRD-031**. Each part maps to the corresponding PRD part. **Part 1** (Drop Markdown Extraction) is detailed below and shipped. **Part 2** (Positive Signal Chunk Type and Hide-Empty Sections) is detailed below. **Part 3** (Looser Chat Response Limits) is stubbed and will be filled in once its PRD part begins implementation. Per the project rule that each TRD part references the entire PRD, forward-compatibility constraints from later parts are noted in earlier parts where relevant.

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

> Implements **P2.R1–P2.R9** from PRD-031.

### Overview

Three coordinated changes to the structured-extraction surface. First, add `positive_signal` as a tenth chunk type — a first-class category for praise, wins, retention drivers, and other clearly-positive client statements that today have nowhere to live (the LLM either drops them, awkwardly bins them as "aspirations achieved," or buries them in the session summary). Second, on every signal view that renders the JSON output, hide narrative sections that have zero entries instead of showing the "No signals identified." placeholder rows. Third, surface the new category at the top level of the dashboard via a minimum-viable "Top Wins" widget that mirrors the Top Themes widget's pattern (P2.R9) — without it, positive_signal data would only appear in the breakdown tooltip of an aggregate widget and would feel buried.

The decision to limit chunk-type expansion to `positive_signal` only — rather than also adding `success_story`, `objection`, `risk`, etc. in the same pass — is a PRD-level call (see PRD-031 Part 2 scope and backlog). The TRD honours that scope. The decision to ship a *minimum-viable* Top Wins widget rather than fancier variants (trend over time, by-client scatter, intensity-weighted ranking) is also a PRD-level call (P2.R9 + backlog) — fancier variants wait for real-workspace data before being designed.

The change ripples through six layers, in this order: schema → chunking → theme-assignment compatibility → UI signal view → dashboard chunk-type label → dashboard widget. Extraction prompt update is the *last* code change so the feature never appears half-wired in production (no positive signals extracted before consumers can render them).

**Forward-compat constraints from Part 3.** Part 3 is fully orthogonal — chat response cap, step count, prompt softening — no shared files, no shared interfaces. Nothing in Part 2 needs to anticipate Part 3.

**Constraints inherited from Part 1.**
- `structured_json` is the single source of truth (Part 1 retired markdown). Part 2 adds a new field to that JSON; consumers that read the JSON shape get the new field for free once the schema is updated and the prompt produces it.
- `chunk_type` is a TEXT column on `session_embeddings` (per ARCHITECTURE.md). Adding `positive_signal` is a literal-only change with no DB migration.
- The master-signal renderer (`renderExtractedSignalsToMarkdown`) consumed by `composeStructuredNotes()` in `supabase-master-signal-repository.ts` (Part 1) reads every category. It needs a new section for positive signals so legacy markdown derivation includes them.

### Dependencies (npm)

None. No new packages, no version bumps.

### Database Changes

**None.** `session_embeddings.chunk_type` is TEXT and accepts new literal values without migration. `sessions.structured_json` is JSONB and accepts the new `positiveSignals` array without migration. `signal_themes` is generic across chunk types and stores no chunk-type-specific shape.

A read-side handling note: pre-Part-2 sessions in `structured_json` have no `positiveSignals` field. Consumers that access the field directly must default-handle the missing key via `?? []` (TypeScript would type the field as required after the schema change, but runtime undefined is the historical truth). The Zod schema's `.default([])` covers any code path that re-parses through the schema; raw cast-to-`ExtractedSignals` reads do not benefit from the default and must defensive-coalesce. The defensive `?? []` is added wherever the field is iterated.

### API Endpoints

**No route changes.** Request/response shapes that pass `structuredJson` through (POST `/api/sessions`, PUT `/api/sessions/[id]`, POST `/api/ai/extract-signals`, GET `/api/dashboard?action=session_detail`, GET `/api/dashboard?action=drill_down`) accept the new field without route-level edits — they are pass-through for the JSON payload.

### Design Token Changes

**One addition — re-uses existing tokens, no new CSS variables.** The severity badge for positive-signal items renders with success-themed colours instead of error-themed. The colours map onto the existing `--status-success-*` tokens already used for the positive-sentiment pill in `StructuredSignalView`'s `SentimentBadge`. No new tokens defined; the component layer routes the existing ones through a new variant.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `lib/types/embedding-chunk.ts` | **Modify** | Add `"positive_signal"` to the `ChunkType` union literal |
| `lib/schemas/extraction-schema.ts` | **Modify** | Add `positiveSignals: z.array(signalChunkSchema).default([])` to `extractionSchema`; bump `EXTRACTION_SCHEMA_VERSION` from `1` to `2`; update `schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION)` accordingly |
| `lib/services/chunking-service.ts` | **Modify** | Add a `positive_signal` loop in `chunkStructuredSignals()` between the existing `aspirations` and `competitiveMentions` blocks; defensive `?? []` access on the new array for old data tolerance |
| `lib/utils/render-extracted-signals-to-markdown.ts` | **Modify** | Add a "Positive Signals" section in the rendered markdown so the master-signal backend's derived markdown includes the new category for new sessions; defensive `?? []` access |
| `lib/prompts/structured-extraction.ts` | **Modify** | Extend the system prompt with the rule that distinguishes positive signals from aspirations, with one worked example in each direction (positive-signal example: "your onboarding flow is the best I've used"; aspiration example: "we'd love a Slack integration"); add a Rule explicitly about NOT pulling positive-flavoured content out of the session summary or out of competitiveMentions where it already belongs |
| `components/capture/structured-signal-view.tsx` | **Modify** | Add a `<Section title="Positive Signals">` rendering block between Pain Points and Must-Haves; introduce a `variant?: "default" \| "positive"` prop on `SeverityBadge` so positive-signal items render with `--status-success-*` tokens; gate every existing narrative `<Section>` on `chunks.length > 0` so empty sections disappear (P2.R6) — applies uniformly to Pain Points, Must-Haves, Aspirations, Positive Signals, Competitive Mentions, Blockers, and Platforms & Channels; always-visible sections (Session Summary, Sentiment, Urgency, Decision Timeline, Client Profile) unchanged |
| `app/dashboard/_components/chart-colours.ts` | **Modify** | Add `positive_signal: "Positive Signal"` to `CHUNK_TYPE_LABELS` and `positive_signal: "Positive signals"` to the in-function `PLURAL_LABELS` inside `formatChunkTypePlural()` |
| `lib/services/database-query/domains/themes.ts` | **Modify** | Extend the existing `top_themes` action to accept an optional `chunkTypes?: string[]` filter that pre-filters `signal_themes` joins by `session_embeddings.chunk_type IN (…)`. The Top Themes widget continues to call it with no filter (today's behaviour). The new Top Wins widget calls it with `chunkTypes: ["positive_signal"]`. Single shared action means we don't duplicate the join chain |
| `lib/services/database-query/types.ts` | **Modify** | Add optional `chunkTypes?: string[]` to `QueryFilters`. Existing callers that don't set it remain unchanged |
| `app/dashboard/_components/top-wins-widget.tsx` | **Create** | New widget mirroring `top-themes-widget.tsx`'s shape: horizontal `BarChart`, fetched via `useDashboardFetch` with `action: "top_themes", filters.chunkTypes: ["positive_signal"]`, uses success-themed bar colour (existing `--status-success` token mapped to a hex via `chart-colours.ts` — see addition below), drill-down on bar click via the existing `theme` strategy with the chunkTypes filter forwarded so the drill-down panel shows only positive_signal rows. Returns `null` from render when `data.length === 0` so the widget hides itself when the workspace has no positive_signal data (P2.R9) |
| `app/dashboard/_components/chart-colours.ts` | **Modify** (second edit) | Add `WIN_BAR_HEX` (e.g. `#22c55e`, the green-500 already used for sentiment-positive) so the Top Wins widget has a single source of truth for its bar colour, consistent with the existing pattern of named hex constants |
| `app/dashboard/_components/dashboard-content.tsx` | **Modify** | Insert `<TopWinsWidget />` into the responsive widget grid alongside `<TopThemesWidget />`. Position adjacent so the visual pairing reads as "what they're praising / what they're discussing." The widget uses the same `Suspense` boundary, freshness context, and filter-bar response wiring as the other widgets — no special-casing |
| `lib/services/database-query/domains/drilldown-direct.ts` | **Audit-only** | Confirmed no chunk-type enum dependency; `embeddingChunkType` is a pass-through string filter. New `positive_signal` chunks surface in drill-downs by virtue of being in `session_embeddings`. No code change required, just verification |
| `lib/services/database-query/domains/drilldown-theme.ts` | **Audit-only** | Same as above — chunk_type is reflected back in the response row but not enum-constrained |
| `lib/services/theme-service.ts` | **Audit-only** | Theme assignment is generic across chunk types — `positive_signal` chunks flow through without code change. The theme-assignment system prompt already references chunk_type as a free-form string ("the chunk_type field already captures whether something is a pain point, requirement, blocker, etc."); no prompt edit required for Part 2 |
| `lib/prompts/theme-assignment.ts` | **No change** | Verified above — themes describe topics, not categories; positive signals will be themed by the same logic ("Onboarding Friction" theme can hold positive signals about onboarding too, by design) |

### Schema Changes

#### `lib/schemas/extraction-schema.ts`

Three changes:

1. Bump `EXTRACTION_SCHEMA_VERSION` from `1` to `2`.
2. Update the `schemaVersion` field's literal: `z.literal(EXTRACTION_SCHEMA_VERSION)` — ties to the bumped constant.
3. Add a new field to `extractionSchema`:

```ts
positiveSignals: z
  .array(signalChunkSchema)
  .default([])
  .describe(
    "Positive client signals — praise, wins, things the customer is currently experiencing and explicitly likes. Distinct from aspirations (which describe what the customer wants but does not yet have)."
  ),
```

The shape is `signalChunkSchema` (text + clientQuote + severity), reused intentionally:
- Same metadata pipeline (the embedding row's `metadata.severity` field flows through to filters and dashboards uniformly).
- One less parallel type to maintain.
- The `severity` field on a positive signal reads as **intensity of expression** at the data layer; the UI labels and colours communicate "how strongly positive" rather than "how bad," via the new `variant="positive"` on `SeverityBadge`.

The `.default([])` matters for any path that re-parses old `structured_json` through the schema — old rows that lack the field get `[]` rather than throwing. Direct casts (`structured_json as ExtractedSignals`) bypass parsing and need explicit `?? []` at the access site (covered by the chunking, rendering, and view changes below).

`EXTRACTION_SCHEMA_VERSION = 2` semantics: new extractions tag themselves as v2. Old rows in DB stay at v1 and are not re-validated — Part 2 introduces no migration. If a future migration ever re-parses old rows, it will need to either accept `z.union([z.literal(1), z.literal(2)])` for `schemaVersion` or rewrite v1 rows to v2 shape; that decision is owned by whichever future PRD does the re-parse.

### Service / Repository Changes

#### `lib/services/chunking-service.ts` (modify)

Insert a `positive_signal` block between the `aspirations` loop and the `competitiveMentions` loop, mirroring the same shape:

```ts
// --- Positive signals (one per item) ---
for (const item of structuredJson.positiveSignals ?? []) {
  chunks.push(
    buildChunk(item.text, "positive_signal", {
      severity: item.severity,
      client_quote: item.clientQuote,
    }, sessionMeta)
  );
}
```

The `?? []` defensive coalesce handles old `structured_json` rows that have no `positiveSignals` key — the chunking service is also called by `runSessionPostResponseChain` on re-extraction of any session, including pre-Part-2 ones that may go through the chain via bulk re-extraction (PRD-017).

No other change to the chunking service — no helper extraction, no signature change, no return-shape change.

#### `lib/utils/render-extracted-signals-to-markdown.ts` (modify)

The renderer is consumed by `composeStructuredNotes()` in the master-signal repo (Part 1). For new sessions whose JSON now includes positive signals, the derived markdown must include them so the master signal can synthesise across the new category. Add a section block mirroring the Pain Points pattern, between the Aspirations and Competitive Mentions blocks:

```ts
lines.push("## Positive Signals\n");
lines.push(renderSignalChunks(signals.positiveSignals ?? []));
```

The existing `renderSignalChunks()` helper already handles empty arrays gracefully ("No signals identified.\n"). The PRD-031 P2.R6 hide-empty rule applies to the *capture-page UI*, not to the master-signal markdown — the renderer is fed to a downstream LLM that benefits from explicit empty-section labels for category integrity.

`?? []` again for old-data tolerance.

#### `lib/prompts/structured-extraction.ts` (modify)

Two additions:

1. Update the existing list of categories so the LLM knows about the new bucket. This is implicit via the schema (since `generateObject` ties output to schema), but the system prompt's prose mentions categories and should be kept in sync.

2. Add an explicit boundary rule (insert as Rule 12 after the existing eleven rules):

```
12. For positiveSignals: capture statements where the client describes something
they are currently experiencing and explicitly likes — praise for the product,
team, onboarding, support, performance; retention drivers; reasons they stayed
with the platform. Do NOT use this category for forward-looking wants (those
go in aspirations) or for praise of competitors (those go in competitiveMentions
with sentiment=positive). Examples:
   - "Your onboarding flow is genuinely the best I've used" → positiveSignals
   - "The support team turned around our last bug fix in two hours, that's a major reason we stayed" → positiveSignals
   - "We'd love a Slack integration to make this easier" → aspirations (forward-looking want)
   - "The competitor's reporting suite was excellent" → competitiveMentions (about a competitor, not your product)
```

The boundary clarity is critical (P2.R2 acceptance criterion). The worked examples in both directions are not optional — they are the disambiguator the LLM needs to avoid pulling positive content out of categories where it already belongs (the "do not cross-contaminate" criterion in PRD-031 P2 acceptance).

#### `lib/services/theme-service.ts` (audit-only, no change)

Confirmed that `assignSessionThemes()` iterates chunks generically and passes `chunk_type` through to the theme-assignment LLM call as a string field. The theme-assignment system prompt explicitly states themes describe topics, not categories, and that the `chunk_type` field captures the category dimension separately. Positive-signal chunks will therefore be themed by topic ("Onboarding Friction" can hold both pain points and positive signals about onboarding) without code changes — and the dashboard's theme widgets already aggregate across chunk types, so positive-signal contributions to a theme's volume will be visible immediately once the data is there.

### Frontend Changes

#### `components/capture/structured-signal-view.tsx` (modify)

Three coordinated edits:

1. **Add the Positive Signals section.** Insert a new `<Section title="Positive Signals">` between the Pain Points block (line 63) and the Must-Haves block (line 67). The section uses a new wrapper variant of `SignalChunkList` that passes `severityVariant="positive"` down to its child `SeverityBadge` components. Internally this can be done by extending `SignalChunkList`'s prop signature with an optional `severityVariant?: "default" | "positive"` (default `"default"`), or by adding a thin `PositiveSignalChunkList` wrapper that calls the same primitives. Either is fine — implementation prefers the prop, since it's two lines.

2. **Hide empty narrative sections (P2.R6).** Wrap each existing narrative `<Section>` in a `chunks.length > 0 && (...)` gate. Applies to: Pain Points, Must-Haves / Requirements, Aspirations, Positive Signals, Competitive Mentions, Blockers / Dependencies, Platforms & Channels. The custom-categories block already does this and is left unchanged. Always-visible sections — Session Summary, Sentiment, Urgency, Decision Timeline, Client Profile — are unchanged: they always render with their own "Not mentioned" treatment for missing fields.

3. **Add positive variant to `SeverityBadge`.** New optional prop `variant?: "default" | "positive"`. Default is the existing styles (muted / amber / red). Positive variant uses the existing `--status-success-*` token chain already used by `SentimentBadge`'s positive case:

```ts
const SEVERITY_STYLES_POSITIVE: Record<"low" | "medium" | "high", string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-[var(--status-success-light)] text-[var(--status-success)] border border-[var(--status-success-border)] opacity-80",
  high: "bg-[var(--status-success-light)] text-[var(--status-success)] border border-[var(--status-success-border)]",
};
```

The badge label still reads "low" / "medium" / "high"; the colour communicates positive intensity. (UX research could later argue for relabelling to "mild" / "strong" / "emphatic" — out of scope for this part. PRD-031 P2.R5 says "same visual pattern... optional intensity badge"; the colour change is sufficient.)

#### Capture-page consumers (no behaviour change)

`app/capture/_components/structured-notes-panel.tsx` and `expanded-session-row.tsx` consume `StructuredSignalView` via its existing prop interface. They render whatever the view renders — no per-consumer changes needed for the new section or the hide-empty behaviour.

#### Dashboard surfaces

`app/dashboard/_components/chart-colours.ts` — add the `positive_signal` entry to both `CHUNK_TYPE_LABELS` (singular) and the inner `PLURAL_LABELS` map of `formatChunkTypePlural()`. The chunk-type breakdown tooltip on `top-themes-widget.tsx`, the legend on `theme-client-matrix-widget.tsx`, and the drill-down panel's per-row chunk-type badge all flow through these helpers and inherit the new label automatically. **Audit:** the file currently contains speculative entries `praise`, `question`, `action_item` that are not wired to any consumer; PRD-031 Part 2 does *not* clean those up — that belongs in a separate cleanup PRD if and when those types arrive. The new `positive_signal` entry is a real addition wired to a real consumer.

#### Drill-down (audit-only)

`drilldown-direct.ts` and `drilldown-theme.ts` already pass `chunk_type` through as a free-form string column on `session_embeddings`. New `positive_signal` chunks appear in drill-down result rows by virtue of being in the embeddings table, are rendered with the new label via `chart-colours.ts`, and respond to the chunk-type-filter pass-through (`embeddingChunkType` option) without any enum constraint to update. No drill-down code change. Verified during TRD authoring; re-verified during the drill-down audit increment.

#### `app/dashboard/_components/top-wins-widget.tsx` (new) and `dashboard-content.tsx` (modify) — P2.R9

The Top Wins widget is a near-duplicate of the existing Top Themes widget — same `BarChart` shape, same `useDashboardFetch` lifecycle, same drill-down click behaviour — with three deliberate differences:

1. **Filtered query.** Calls `useDashboardFetch({ action: "top_themes", filters: { ..., chunkTypes: ["positive_signal"] } })`. The `top_themes` action is extended once with the optional `chunkTypes` filter (added to `QueryFilters` and to `domains/themes.ts` — the SQL extension is a single `IN (...)` predicate on the `signal_themes ⨝ session_embeddings` join). Top Themes itself doesn't pass the filter, so the existing widget's behaviour is byte-equivalent. The Top Wins widget passes `["positive_signal"]`. Sharing the action means we don't fork the join chain.
2. **Success-themed bar colour.** The bar uses `WIN_BAR_HEX` (a new export in `chart-colours.ts` mapped to `#22c55e`, the same green-500 already used for sentiment-positive). The chart colour scale is otherwise identical to Top Themes.
3. **Self-hide on empty.** When the fetch completes with `data.length === 0`, the widget returns `null` from render — the dashboard grid simply doesn't render the slot. This implements the P2.R9 requirement that the widget hide itself when the workspace has no positive-signal data, in keeping with the hide-empty intent of P2.R6. Loading and error states render as in Top Themes (skeleton / retry).

Drill-down: a click on a Top Wins bar dispatches the existing `theme` drill-down strategy with the chunk-type filter forwarded, so the drill-down panel shows only positive-signal rows for that theme. The drill-down strategy already supports an `embeddingChunkType` pass-through (verified in the drill-down audit), so this is a wiring change in the widget's onClick, not a new strategy.

Grid placement: inserted in `dashboard-content.tsx`'s responsive widget grid adjacent to `<TopThemesWidget />` so the visual pairing reads as "what they're praising / what they're discussing." All other widgets are unchanged. The freshness context, filter-bar response, screenshot export, and Suspense boundary all carry through unchanged — Top Wins is a sibling slot, not a special case.

`top-themes-widget.tsx`'s chunk-type breakdown tooltip continues to show positive_signal contributions in the breakdown (via the chart-colours label addition). Top Wins is the *dedicated* surface; the tooltip breakdown is the *contextual* surface. They coexist.

### Observability and Verification

- **Per-extraction token usage telemetry** (already added in Part 1's `callModelObject()`) carries through. Adding a category to the schema increases the LLM's output token budget slightly; we'll see the delta in logs.
- **New category bucket-rate metric (informal).** After deploy, sample five real new extractions per workspace per day from the logs (the extraction route already logs the structured JSON's character length; manual spot-checks will validate that positive_signal arrays contain real positives, not pulled-from-summary or pulled-from-aspirations content). PRD-031 P2 acceptance: zero cross-contamination on the worked example.
- **Schema-version visibility.** New extractions tag themselves with `schemaVersion: 2` in `structured_json`. A simple SQL count of `WHERE structured_json->>'schemaVersion' = '2'` versus `'1'` shows the v2 adoption rate after rollout.

### Test Plan

| Scenario | Verification |
|---|---|
| Capture a new session with raw notes containing one clear positive client statement, click Extract | Extracted JSON has `positiveSignals` with one item; the capture page renders a "Positive Signals" section with green-themed intensity badge; pain-points and other sections render correctly without contamination |
| Capture a new session whose notes have nothing positive | Extracted JSON has `positiveSignals: []`; the capture page does *not* render a "Positive Signals" section (P2.R6) |
| Capture a new session whose notes have positive content + a forward-looking want | Positive content goes in `positiveSignals`; want goes in `aspirations`; both sections visible |
| Capture a new session whose notes mention a competitor positively | Goes in `competitiveMentions` with `sentiment: "positive"`, NOT in `positiveSignals` (boundary rule per Rule 12) |
| Re-extract a pre-Part-2 session via PUT | New extraction produces v2 schema with positive signals as found; old `structured_json` is replaced; render path tolerates the transition seamlessly |
| Open a pre-Part-2 session in the capture row (no re-extract) | Renders correctly via `?? []` defensive coalesce — Positive Signals section absent (since the array is empty/missing) |
| Open the past-sessions table | Sparkles "extracted" indicator gates correctly; positive-signal-only sessions are recognised as extracted |
| Click a top-themes widget bar | Drill-down opens; per-row chunk-type badges show "Positive Signal" for positive-signal chunks |
| Hover the top-themes widget tooltip | Chunk-type breakdown includes "Positive signals: N" when applicable |
| Open the dashboard on a workspace with no positive-signal data | Top Wins widget does not render (no slot, no empty placeholder). Top Themes and other widgets render unchanged. (P2.R9) |
| Open the dashboard on a workspace with positive-signal data | Top Wins widget renders alongside Top Themes with success-themed bars; bars are sorted by positive-signal volume per theme; counts match the chunk-type breakdown tooltip on the corresponding Top Themes bar. (P2.R9) |
| Apply the global filter bar (date range / clients / severity / urgency / confidenceMin) | Top Wins refetches and re-renders with the filtered counts; behaves identically to Top Themes' response to filters. (P2.R9) |
| Click a Top Wins bar | Drill-down panel opens scoped to that theme AND `chunk_type=positive_signal` — the panel shows only positive-signal rows for the selected theme, with the success-themed chunk-type badge. (P2.R9) |
| Trigger master-signal generation across mixed pre/post-Part-2 sessions | Successful run; the LLM input has "## Positive Signals" sections only for sessions that have them — others have an empty section ("No signals identified.\n") which the existing renderer emits |
| Existing legacy session with `structured_notes` only (pre-PRD-018, no JSON) | Renders via `MarkdownPanel` fallback unchanged (no positiveSignals in markdown either) |

### Implementation Increments

Eight small, independently shippable PRs. Increments 1–6 ship infrastructure that is dormant (no `positive_signal` chunks exist yet because the prompt hasn't been updated). Increment 7 turns the feature on. Increment 8 is the audit. This ordering means consumers are ready *before* extraction starts producing positives — the user never sees a partial-feature state.

#### Increment 1 — Schema and chunk-type literal

**Goal:** ground truth for the new category.

**Changes:**
- `lib/types/embedding-chunk.ts` — add `"positive_signal"` to `ChunkType`.
- `lib/schemas/extraction-schema.ts` — bump `EXTRACTION_SCHEMA_VERSION` to `2`; add `positiveSignals: z.array(signalChunkSchema).default([])`; update `schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION)`.

**Verification:** `npx tsc --noEmit` is the gate. No runtime behaviour change (no consumer is producing or rendering positive signals yet). Existing extractions still validate against the schema because the new field has a default.

**Risk:** existing in-flight extractions at deploy time get the v2 schema, including the v2 `schemaVersion` literal. The LLM emits whatever schema is passed via `generateObject`. Since the new field has a default and the LLM produces no positive signals (it has no instruction to), the `positiveSignals` array is empty — fine.

**Rollback:** `git revert`. Zero data side-effects.

#### Increment 2 — Chunking pipeline + master-signal renderer

**Goal:** the embedding pipeline and the master-signal markdown emitter both know how to handle the new category — even though no extractions produce it yet.

**Changes:**
- `lib/services/chunking-service.ts` — insert positive-signal loop with `?? []` defensive access.
- `lib/utils/render-extracted-signals-to-markdown.ts` — insert "## Positive Signals" section.

**Verification:** seed a test JSON with `positiveSignals: [{ text: "...", severity: "high", clientQuote: "..." }]` in a unit-equivalent script; run the chunking and the renderer manually; confirm one new chunk row with `chunk_type: "positive_signal"` and the rendered markdown contains the section. Unaffected on existing sessions because the field is missing → `?? []` → no chunks added, empty markdown section.

**Risk:** none — purely additive, gated by data presence.

**Rollback:** `git revert`.

#### Increment 3 — UI: positive section + hide-empty for all narrative sections

**Goal:** the capture-page view renders the new section when present and hides empty sections universally.

**Changes:**
- `components/capture/structured-signal-view.tsx`:
  - Add `<Section title="Positive Signals">` block.
  - Add `variant?: "default" | "positive"` prop to `SeverityBadge`.
  - Wrap every narrative `<Section>` in a `chunks.length > 0 && (...)` gate.
  - Defensive `?? []` access on `signals.positiveSignals` since old structured_json lacks the field at runtime.

**Verification:** open the capture page on a pre-Part-2 session → previously rendered "No signals identified." rows are now hidden for empty sections; on a session whose extraction has empty `aspirations`, the Aspirations section disappears. The Positive Signals section is invisible for every existing session because none have data yet (Increment 6 turns that on). The always-visible sections (Summary / Sentiment / Urgency / Decision Timeline / Client Profile) are unchanged.

**Risk:** the hide-empty behaviour is the most user-visible piece of Part 2 *before* Increment 6 ships. It applies to sessions captured under PRDs going back to PRD-018. Any existing session whose extraction has, say, no blockers will now render without that section. The TRD test plan's "open a pre-Part-2 session" scenario verifies this is acceptable. Manual review of a representative workspace before deploy is recommended.

**Rollback:** `git revert`. The pre-Part-2 sessions render with empty-state rows again.

#### Increment 4 — Dashboard chunk-type label

**Goal:** dashboard tooltips, breakdowns, and drill-down badges render the new label.

**Changes:**
- `app/dashboard/_components/chart-colours.ts`:
  - `CHUNK_TYPE_LABELS`: add `positive_signal: "Positive Signal"`.
  - Inner `PLURAL_LABELS` of `formatChunkTypePlural()`: add `positive_signal: "Positive signals"`.

**Verification:** until Increment 6 ships, no positive_signal chunks exist in the embeddings table, so the new label never renders on real data. The change is purely a label-table addition; visual verification happens after Increment 6.

**Risk:** none.

**Rollback:** `git revert`.

#### Increment 5 — Top Wins dashboard widget (P2.R9)

**Goal:** the dashboard surfaces a "Top Wins" widget alongside Top Themes. The widget is dormant until Increment 7 produces the data — but the wiring (query action, chart, drill-down, grid placement) ships now so consumers are ready.

**Changes:**
- `lib/services/database-query/types.ts` — add optional `chunkTypes?: string[]` to `QueryFilters`. Existing callers unaffected.
- `lib/services/database-query/domains/themes.ts` — extend `top_themes` to honour the new `chunkTypes` filter via an `IN (...)` predicate on the `signal_themes ⨝ session_embeddings` join. Top Themes (no filter) behaviour byte-equivalent.
- `app/dashboard/_components/chart-colours.ts` — add `WIN_BAR_HEX = "#22c55e"` (green-500, same value as the sentiment-positive colour) for the Top Wins widget's bar fill.
- `app/dashboard/_components/top-wins-widget.tsx` — new widget mirroring `top-themes-widget.tsx`'s shape: `useDashboardFetch({ action: "top_themes", filters: { ..., chunkTypes: ["positive_signal"] } })`; horizontal `BarChart` with `WIN_BAR_HEX`; loading skeleton + retry on error; **returns `null` when `data.length === 0`** so the widget self-hides on workspaces with no positive-signal data; click handler dispatches the `theme` drill-down strategy with `embeddingChunkType: "positive_signal"` forwarded.
- `app/dashboard/_components/dashboard-content.tsx` — render `<TopWinsWidget />` adjacent to `<TopThemesWidget />` in the responsive grid. Same Suspense boundary, same freshness context, same screenshot export — the widget is a sibling slot.

**Verification:** until Increment 7 ships, the widget renders `null` for every workspace because no positive-signal data exists. Manual seed of one positive-signal embedding row into a dev workspace confirms the widget appears, the bar count is correct, click opens drill-down filtered correctly, and the global filter bar drives a refetch. `npx tsc --noEmit` is the gate.

**Risk:** low. The shared `top_themes` action's filter extension is the highest-risk piece — needs explicit unit-equivalent verification that without `chunkTypes` the SQL is byte-equivalent (i.e. the `IN (...)` clause is conditionally appended, not always present with a wildcard). Top Wins on the dashboard before any data exists must show as no-render, not as an empty bar chart with a "no data" placeholder — the test plan covers this.

**Rollback:** `git revert` of this increment alone removes the widget without disturbing earlier infrastructure or the prompt flip.

#### Increment 6 — Drill-down audit

**Goal:** confirm the drill-down query path needs no code change for the new chunk type.

**Changes:** none — this is a verification step. Read `lib/services/database-query/domains/drilldown-direct.ts` and `drilldown-theme.ts`; confirm `chunk_type` is a free-form string pass-through; confirm `embeddingChunkType` option (used by Increment 5's Top Wins drill-down) accepts arbitrary strings. No discriminated union or enum constraint anywhere on chunk_type.

**Verification:** static reading. If anything is found that would need editing, fold the edit into this increment.

**Risk:** if the audit finds an unanticipated enum constraint (unlikely — already verified at TRD authoring), this increment turns into a small code change.

**Rollback:** doc-only or trivial.

#### Increment 7 — Extraction prompt update (feature flip)

**Goal:** the LLM begins producing positive_signal data on every new extraction. This is the increment that turns the feature on.

**Changes:**
- `lib/prompts/structured-extraction.ts`: add Rule 12 with worked examples (positive vs aspiration vs competitive_mention). Update the prompt's existing prose category list to mention positiveSignals.

**Verification:** capture a real session with notes containing one clear positive statement, one aspiration, one positive competitor reference; extract; inspect the JSON: the three pieces should land in three distinct buckets with zero cross-contamination. Repeat with a session that has no positive content; `positiveSignals: []`.

**Risk:** prompt regressions. The new rule could subtly bias the LLM to over-classify aspirations as positives or pull content out of the summary. Mitigation: keep Rule 12 narrowly scoped with explicit anti-examples; validate against five real-shaped test sessions before merging Increment 6. If quality regresses, the rule can be tuned post-deploy without a code change to other layers.

**Rollback:** `git revert` of this single increment restores extraction quality to its pre-Part-2 state. Increments 1–6 stay deployed and remain dormant (the schema accepts an empty array; consumers handle empty cleanly; the Top Wins widget self-hides when there's no data).

#### Increment 8 — End-of-part audit and documentation update

**Goal:** the CLAUDE.md end-of-part audit checklist plus `ARCHITECTURE.md` and `CHANGELOG.md` updates.

**Changes:**
- Run the SOLID + dead-code + design-token + logging + convention checklist across every file touched in Increments 1–7.
- `ARCHITECTURE.md`:
  - "Current State" paragraph: add a sentence noting PRD-031 Part 2 is implemented (positive_signal chunk type live; hide-empty applied to capture view; Top Wins dashboard widget alongside Top Themes).
  - The `session_embeddings` table footnote on `chunk_type` lists the valid values; add `positive_signal` to that list.
  - The schema-version footnote (currently states v1 with PRD-018): note the v2 bump and what changed (added positiveSignals).
  - The dashboard widget enumeration (currently lists eight widgets): add Top Wins as the ninth.
- `CHANGELOG.md`: add a PRD-031 Part 2 entry summarising what shipped, including the schema bump, the new category, the hide-empty behaviour, the two prompt-rule additions, and the new Top Wins widget.
- Verify file references in docs still resolve.
- Run `npx tsc --noEmit`.

**Verification:** the checklist itself; no new functional behaviour.

**Rollback:** documentation-only PR.

### Forward Compatibility Notes

- **Future chunk-type expansion (PRD-031 backlog).** The pattern Part 2 establishes — schema field with `.default([])`, chunking-service loop with `?? []`, renderer section, structured-signal-view section with hide-empty gate, chart-colours label entry — is the template for any future addition (`success_story`, `objection`, `risk`, `next_step`, etc.). Each future addition costs the same five-file change plus a prompt rule.
- **Schema-version migration.** If a future PRD ever needs to re-validate old `structured_json` rows against the schema, that PRD will need to handle `schemaVersion: 1` rows (which lack `positiveSignals`). Two approaches available: relax the literal to `z.union([z.literal(1), z.literal(2)])`, or write a one-shot migration that backfills the missing field. Out of scope for Part 2 — no current re-validation path exists.
- **Fancier Top Wins variants (PRD-031 backlog).** PRD-031 P2.R9 ships the minimum-viable Top Wins widget. Future variants — wins trend over time (multi-line chart), wins-by-client scatter, intensity-weighted ranking, "Recent Wins" qualitative quote stream — are deferred until enough real-workspace data exists to validate the right cuts. Part 2 ensures the data exists in `session_embeddings` and is filterable by `chunk_type = 'positive_signal'`, so future widgets are frontend-only additions on top of the existing `database-query` infrastructure (the `chunkTypes` filter on `top_themes` introduced by Increment 5 is reusable).

### Open Questions Deferred to Implementation

- **Severity-badge label wording.** The badge currently reads "low" / "medium" / "high" — works for pain but is awkward for positive ("low positivity" reads off). Options: keep as-is and rely on green-theming for semantic clarity; relabel to "mild" / "strong" / "emphatic" only for positive-variant. Defaulting to the simpler "keep as-is" pending user signal.
- **Positive-signal section placement.** Specced as between Pain Points and Must-Haves (current-state cluster). If user feedback during the rollout suggests it reads more naturally between Aspirations and Competitive Mentions, that's a one-line change to swap.

---

---

## Part 3: Looser Chat Response Limits

> Implements **P3.R1–P3.R6** from PRD-031.

**Status:** Stubbed. Detailed implementation plan to be filled in once Parts 1 and 2 ship and Part 3 begins.

### Forward-compatibility commitments inherited from Part 1

None. Part 3 touches `lib/prompts/chat-prompt.ts`, `lib/services/chat-stream-service.ts`, and observability around chat completions — no overlap with Part 1's scope.
