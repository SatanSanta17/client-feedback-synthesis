# TRD-026: Theme Deduplication

> **Status:** Drafting — Part 1 specified.
> **PRD:** `docs/026-theme-deduplication/prd.md` (approved)
> **Mirrors:** PRD Parts 1–4. Each part is written and reviewed one at a time. This document currently specifies Part 1; Parts 2–4 will be appended in subsequent revisions and must not regress the structures introduced here.

---

## Technical Decisions

These decisions apply across the PRD; Part 1 establishes the data foundation that the later parts compose against.

1. **Themes carry their own `embedding` column rather than reusing `session_embeddings`.** A theme is a workspace-level entity with a single canonical vector derived from its `name` + `description`. `session_embeddings` is keyed on `embedding_id` (chunks of session content) and has different semantics, lifecycle, and RLS shape. Reusing it would require either a discriminator column or a fake `session_id` — both leak abstraction. A dedicated column on `themes` keeps the model honest: a theme has-a embedding the way a session-chunk has-a embedding, but they are not the same row family.

2. **Vector dimension is fixed at `1536` to match the existing embedding pipeline.** `EMBEDDING_DIMENSIONS=1536` is the project-wide invariant (see TRD-019 §Part 1). The themes column hardcodes `vector(1536)` for the same reason `session_embeddings.embedding` does — Postgres requires a fixed dimension at column-creation time, and switching models requires a coordinated migration anyway. Reusing the pipeline means no new provider-resolution code, no new env vars for theme embedding, and the same retry/rate-limit machinery.

3. **HNSW index on `themes.embedding` from the start.** Part 1's prevention guard does not need an index (it loads all workspace themes into memory and computes cosine similarity in JS — see Decision 5). Part 2 (candidate generation) will need it once volume grows, and Part 3's recent-merges audit may want nearest-neighbor lookups. Adding the index now costs near-zero on a low-write table and removes a second migration when Part 2 lands. This matches the precedent set in TRD-019 §Part 1.

4. **Source text for theme embedding is `name\n\ndescription` (description coalesced to empty).** Two-line composition keeps the name dominant in the vector while folding in description context when present. A theme without a description still gets a meaningful embedding from its name alone. The exact format is encapsulated in a single helper (`buildThemeEmbeddingText`) so Part 2's candidate generation and the backfill script all use the identical composition — there is no second source of truth to drift.

5. **In-memory cosine similarity for Part 1 prevention; RPC reserved for Part 2.** During an extraction the orchestrator already loads every active theme via `themeRepo.getActiveByWorkspace()`. Augmenting that read to include the `embedding` column adds a single query payload, not a round trip per check. The prevention guard then computes cosine similarity in pure JS — O(N·D) per proposed theme where N≤a few thousand themes and D=1536. Round-trip count stays at one. Part 2's pair-generation across the full taxonomy may move to a `match_themes` RPC for efficiency on dense workspaces; that is an additive change, not a refactor.

6. **Conservative default threshold pinned at `0.92`, env-configurable.** The threshold is exposed as `THEME_PREVENTION_SIMILARITY_THRESHOLD` (default `0.92`) so it can be tuned from telemetry (P1.R4 logs the per-decision score). `0.92` is at the upper end of the "very confident match" band for OpenAI `text-embedding-3-small` on short labels — high enough that genuinely-distinct topics ("API Performance" vs "API Cost", which sit around 0.78–0.84 in our hand-curated sampling) are never collapsed, while close synonyms ("API Performance" vs "API Speed", typically 0.93–0.96) are caught. Bias is intentionally toward false-negatives per P1.R3; residual duplicates are absorbed by Part 2's curated merge surface.

7. **Forward-compatible `merged_into_theme_id` pointer added in Part 1's migration, even though writes happen in Part 3.** Per project rules ("data structures and interfaces should carry the shape that later parts will need"), we add the FK column now. Part 1 leaves it `NULL` everywhere; Part 3's merge transaction sets it on the archived row. Doing both column additions in a single migration avoids a second round of `ALTER TABLE themes` on a table that downstream queries already touch heavily.

8. **Prevention runs in a pure-function pre-pass, not inline inside the assignment loop.** Rather than embedding-and-checking each proposed theme one-at-a-time inside `resolveNewTheme`, the service collects all unique proposed-new theme texts before the loop, embeds them in one batch, runs in-memory similarity once, and resolves to a `Map<lowerName, ResolvedDecision>`. The main loop becomes a pure lookup. This is what makes P1.R5 (no perceptible latency) hold: one embedding API call per extraction, regardless of how many "new" themes the LLM proposes.

9. **Backfill is a one-shot `tsx` script, not an API route or migration step.** The backfill needs the project's TypeScript paths (`@/lib/...`), env vars, and the embedding pipeline — a SQL migration cannot call OpenAI. A new top-level `scripts/` directory holds one-off operational scripts; `backfill-theme-embeddings.ts` is the first inhabitant. The script is idempotent (it only embeds themes where `embedding IS NULL`) and safe to re-run. After backfill completes, a follow-up migration tightens `embedding` to `NOT NULL` so Part 2 can rely on the invariant.

---

## Part 1: Embedding-Based Prevention at Theme Creation

> Implements **P1.R1–P1.R6** from PRD-026.

### Overview

Add a vector embedding to every theme so that semantically equivalent names ("API Performance" vs "API Speed") collapse to the same row at extraction time. The change has three moving pieces:

1. **Schema** — new `embedding vector(1536)` column on `themes`, plus an HNSW index and the forward-compat `merged_into_theme_id` pointer for Part 3.
2. **Prevention guard** — a small, pure module (`lib/services/theme-prevention.ts`) that takes proposed-new theme texts + existing themes-with-embeddings and returns a resolution map of `proposedName → reuseExistingId | createNewWithEmbedding`. Wired into `assignSessionThemes` as a pre-pass before the existing assignment loop.
3. **Backfill** — a one-shot script (`scripts/backfill-theme-embeddings.ts`) that fills `embedding` for every pre-existing theme using the same pipeline, after which a follow-up migration sets the column `NOT NULL`.

The flow inside `assignSessionThemes` becomes:

```
existingThemes (with embeddings) ← themeRepo.getActiveByWorkspace()
proposedNew ← collect names from llmResponse.assignments where isNew=true and not in case-insensitive existingThemes map
resolutionMap ← runThemePrevention({ proposedNew, existingThemes, threshold })
   - for each proposed: cosine similarity vs existing; if ≥ threshold → matched theme id; else → new
   - emits one log line per proposed theme with score + decision
   - for "new" outcomes, attaches the freshly-computed embedding so create() persists it
main loop: replace old "create new theme" branch with resolutionMap.get(lowerName).resolve(...)
```

The single LLM call (the existing theme-assignment call) is unchanged — the LLM still proposes "new" vs "existing" classifications. The prevention guard is the layer that actually trusts or overrides those proposals.

### Forward Compatibility Notes

- **Part 2 (Platform-Suggested Merge Candidates):** Candidate generation will pair-wise compare every active theme's embedding against every other in the workspace. The `embedding` column populated here, plus the HNSW index, is the data substrate Part 2 reads. Part 2 introduces no new theme columns. The `THEME_CANDIDATE_SIMILARITY_THRESHOLD` (Part 2) will be lower than `THEME_PREVENTION_SIMILARITY_THRESHOLD` (Part 1) — same column, same units, different cutoffs.
- **Part 3 (Admin-Confirmed Theme Merge):** The `merged_into_theme_id` column is added in this part's migration; Part 3 sets it (and flips `is_archived`) inside the merge transaction. The `signal_themes.theme_id` re-point also happens in Part 3 — no schema change there. Part 3's forward-compat audit only needs to confirm the column exists.
- **Part 4 (Notify Affected Users of Merges):** Part 4 emits `theme.merged` events into the PRD-029 notification primitive. No theme-table change. The `merged_into_theme_id` pointer set in Part 3 is what Part 4's "recently merged" widget indicator (P4.R2) reads.
- **Backlog (per-workspace tunable threshold):** `THEME_PREVENTION_SIMILARITY_THRESHOLD` is a global env var today. A per-workspace override would land as a column on `teams` (or the personal-workspace equivalent on `profiles`). The threshold reading is centralised in `theme-prevention.ts` — exactly one place to change.
- **Backlog (LLM-judged candidate filtering):** The prevention guard's output shape (`ResolvedDecision = { kind: 'reuse', themeId, score } | { kind: 'new', embedding }`) is the contract. A future second-pass LLM judge would slot in between the similarity check and the final decision, narrowing `reuse` proposals. No interface change required outside the guard.

### Database Changes

#### Migration: `001-add-themes-embedding.sql`

```sql
-- ============================================================
-- PRD-026 Part 1: Embedding-based prevention on themes
-- ============================================================

-- P1.R1: vector embedding column on themes.
-- Nullable during rollout; tightened to NOT NULL in 002 after backfill.
ALTER TABLE themes
  ADD COLUMN embedding vector(1536);

-- P3.R4 forward-compat: pointer from archived theme → canonical theme.
-- Populated in Part 3's merge transaction; NULL for all rows until then.
ALTER TABLE themes
  ADD COLUMN merged_into_theme_id UUID
    REFERENCES themes(id) ON DELETE SET NULL;

-- P1.R5 / Part 2 forward-compat: HNSW index for cosine similarity.
-- Built once now; Part 2's candidate generation reads through it.
CREATE INDEX themes_embedding_hnsw_idx
  ON themes
  USING hnsw (embedding vector_cosine_ops);

-- Index supporting Part 3's audit-log query ("recent merges target X")
-- and the merged-pointer joins. Cheap and forward-compatible.
CREATE INDEX themes_merged_into_theme_id_idx
  ON themes (merged_into_theme_id)
  WHERE merged_into_theme_id IS NOT NULL;
```

**Why hardcoded `vector(1536)`:** Postgres requires a fixed dimension at column-creation time. `1536` is the project-wide invariant set by `EMBEDDING_DIMENSIONS` and the existing `session_embeddings.embedding(1536)` column. Changing the embedding model dimension is a coordinated migration that re-embeds every theme and every session chunk together — a single column type change here is the right unit.

**Why nullable initially:** The column is added to a populated table; `NOT NULL` would require a `DEFAULT` that we can't supply (we don't have a meaningful zero-vector for a real embedding). Standard 3-step pattern: add nullable → backfill via script → tighten to `NOT NULL`.

**Why no `embedding_updated_at` column:** Embeddings are derived from `name` + `description`. If those change, the embedding must be regenerated — but Part 1 does not introduce a UI to edit theme name/description, and AI-created themes are write-once in practice. A future "rename theme" feature will regenerate the embedding inline. Adding a tracking column now would be unused metadata; defer to that future feature.

#### Migration: `002-tighten-themes-embedding-not-null.sql`

```sql
-- ============================================================
-- PRD-026 Part 1: Run AFTER backfill script completes successfully.
-- Tightens the embedding column so Part 2 can rely on the invariant.
-- ============================================================

ALTER TABLE themes
  ALTER COLUMN embedding SET NOT NULL;
```

**Why a separate file:** Forces deliberate ordering during rollout — the backfill script runs between `001` and `002`. Bundling them would either fail (if the script hasn't run) or silently leave nullable rows.

#### RLS: no change

Existing `themes` RLS policies (TRD-021 §Part 1) are column-agnostic — they govern row visibility, not which columns are readable. The new columns inherit the same access rules. No policy edit required.

### Type and Schema Changes

#### `lib/types/theme.ts`

Extend the `Theme` domain type with `embedding` and `mergedIntoThemeId` (the latter unused by Part 1 but defined now to lock the contract):

```typescript
export interface Theme {
  id: string;
  name: string;
  description: string | null;
  teamId: string | null;
  initiatedBy: string;
  origin: "ai" | "user";
  isArchived: boolean;
  embedding: number[] | null;        // Part 1: required after backfill; nullable in domain type until then
  mergedIntoThemeId: string | null;  // Part 3 writes; Part 1 always reads as null
  createdAt: string;
  updatedAt: string;
}
```

**Why `number[] | null` and not `number[]`:** During the rollout window between migration `001` and migration `002`, rows can briefly have `embedding IS NULL`. The domain type reflects the database honestly. After `002` lands, callers can treat `null` as a hard error — but the type signals that the invariant is post-rollout, not from-day-one. Once Part 1 ships and the column is `NOT NULL`, we can tighten the type in a one-line follow-up; deferring that tightening avoids a chicken-and-egg with the backfill script.

#### `lib/repositories/theme-repository.ts`

```typescript
export interface ThemeInsert {
  name: string;
  description: string | null;
  team_id: string | null;
  initiated_by: string;
  origin: "ai" | "user";
  embedding: number[] | null;  // Part 1: callers must supply; backfill path uses updateEmbedding()
}

export interface ThemeUpdate {
  name?: string;
  description?: string | null;
  is_archived?: boolean;
  embedding?: number[];  // Backfill + future "rename theme regenerates embedding"
}

export interface ThemeRepository {
  /** Fetch all active themes with their embeddings. Used both by extraction
   *  (prevention guard) and by Part 2 (candidate generation). */
  getActiveByWorkspace(teamId: string | null, userId: string): Promise<Theme[]>;

  /** Fetch themes (any state) where embedding IS NULL. Backfill consumer. */
  listMissingEmbeddings(): Promise<Theme[]>;

  getById(id: string): Promise<Theme | null>;
  findByName(name: string, teamId: string | null, userId: string): Promise<Theme | null>;
  create(data: ThemeInsert): Promise<Theme>;
  update(id: string, data: ThemeUpdate): Promise<Theme>;

  /** Backfill-only: write embedding to an existing row. Distinct from
   *  update() so the backfill script's intent is explicit at the call site. */
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
}
```

**Why `getActiveByWorkspace` keeps the same name and now returns embeddings:** Every existing caller already wants `Theme[]`; the embedding is a column on the same row. Returning it is a single `select("*")` change. Adding a second method (`getActiveWithEmbeddingsByWorkspace`) would either force every caller to migrate or leave two methods doing nearly the same thing — both worse than tightening the existing one.

**Why `listMissingEmbeddings()` is a dedicated method:** The backfill script's intent is "find rows that need work" — a read pattern that no other caller has. Encoding it as a method (instead of a generic filter) keeps the SQL in the repository and the script cohesive.

**Why a separate `updateEmbedding()` method instead of `update({ embedding })`:** The general `update()` accepts a partial domain shape and is used by future theme-management UIs. A backfill that mass-writes one column is operationally distinct: it bypasses any auditing/triggers we might attach to general updates later. Splitting them now leaves room for that without a refactor.

#### `lib/repositories/supabase/supabase-theme-repository.ts`

- `mapRow` extends to read `embedding` (parsed from pgvector text representation into `number[]`) and `merged_into_theme_id`.
- `getActiveByWorkspace` selects `*` (already does) — pgvector columns serialize as JSON arrays through PostgREST; no select-list change required.
- `findByName` and `getById` likewise return the embedding via the existing `*` select.
- `create` writes the new `embedding` field. PostgREST accepts `number[]` for `vector` columns.
- `listMissingEmbeddings` uses `.is("embedding", null)` and is **not** workspace-scoped (the script runs with the service-role client across all workspaces, by design).
- `updateEmbedding` issues `update({ embedding })` and is the only method in this repo that does so.

All existing log lines (`[supabase-theme-repo] …`) carry through unchanged.

### Service Changes

#### New: `lib/services/theme-prevention.ts`

Pure module. No DB calls, no LLM calls except the embedding generation it owns. Single public function:

```typescript
import { embedTexts } from "@/lib/services/embedding-service";
import type { Theme } from "@/lib/types/theme";

const DEFAULT_THRESHOLD = 0.92;

export interface ProposedNewTheme {
  name: string;
  description: string | null;
}

export type PreventionDecision =
  | { kind: "reuse"; themeId: string; matchedName: string; score: number }
  | { kind: "new"; embedding: number[]; score: number | null };

export interface PreventionResult {
  /** Keyed by lowercased proposed name. */
  decisions: Map<string, PreventionDecision>;
}

/**
 * Builds the canonical text used to embed a theme. The single source of truth —
 * Part 2's candidate generation and the backfill script must use this helper.
 */
export function buildThemeEmbeddingText(name: string, description: string | null): string {
  return `${name}\n\n${description ?? ""}`.trim();
}

/**
 * Decides, for each proposed-new theme, whether it should reuse an existing
 * theme or be created fresh. Logs every decision with score + matched name.
 *
 * Inputs:
 *   - proposed: names+descriptions the LLM marked isNew=true and that don't exist
 *               in the workspace (case-insensitive). Caller (theme-service) handles
 *               the exact-name fast path before calling here (P1.R6).
 *   - existing: themes already in the workspace, with embeddings populated.
 *               Themes with embedding=null are skipped (rollout window).
 *   - threshold: cosine similarity above which a match wins. Defaults from env.
 *
 * Returns a map keyed by lowercased proposed name. Caller uses the map inside
 * the assignment loop instead of re-running the comparison per signal.
 */
export async function runThemePrevention(input: {
  proposed: ProposedNewTheme[];
  existing: Theme[];
  sessionId: string;
  threshold?: number;
}): Promise<PreventionResult> {
  // 1. Read threshold (env override → default).
  // 2. Filter existing → only those with embeddings populated.
  // 3. Embed proposed texts in one batch via embedTexts().
  // 4. For each proposed: max cosine similarity vs existing.
  //    - if max ≥ threshold → kind: 'reuse', themeId of argmax
  //    - else → kind: 'new' carrying the just-computed embedding
  // 5. console.log one line per decision: proposed name, matched name|none,
  //    score, decision. Also log per-call summary (proposed N, reused K, new M).
}
```

**Why the embedding for "new" outcomes is returned in the decision:** Avoids a second embedding call when the caller goes to persist the new theme. The vector that just lost the threshold race is the same vector the new row will store.

**Why this lives in its own file (not inside `theme-service.ts`):** SRP. `theme-service.ts` is already long and orchestrates the full assignment flow. The prevention guard is a focused piece (similarity math + logging) that Part 2's candidate generator will also import — splitting it now means Part 2 doesn't have to re-extract.

**Cosine similarity helper:** Implemented inline in `theme-prevention.ts` as a private function. The function is ~10 lines (`dot(a,b) / (norm(a)*norm(b))`) and used nowhere else. If a second call site emerges later, promote to `lib/utils/vector-math.ts`. Don't pre-extract.

#### Updated: `lib/services/theme-service.ts`

Two surgical changes inside `assignSessionThemes`:

**(a) Pre-pass before the assignment loop (P1.R5 — single embedding call per extraction):**

```typescript
// After fetching existingThemes, before the assignment loop:
const proposedNew = collectProposedNewThemes(llmResponse, themeByLowerName);
//   ^ filters llmResponse.assignments where isNew=true and lowerName not in cache

const prevention = await runThemePrevention({
  proposed: proposedNew,
  existing: existingThemes,
  sessionId,
});
```

**(b) Inside the loop, the `if (isNew)` branch consults the resolution map first:**

```typescript
if (isNew) {
  const lowerName = themeName.toLowerCase();
  const cached = themeByLowerName.get(lowerName);
  if (cached) {                        // P1.R6 exact-name fast path (already present)
    resolvedThemeId = cached.id;
    existingThemesUsed++;
  } else {
    const decision = prevention.decisions.get(lowerName);
    if (decision?.kind === "reuse") {  // P1.R2 prevention won
      resolvedThemeId = decision.themeId;
      existingThemesUsed++;
      // themeByLowerName cache update so subsequent iterations short-circuit.
    } else {
      // decision.kind === "new" — carry the precomputed embedding into create().
      resolvedThemeId = await resolveNewTheme({
        themeName,
        description: description ?? null,
        teamId,
        userId,
        themeRepo,
        themeByLowerName,
        embedding: decision?.embedding ?? null,
      });
      newThemesCreated++;
    }
  }
}
```

**`resolveNewTheme` signature gains an `embedding` parameter** that it forwards into `ThemeInsert`. The unique-constraint fallback (`findByName`) path is unchanged — if a concurrent insert wins, we resolve to that row and discard our embedding (the winning row's embedding stands). This is correct: both vectors describe the same name+description, so either is fine.

**Helper extracted: `collectProposedNewThemes(llmResponse, themeByLowerName)`** — a pure function that walks the LLM response and returns a deduplicated `ProposedNewTheme[]`. Lives at the bottom of `theme-service.ts` next to `resolveNewTheme`. Testable in isolation, keeps `assignSessionThemes` linear.

#### Updated: `lib/prompts/theme-assignment.ts` — bias toward umbrella names when creating new themes

A prompt-only addition that complements the embedding guard: if the LLM picks the umbrella name on the *first* extraction that surfaces a topic, no near-duplicate ever gets proposed and the embedding guard never has to fire. This is cheap (a few sentences in the system prompt, no runtime cost) and stacks with the embedding layer — the LLM is the first line of defense, the embedding guard is the backstop.

The risk is over-generalization (collapsing distinct concerns into a mega-theme), so the addition has to be *directional*, not a blanket "be more general." Existing Rule 8 already forbids "too broad" and "too narrow" — it stays. We strengthen Rule 8's examples and add a new Rule 9 that gives the LLM concrete pairs to imitate.

**Edit Rule 8 in `THEME_ASSIGNMENT_SYSTEM_PROMPT`** — extend the existing examples so "too broad" and "too narrow" are unambiguous:

```
8. Do not create themes that are too broad ("General Feedback", "Performance",
   "API") or too narrow ("Button Color on Page 3", "API Speed In Reports Tab").
   Aim for a level of specificity that would be useful for tracking trends
   across multiple sessions.
```

**Add a new Rule 9** immediately after Rule 8:

```
9. When proposing a NEW theme, prefer an umbrella name that would also fit
   closely-related future signals on the same topic, over a name that
   describes only this specific signal. Examples:
   - "API calls are slow during peak hours" → "API Performance"
     (NOT "API Speed", "API Latency", "Slow API During Peak")
   - "Onboarding takes too long for new users" → "Onboarding Friction"
     (NOT "Slow Onboarding", "Onboarding Time")
   - "We need bulk CSV export" → "Data Export"
     (NOT "CSV Export Feature", "Bulk Export")
   The goal is that a related signal arriving next month ("API timing out",
   "API rate-limit issues") matches your theme from the existing-theme list
   instead of spawning a near-duplicate. BUT do not generalize across
   genuinely distinct concerns: "API Performance" and "API Cost" stay
   separate; "Onboarding Friction" and "Onboarding Documentation" stay
   separate. The umbrella covers variations of the SAME topic, not
   different topics that share a word.
```

**No code change beyond the string edit.** `buildThemeAssignmentUserMessage` and `THEME_ASSIGNMENT_MAX_TOKENS` are unchanged. The prompt is still version-controlled (per architecture rule "prompts live in `lib/prompts/` as named exports") and any future tuning is a one-file edit.

**Why both layers, not just one:**
- Prompt-only: cheap, but model can ignore the guidance — especially when the existing-theme list is empty (cold-start workspace) and there's no pressure to reuse.
- Embedding-only: precise, but every "API Speed" → "API Performance" collapse costs an embedding round trip and risks a near-miss below threshold.
- Both: the prompt biases first-time creation toward umbrellas (catches the cold-start case the embedding guard cannot help with), and the embedding guard catches synonyms the LLM still proposes despite the bias. Failures of one layer are absorbed by the other.

**Logging additions (P1.R4):**

The existing `[theme-service]` log block already records totals. Add one line per prevention decision (emitted by `runThemePrevention` itself, not the service) so a single grep on `[theme-prevention] decision` returns the dataset for threshold tuning. Format:

```
[theme-prevention] decision — sessionId: <id> | proposed: "API Speed" | matched: "API Performance" | score: 0.937 | result: reuse
[theme-prevention] decision — sessionId: <id> | proposed: "Custom Reports Export" | matched: none | score: 0.71 | result: new
```

The bracketed prefix is distinct from `[theme-service]` so log dashboards can pin alerts on the prevention layer specifically.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/026-theme-deduplication/001-add-themes-embedding.sql` | **Create** | Migration — embedding column, merged-into pointer, HNSW index |
| `docs/026-theme-deduplication/002-tighten-themes-embedding-not-null.sql` | **Create** | Migration — runs after backfill, sets `embedding` NOT NULL |
| `lib/types/theme.ts` | Modify | `Theme` gains `embedding`, `mergedIntoThemeId` |
| `lib/types/database.ts` (Supabase generated) | Regenerate | Reflect `themes.embedding`, `themes.merged_into_theme_id` |
| `lib/repositories/theme-repository.ts` | Modify | `ThemeInsert.embedding`, `ThemeUpdate.embedding`, `listMissingEmbeddings()`, `updateEmbedding()` |
| `lib/repositories/supabase/supabase-theme-repository.ts` | Modify | `mapRow` reads embedding + merged-into; new `listMissingEmbeddings`, `updateEmbedding` |
| `lib/services/theme-prevention.ts` | **Create** | `runThemePrevention()`, `buildThemeEmbeddingText()`, cosine helper |
| `lib/services/theme-service.ts` | Modify | Pre-pass invocation, `collectProposedNewThemes` helper, `resolveNewTheme` carries embedding |
| `lib/prompts/theme-assignment.ts` | Modify | Strengthen Rule 8 examples; add Rule 9 biasing new themes toward umbrella names |
| `scripts/backfill-theme-embeddings.ts` | **Create** | One-shot script: fetch missing-embedding themes → embed → write back |
| `ARCHITECTURE.md` | Modify | `themes` schema entry adds `embedding` + `merged_into_theme_id`; file map gains `theme-prevention.ts` and `scripts/` |
| `CHANGELOG.md` | Modify | PRD-026 Part 1 entry |

### Implementation

#### Increment 1.1 — Migration: add embedding column, pointer, and HNSW index

**What:** Land migration `001-add-themes-embedding.sql` against the Supabase instance. Adds the `embedding` column (nullable), the `merged_into_theme_id` FK, and the HNSW + pointer indexes.

**Steps:**

1. Create `docs/026-theme-deduplication/001-add-themes-embedding.sql` with the SQL from the migration section above.
2. Apply it to Supabase (SQL editor, dev project first then prod).
3. Regenerate Supabase types: `npx supabase gen types typescript --project-id <id> > lib/types/database.ts` and commit.
4. Update `Theme` in `lib/types/theme.ts` with `embedding: number[] | null` and `mergedIntoThemeId: string | null`.
5. Update `mapRow` in `supabase-theme-repository.ts` to read both columns.

**Verification:**

1. `\d themes` (or PostgREST introspection) shows `embedding vector(1536)` and `merged_into_theme_id uuid`.
2. `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'themes';` shows `themes_embedding_hnsw_idx` and `themes_merged_into_theme_id_idx`.
3. `SELECT count(*) FROM themes WHERE embedding IS NULL;` equals total theme count (no rows have embeddings yet).
4. `npx tsc --noEmit` passes after the type updates.
5. Existing extraction flow still works end-to-end on a dev session — themes that get assigned via the unchanged code path land in the DB with `embedding = NULL` and assignment behaviour is identical to pre-migration.

**Post-increment:** None. ARCHITECTURE.md update is deferred to the end-of-part audit so it captures the complete shape post-backfill.

---

#### Increment 1.2 — Repository: extend `ThemeRepository` for embeddings

**What:** Add `listMissingEmbeddings()` and `updateEmbedding()` to the interface and Supabase adapter. Extend `ThemeInsert`/`ThemeUpdate` to carry `embedding`. Update `create` and `mapRow` accordingly.

**Steps:**

1. Edit `lib/repositories/theme-repository.ts`:
   - Add `embedding: number[] | null` to `ThemeInsert`.
   - Add `embedding?: number[]` to `ThemeUpdate`.
   - Add `listMissingEmbeddings(): Promise<Theme[]>` and `updateEmbedding(id, embedding): Promise<void>` to the interface.
2. Edit `lib/repositories/supabase/supabase-theme-repository.ts`:
   - Implement `listMissingEmbeddings()` — `select("*").is("embedding", null)`. No workspace scoping (service-role, all workspaces).
   - Implement `updateEmbedding(id, embedding)` — `update({ embedding }).eq("id", id)`.
   - `create()` passes through the new `embedding` field.
   - `mapRow()` reads `row.embedding` and `row.merged_into_theme_id`.
3. Existing call sites (`assignSessionThemes`, `resolveNewTheme`) compile-error because `ThemeInsert.embedding` is required. Pass `embedding: null` at every existing call site as a temporary stub — they will be filled with real embeddings in Increment 1.3.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Existing extraction still runs end-to-end on a dev session; new themes are created with `embedding = NULL` (same as Increment 1.1 — Increment 1.3 is what populates them).
3. Quick repository sanity script (or REPL): `await repo.listMissingEmbeddings()` returns the full theme set; `await repo.updateEmbedding(<id>, [0.1, 0.2, ...])` writes successfully and a subsequent `getById` returns the embedding intact.

**Post-increment:** None.

---

#### Increment 1.3 — Prevention guard + integrate into `assignSessionThemes`

**What:** Create `lib/services/theme-prevention.ts`, wire it into `theme-service.ts` as a pre-pass, and have `resolveNewTheme` persist the embedding when creating new themes.

**Steps:**

1. Create `lib/services/theme-prevention.ts`:
   - `buildThemeEmbeddingText(name, description)` exported.
   - Private `cosineSimilarity(a, b)` (10-line helper).
   - `runThemePrevention()` exported per the signature in §Service Changes.
   - Reads `THEME_PREVENTION_SIMILARITY_THRESHOLD` env var; falls back to `0.92`.
   - Skips comparison against existing themes whose `embedding` is `null` (rollout-window safety).
   - Logs per-decision and summary lines under `[theme-prevention]` prefix.
2. Edit `lib/services/theme-service.ts`:
   - Import `runThemePrevention`, `buildThemeEmbeddingText`, types.
   - After `existingThemes` is loaded and `themeByLowerName` is built, compute `proposedNew` via a new `collectProposedNewThemes` helper at the bottom of the file.
   - Call `runThemePrevention({ proposed: proposedNew, existing: existingThemes, sessionId })`.
   - In the `isNew` branch of the assignment loop, consult `prevention.decisions` per the snippet in §Service Changes. Update `themeByLowerName` cache when a `reuse` decision resolves so later iterations don't re-resolve.
   - `resolveNewTheme` accepts a new `embedding: number[] | null` parameter and forwards it into `ThemeInsert`. The concurrent-insert fallback path passes through unchanged.
3. Remove the `embedding: null` stub from any place where Increment 1.2 stubbed it — it now flows from the prevention decision (or `null` if the decision is missing, e.g., LLM proposed a theme that ended up matching the in-batch cache).
4. Edit `lib/prompts/theme-assignment.ts` per §Service Changes: extend Rule 8's examples and add Rule 9 (umbrella-name bias). No code changes beyond the prompt string. The change applies on the next extraction since the prompt is read at call time.

**Verification:**

1. `npx tsc --noEmit` passes.
2. **Manual extraction test (P1.R2):** in a dev workspace seeded with one theme `"API Performance"` (with embedding backfilled — see Increment 1.4 for backfill, or seed via `updateEmbedding` directly), run an extraction whose chunks would force the LLM to propose `"API Speed"` as new. Confirm:
   - The new session's `signal_themes` rows point at `"API Performance"`'s id.
   - No new theme row was created (`SELECT count(*) FROM themes WHERE name ILIKE 'API Speed'` returns 0).
   - Logs show `[theme-prevention] decision — proposed: "API Speed" | matched: "API Performance" | score: <≥0.92> | result: reuse`.
3. **Distinct-themes test (P1.R3):** run an extraction where the LLM proposes `"API Cost"` against an existing `"API Performance"`. Confirm `result: new` in logs and a new theme row is created with `embedding` populated.
4. **Fast-path test (P1.R6):** instrument or temporarily log a counter inside `runThemePrevention` indicating how many proposed names were embedded. Run an extraction where the LLM proposes the exact name of an existing theme as `isNew=true`. Confirm the proposed name was filtered out before reaching `runThemePrevention` (zero embeddings generated for it). Remove the counter after verification.
5. **Latency check (P1.R5):** compare `chain timing — themes:` log values across 10 extractions before this increment vs 10 after on the same workspace. Median delta should be at most one embedding-batch round trip (≈100–300 ms). If higher, investigate before merging.
6. **Prompt umbrella-bias spot check:** on a clean dev workspace (zero existing themes), run an extraction whose chunks include "API calls are slow" and "onboarding is taking forever." Confirm the LLM proposes umbrella names ("API Performance", "Onboarding Friction") rather than narrow names ("API Speed", "Slow Onboarding"). If it consistently proposes narrow names, tune Rule 9 — over-narrow naming on cold-start is the failure mode this addition exists to prevent.
6. New themes created in this run write `embedding` correctly: `SELECT id, name, embedding IS NOT NULL FROM themes WHERE created_at > now() - interval '5 minutes';` returns `true` for every row.

**Post-increment:** None. ARCHITECTURE update batched in audit increment.

---

#### Increment 1.4 — Backfill script + run

**What:** Write `scripts/backfill-theme-embeddings.ts`, execute it against dev then prod, then apply migration `002` to set `embedding NOT NULL`.

**Steps:**

1. Create top-level `scripts/` directory.
2. Create `scripts/backfill-theme-embeddings.ts`:
   - Loads env via `dotenv` (or relies on `tsx` + Next's env loader — pick whichever the project already uses for one-off tooling; if none, install `dotenv` as a dev dep).
   - Constructs a service-role Supabase client.
   - Constructs `themeRepo = createThemeRepository(serviceClient, /* teamId */ null)` — the `teamId` argument is irrelevant for `listMissingEmbeddings` since the script is workspace-agnostic.
   - Fetches `themeRepo.listMissingEmbeddings()`.
   - Builds the embedding texts via `buildThemeEmbeddingText` (the same helper Part 1's prevention uses — single source of truth).
   - Calls `embedTexts(texts)` to embed in batches (the embedding service already paces requests).
   - For each result, `themeRepo.updateEmbedding(theme.id, embedding)`.
   - Logs progress: `[backfill] N themes missing embeddings`, `[backfill] processed K/N`, `[backfill] done` with elapsed ms.
   - Idempotent: re-running after partial failure picks up only still-`NULL` rows.
3. Add a one-line npm script entry: `"backfill:theme-embeddings": "tsx scripts/backfill-theme-embeddings.ts"`.
4. **Run on dev:** `npm run backfill:theme-embeddings`. Verify `SELECT count(*) FROM themes WHERE embedding IS NULL;` returns 0.
5. **Smoke prevention with backfilled data:** repeat the manual prevention test from Increment 1.3 — themes that pre-existed now win matches.
6. **Run on prod** during a low-traffic window. Watch logs for OpenAI errors; the script's batching + retry already handles transient 429s via `embedTexts`.
7. Create `docs/026-theme-deduplication/002-tighten-themes-embedding-not-null.sql` and apply it.
8. Regenerate Supabase types if the nullability change is reflected in generated types; commit.
9. Optionally tighten the domain type: `Theme.embedding: number[]` (drop `| null`) and `ThemeInsert.embedding: number[]` (required) in a follow-up commit. This can also be batched into the audit increment.

**Verification:**

1. `SELECT count(*) FROM themes WHERE embedding IS NULL;` returns 0 in prod.
2. Migration `002` applied; attempting to insert a theme with `embedding = NULL` now fails at the DB.
3. `npx tsc --noEmit` passes after type tightening.
4. End-to-end extraction on prod-like data still works; prevention logs show the expected decisions on real synonym pairs that previously slipped through.

**Post-increment:** None. ARCHITECTURE/CHANGELOG batched in audit.

---

#### Increment 1.5 — End-of-part audit

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report.

**Checklist:**

1. **SRP:** confirm `theme-prevention.ts` does only "decide reuse vs new for a batch of proposed themes." If similarity-math helpers grow beyond cosine, extract to `lib/utils/vector-math.ts`. If logging grows complex, factor a `logDecision` helper.
2. **DRY:** `buildThemeEmbeddingText` is the only place composing "name + description" for embedding purposes. Search for any other concat that recomputes the same thing — there should be none. Same for the cosine helper.
3. **Design tokens / styling:** N/A (no UI in Part 1).
4. **Logging:** every new code path emits entry/exit/error lines under `[theme-prevention]`, `[theme-service]`, or `[supabase-theme-repo]`. The backfill script logs progress and totals. No silent catches.
5. **Dead code:** stub `embedding: null` calls inserted in Increment 1.2 are all replaced by Increment 1.3. No commented-out code, no unused imports.
6. **Convention compliance:** named exports only; kebab-case filenames; UPPER_SNAKE for env var; PascalCase for types; helper hooks/functions follow the project's import order rule.
7. **Type tightening:** if Increment 1.4 deferred the `embedding: number[]` (non-null) tightening, do it now. Run `npx tsc --noEmit`.
8. **ARCHITECTURE.md:**
   - `themes` schema section: add `embedding` (`vector(1536)`, NOT NULL post-rollout) and `merged_into_theme_id` (`UUID FK → themes`, nullable, set by Part 3).
   - File map: add `lib/services/theme-prevention.ts` under services; add `scripts/backfill-theme-embeddings.ts` (and the `scripts/` directory if listed).
   - Implementation status line: append "PRD-026 Part 1 (Embedding-Based Prevention at Theme Creation) implemented".
   - Indexes line for `themes`: add `themes_embedding_hnsw_idx`, `themes_merged_into_theme_id_idx`.
9. **CHANGELOG.md:** add a PRD-026 Part 1 entry summarising: themes carry embeddings; new prevention guard short-circuits semantic duplicates at extraction time; backfill of pre-existing themes; threshold env var.
10. **Verify file references in docs still resolve:** `grep -F "lib/services/theme-prevention.ts" ARCHITECTURE.md` returns the new entry; `grep -F "scripts/backfill-theme-embeddings.ts"` likewise.
11. **Re-run flows touched by Part 1:**
    - Capture → AI extraction → background chain → assignments persist with prevention behaviour.
    - Re-extraction (PUT /api/sessions/[id]) → embeddings re-created → themes re-assigned (cascade + prevention both still hold).
    - Dashboard theme widgets render unchanged (`themes`/`signal_themes` shape unchanged from their perspective).
12. **Final:** `npx tsc --noEmit`.

This audit closes Part 1.

---

## Part 2: Platform-Suggested Merge Candidates

> Implements **P2.R1–P2.R7** from PRD-026.

### Overview

Surface a workspace-scoped, ranked list of theme pairs that look like duplicates so admins can review (and dismiss or merge) without auditing the whole taxonomy. Five moving pieces:

1. **Schema** — two new tables (`theme_merge_candidates`, `theme_merge_dismissals`) and a new RPC (`find_theme_candidate_pairs`) that walks active themes pairwise and returns those above the candidate-similarity threshold.
2. **Service** — `theme-candidate-service.ts` owns three operations: `refreshCandidates(workspaceCtx)` rebuilds the candidate set for a workspace; `listCandidates(workspaceCtx, options)` reads the persisted set ordered by composite score (excluding dismissed pairs); `dismissCandidate(workspaceCtx, pairId, userId)` records the admin's "not a duplicate" judgment.
3. **API routes** — `GET /api/themes/candidates`, `POST /api/themes/candidates/refresh`, `POST /api/themes/candidates/[id]/dismiss`, plus a `GET /api/cron/refresh-theme-candidates` invoked daily by Vercel cron to keep the list fresh without page-load cost.
4. **UI** — admin-only `/settings/themes` page that lists candidates with the per-side stats P2.R3 demands (assignment count, distinct sessions, distinct clients), the similarity score, and a token-based "shared keywords" hint. "Refresh" and "Dismiss" are wired in Part 2; the "Merge" button is a placeholder Part 3 wires.
5. **Nav gating** — sidebar's settings cluster gains a "Themes" entry visible only to admins/owners; `/settings/themes` itself returns 403 if reached directly by non-admins.

The flow on the admin's first visit:

```
GET /settings/themes
   → page server-component checks role → renders client component
   → client fetches GET /api/themes/candidates
   → server reads persisted theme_merge_candidates ⨝ themes (for current name+description)
   → returns top N ordered by combined_score, excluding dismissals
Click "Dismiss" on a row
   → POST /api/themes/candidates/[id]/dismiss
   → server inserts into theme_merge_dismissals + deletes from candidates table
   → client optimistically removes the row
Click "Refresh"
   → POST /api/themes/candidates/refresh
   → server runs theme-candidate-service.refreshCandidates()
   → client re-fetches the list
Background (no admin click)
   → Vercel cron hits /api/cron/refresh-theme-candidates daily
   → iterates every workspace with ≥ 2 active themes
   → calls refreshCandidates() per workspace
```

### Forward Compatibility Notes

- **Part 3 (Admin-Confirmed Theme Merge):** Reads the same `theme_merge_candidates` rows surfaced here. The merge transaction sets `themes.merged_into_theme_id` (column already added in Part 1's migration), flips `is_archived`, re-points `signal_themes.theme_id`, and deletes the now-resolved candidate row. No schema change introduced here is incompatible — the candidates row carries everything Part 3's merge dialog needs (similarity, signal counts, distinct sessions/clients).
- **Part 4 (Notify Affected Users):** The merge action emits a `theme.merged` event into PRD-029's notification primitive. Part 2 is read-only on the merge side — it does not emit anything. The `theme.merged` event type is already registered in `lib/notifications/events.ts` from PRD-029 Part 1.
- **Backlog (LLM-judged candidate filtering):** A second-pass LLM judge slots in between similarity computation and persistence in `refreshCandidates`. The service's input/output contract (`workspaceCtx → void`) doesn't change; only the body grows a filtering step that consumes the in-memory candidate list before the bulk insert.
- **Backlog (true background cron):** The original TRD specced a Vercel cron sweeping every workspace daily; revised to stale-on-mount in Increment 2.6 to avoid burning compute on workspaces no admin will visit. If telemetry shows admins routinely see day-old data because they don't re-open the surface (or workspace traffic patterns make first-visit refresh feel slow), reinstate a Vercel cron at `app/api/cron/refresh-theme-candidates/route.ts` with `CRON_SECRET`-gated authentication and `Promise.allSettled` over workspaces with `≥ 2` active themes. Schedule pin: `0 3 * * *` UTC. The service contract (`refreshCandidates`) does not change.
- **Backlog (per-workspace tunable threshold):** `THEME_CANDIDATE_SIMILARITY_THRESHOLD` is a global env var. A per-workspace override would land as a column on `teams` (mirroring the prevention-threshold backlog item from Part 1). Threshold reading is centralised in `theme-candidate-service.ts`.
- **Backlog (bulk dismiss / bulk merge):** The repository's `dismiss` is currently per-pair. Adding a `bulkDismiss(pairIds[])` method is an additive interface change with no schema impact.

### Technical Decisions

Continuing the numbering from Part 1's decisions.

10. **Candidate set is persisted, not computed-on-page-load.** Two reasons: (a) page-load latency stays a single read against an indexed table, no per-visit pairwise math; (b) the daily background refresh writes to the same store the on-demand refresh does, so the surface is always backed by a coherent snapshot regardless of which path produced it. Computing on every load would double the cost on hot workspaces and make the admin's "is this even loading?" experience flaky.

11. **Pair ordering is normalized at the schema level (`theme_a_id < theme_b_id`).** A `CHECK` constraint on the candidates table enforces lexicographic ordering of UUIDs in every row. This makes (A, B) and (B, A) literally the same row and lets the unique index be straightforward (`UNIQUE (theme_a_id, theme_b_id, scope)` instead of `UNIQUE (LEAST(...), GREATEST(...), scope)` which Postgres allows but is fiddly to read). The same constraint applies to the dismissals table — dismissing (A, B) covers the same pair under any iteration order.

12. **Composite score with pinned weights, not equal averaging.** P2.R2 explicitly requires that a high-similarity-low-volume pair sit *below* a merely-good-similarity-heavy-volume pair. Equal weighting (33/33/33) doesn't achieve that. The TRD pins:
    - `similarity_score` = raw cosine similarity (already 0..1)
    - `volume_score` = `log10(total_assignments_across_both + 1) / log10(MAX_VOLUME_NORM + 1)` clamped to `[0, 1]`. Default `MAX_VOLUME_NORM = 200` (so a pair touching 200+ signals saturates).
    - `recency_score` = `exp(-days_since_most_recent_assignment / 30)` — `1.0` today, `~0.37` at 30 days, `~0.05` at 90 days.
    - `combined_score = 0.5 * similarity + 0.3 * volume + 0.2 * recency`
    Worked example — pair A (sim=0.95, vol=0.10, rec=0.05) vs pair B (sim=0.82, vol=0.85, rec=0.95): A scores 0.515, B scores 0.847. B wins, matching P2.R2's intent. The raw scores are stored alongside `combined_score` so the UI can display similarity directly and the admin can re-sort if they prefer "by similarity only".

13. **Candidate similarity threshold pinned below the prevention threshold.** `THEME_CANDIDATE_SIMILARITY_THRESHOLD` defaults to `0.80` (vs Part 1's `0.92`). Rationale: prevention bites only on confident matches because false-positives there silently collapse signal under the wrong theme. Candidate generation is for *human review* — false-positives are filtered by the admin clicking Dismiss, so casting a wider net is safe and fills the surface with more useful pairs. Workspaces on `text-embedding-3-small` typically see 10–40 pairs at 0.80 in a healthy taxonomy of a few hundred themes. Tunable via env.

14. **Candidate count bounded at the API layer, not the table.** `THEME_CANDIDATE_TOP_N = 20` (env-tunable). The candidates table can hold thousands of rows if a workspace has many duplicates; the API's `GET` clamps the response to the top N by `combined_score`. The client offers a "Show more" affordance (P2.R4) that requests the next batch via a `limit`/`offset` pair on the same endpoint. This keeps the default surface tight while preserving access to the long tail.

15. **Pair-finding uses a single RPC with HNSW-eligible WHERE, not in-memory N² in JS.** `find_theme_candidate_pairs(team_id, user_id, threshold)` does a self-join on `themes` filtered by workspace scope and similarity, returning every pair above threshold in one query. Postgres can use the HNSW index for the similarity predicate; even when it doesn't (small tables) the cosine math runs in C and beats a JS loop. Stats per theme (assignment count, distinct sessions/clients, last-assigned-at) come from a second query — `theme-candidate-service` joins them in memory at refresh time. Two queries per refresh, no per-pair round trips.

16. **Per-side stats are snapshotted into the candidates row at refresh time.** Reads from the candidates surface should be O(1) — a single SELECT joined to `themes` for current names+descriptions. If we computed stats at read time, every page-load would hit `signal_themes` ⨝ `session_embeddings` for every visible pair. Snapshotting trades a small amount of staleness (counts age until next refresh, max 24h with the daily cron) for read latency and architectural clarity. The UI shows "Last refreshed at <timestamp>" so the admin knows the snapshot age.

17. **Refresh is a transactional replace, not incremental upsert.** The service's `refreshCandidates(workspaceCtx)` runs `find_theme_candidate_pairs`, computes scores + stats in memory, then in a single transaction: `DELETE FROM theme_merge_candidates WHERE [scope]` + bulk `INSERT` of the new set. Atomic — admins never see a half-replaced list. Dismissed pairs are filtered *during* the in-memory compute step (joined against `theme_merge_dismissals` for the workspace) so they never reach the candidates table at all. Net effect: the persisted candidates set is always exactly what the admin should see *right now*, post-dismissals.

18. **Dismissals survive theme renames; theme deletion is the only invalidator.** `theme_merge_dismissals` keys by `(theme_a_id, theme_b_id, scope)`. If an admin dismisses (A, B) and later A's name/description change (and embedding regenerates), the dismissal stays — the admin's judgment was about theme identity, not current label. The only way a dismissal "comes back" is if either theme is hard-deleted (cascade FK cleans up the dismissal automatically). This mirrors PRD-026's intent: dismissals reflect domain-knowledge calls, not surface-level coincidences.

19. **Token-based "shared keywords" hint in Part 2; LLM-generated rationale deferred.** P2.R3 lets the TRD pick. We extract case-insensitive intersection of word tokens (after a small built-in stop-word list — "the", "a", "of", etc.) from both theme names and descriptions, capped at 3 keywords per pair. Cheap (string ops, no API calls), legible ("Shared: API, performance"), and good enough — the admin reads both names and descriptions on the same row to make the call. An LLM-rationale upgrade is in the PRD's backlog ("LLM-judged candidate filtering"); when it ships, the `shared_keywords` column is a no-op and the new column carries the rationale.

20. **Background refresh via stale-on-mount auto-trigger, not Vercel cron.** Originally specced as a daily Vercel cron sweep across every workspace; revised to a client-driven staleness check during Increment 2.5 scoping. Rationale: the candidate list only changes when (a) themes are added/archived, (b) signal volume on existing themes shifts materially, or (c) admins dismiss a pair. (a) and (b) are coupled to extraction activity, which already produces traffic that an admin's eventual visit will reflect; (c) updates the persisted set synchronously. A daily cron sweeping every workspace mostly does work no admin will look at. The page mount checks `lastRefreshedAt` against a `THEME_CANDIDATE_STALE_HOURS` threshold (default `24`); if stale or null, the client fires a `POST /refresh` then re-fetches the list. Cost shifts from "every workspace, every day" to "first admin visit per workspace per day". A real cron remains a backlog item if telemetry shows admin-perceived staleness becomes a recurring problem.

21. **`/settings/themes` is gated at three layers.** (a) Sidebar nav: the "Themes" entry only renders for admins (membership role check via existing auth context). (b) Page-level: `app/settings/themes/page.tsx` is a server component that returns 403 if the active workspace member's role is not admin/owner. (c) API routes: every endpoint runs `requireTeamAdmin(teamId, user)` (existing helper from PRD-023 Part 2) before doing any work. Defense in depth — losing the nav gating to a client-side bug still leaves the page and API gated.

### Database Changes

#### Migration: `003-create-theme-candidates-and-dismissals.sql`

```sql
-- ============================================================
-- PRD-026 Part 2: Platform-suggested merge candidates.
-- ============================================================

-- ---------- theme_merge_candidates ----------
CREATE TABLE IF NOT EXISTS theme_merge_candidates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                     UUID REFERENCES teams(id) ON DELETE CASCADE,
  initiated_by                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme_a_id                  UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  theme_b_id                  UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  similarity_score            REAL NOT NULL,
  volume_score                REAL NOT NULL,
  recency_score               REAL NOT NULL,
  combined_score              REAL NOT NULL,
  theme_a_assignment_count    INTEGER NOT NULL DEFAULT 0,
  theme_a_distinct_sessions   INTEGER NOT NULL DEFAULT 0,
  theme_a_distinct_clients    INTEGER NOT NULL DEFAULT 0,
  theme_a_last_assigned_at    TIMESTAMPTZ,
  theme_b_assignment_count    INTEGER NOT NULL DEFAULT 0,
  theme_b_distinct_sessions   INTEGER NOT NULL DEFAULT 0,
  theme_b_distinct_clients    INTEGER NOT NULL DEFAULT 0,
  theme_b_last_assigned_at    TIMESTAMPTZ,
  shared_keywords             TEXT[] NOT NULL DEFAULT '{}',
  refresh_batch_id            UUID NOT NULL,
  generated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (theme_a_id < theme_b_id)  -- Decision 11: normalized pair ordering
);

-- Unique candidate per workspace
CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_candidates_unique_pair_team
  ON theme_merge_candidates (theme_a_id, theme_b_id, team_id)
  WHERE team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_candidates_unique_pair_personal
  ON theme_merge_candidates (theme_a_id, theme_b_id, initiated_by)
  WHERE team_id IS NULL;

-- Sort/scan support — primary read path is "top N by combined_score per workspace"
CREATE INDEX IF NOT EXISTS theme_merge_candidates_team_score_idx
  ON theme_merge_candidates (team_id, combined_score DESC)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS theme_merge_candidates_personal_score_idx
  ON theme_merge_candidates (initiated_by, combined_score DESC)
  WHERE team_id IS NULL;

-- Refresh-batch lookup (for the transactional replace flow)
CREATE INDEX IF NOT EXISTS theme_merge_candidates_batch_idx
  ON theme_merge_candidates (refresh_batch_id);

ALTER TABLE theme_merge_candidates ENABLE ROW LEVEL SECURITY;

-- Read policies — match the themes-table pattern (admin gating happens at the
-- API layer; RLS just enforces workspace membership so cross-workspace leakage
-- is structurally impossible).
CREATE POLICY "team members read team candidates"
  ON theme_merge_candidates FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

CREATE POLICY "users read own personal candidates"
  ON theme_merge_candidates FOR SELECT TO authenticated
  USING (team_id IS NULL AND initiated_by = auth.uid());

-- Writes are service-role only — refreshCandidates / dismissCandidate go
-- through the service which uses the service-role client.

-- ---------- theme_merge_dismissals ----------
CREATE TABLE IF NOT EXISTS theme_merge_dismissals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  initiated_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme_a_id      UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  theme_b_id      UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  dismissed_by    UUID NOT NULL REFERENCES auth.users(id),
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (theme_a_id < theme_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_dismissals_unique_pair_team
  ON theme_merge_dismissals (theme_a_id, theme_b_id, team_id)
  WHERE team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS theme_merge_dismissals_unique_pair_personal
  ON theme_merge_dismissals (theme_a_id, theme_b_id, initiated_by)
  WHERE team_id IS NULL;

ALTER TABLE theme_merge_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members read team dismissals"
  ON theme_merge_dismissals FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

CREATE POLICY "users read own personal dismissals"
  ON theme_merge_dismissals FOR SELECT TO authenticated
  USING (team_id IS NULL AND initiated_by = auth.uid());
```

**Why no `created_at` on candidates beyond `generated_at`:** the row is the *output* of a generation pass; `refresh_batch_id` and `generated_at` together describe its provenance. There is no separate "created" event to track.

**Why not store name/description in the candidate row:** they're authoritative on the `themes` table. Joining at read time means a renamed theme shows the new name on next page load without a refresh. Stats are different — those are time-series-style snapshots (a count *as of* the refresh moment), so they belong on the candidate row.

#### RPC: `004-find-theme-candidate-pairs.sql`

```sql
CREATE OR REPLACE FUNCTION find_theme_candidate_pairs(
  filter_team_id      UUID,
  filter_user_id      UUID,
  similarity_threshold FLOAT DEFAULT 0.80
)
RETURNS TABLE (
  theme_a_id UUID,
  theme_b_id UUID,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    t1.id AS theme_a_id,
    t2.id AS theme_b_id,
    1 - (t1.embedding <=> t2.embedding) AS similarity
  FROM themes t1
  INNER JOIN themes t2
    ON t1.id < t2.id  -- Decision 11: normalized pair ordering
  WHERE
    t1.is_archived = false
    AND t2.is_archived = false
    AND (
      -- Team workspace
      (filter_team_id IS NOT NULL
       AND t1.team_id = filter_team_id
       AND t2.team_id = filter_team_id)
      OR
      -- Personal workspace — both NULL team_id, both owned by same user
      (filter_team_id IS NULL
       AND t1.team_id IS NULL AND t2.team_id IS NULL
       AND t1.initiated_by = filter_user_id
       AND t2.initiated_by = filter_user_id)
    )
    AND 1 - (t1.embedding <=> t2.embedding) >= similarity_threshold
  ORDER BY similarity DESC;
$$;
```

**`SECURITY DEFINER`:** matches `match_session_embeddings`. The service-role client always invokes this RPC; the role check happens at the API layer.

**Why no LIMIT in the RPC:** the candidate set should be complete at compute time — Part 2 ranks the full set in JS, not just the top-K of a single dimension. Bounded N comes from the API layer.

### Type Definitions

#### `lib/types/theme-candidate.ts`

```typescript
export interface ThemeCandidate {
  id: string;
  teamId: string | null;
  initiatedBy: string;
  themeAId: string;
  themeBId: string;
  similarityScore: number;
  volumeScore: number;
  recencyScore: number;
  combinedScore: number;
  themeAStats: ThemeSideStats;
  themeBStats: ThemeSideStats;
  sharedKeywords: string[];
  refreshBatchId: string;
  generatedAt: string;
}

export interface ThemeSideStats {
  assignmentCount: number;
  distinctSessions: number;
  distinctClients: number;
  lastAssignedAt: string | null;
}

/** Used by the listCandidates API/page — joins current name+description. */
export interface ThemeCandidateWithThemes extends ThemeCandidate {
  themeA: { id: string; name: string; description: string | null };
  themeB: { id: string; name: string; description: string | null };
}

export interface ThemeDismissal {
  id: string;
  teamId: string | null;
  initiatedBy: string;
  themeAId: string;
  themeBId: string;
  dismissedBy: string;
  dismissedAt: string;
}
```

### Repository Changes

#### New: `lib/repositories/theme-candidate-repository.ts`

```typescript
export interface ThemeCandidateInsert {
  team_id: string | null;
  initiated_by: string;
  theme_a_id: string;
  theme_b_id: string;
  similarity_score: number;
  volume_score: number;
  recency_score: number;
  combined_score: number;
  theme_a_assignment_count: number;
  theme_a_distinct_sessions: number;
  theme_a_distinct_clients: number;
  theme_a_last_assigned_at: string | null;
  theme_b_assignment_count: number;
  theme_b_distinct_sessions: number;
  theme_b_distinct_clients: number;
  theme_b_last_assigned_at: string | null;
  shared_keywords: string[];
  refresh_batch_id: string;
}

export interface ListCandidatesOptions {
  limit: number;
  offset: number;
}

export interface ThemeCandidateRepository {
  /** Bulk insert from a single refresh pass. Caller is responsible for the
   *  transactional replace (delete-by-scope before inserting the new set). */
  bulkCreate(rows: ThemeCandidateInsert[]): Promise<void>;

  /** Workspace-scoped delete used by refreshCandidates' transactional replace. */
  deleteByWorkspace(teamId: string | null, userId: string): Promise<void>;

  /** Read top N candidates joined with themes for current name+description. */
  listByWorkspace(
    teamId: string | null,
    userId: string,
    options: ListCandidatesOptions
  ): Promise<ThemeCandidateWithThemes[]>;

  /** Lookup by id for the dismiss flow's "is this candidate yours?" check. */
  getById(id: string): Promise<ThemeCandidate | null>;

  /** Delete a single candidate row by id (after dismissal is recorded). */
  deleteById(id: string): Promise<void>;
}

/** Output of find_theme_candidate_pairs RPC. */
export interface CandidatePair {
  themeAId: string;
  themeBId: string;
  similarity: number;
}

export interface ThemeCandidatePairsRepository {
  findPairs(
    teamId: string | null,
    userId: string,
    threshold: number
  ): Promise<CandidatePair[]>;
}
```

The pair-finding RPC sits in its own repo so the service depends on a focused interface — easier to mock.

#### New: `lib/repositories/theme-dismissal-repository.ts`

```typescript
export interface ThemeDismissalInsert {
  team_id: string | null;
  initiated_by: string;
  theme_a_id: string;
  theme_b_id: string;
  dismissed_by: string;
}

export interface ThemeDismissalRepository {
  /** Records the dismissal. Idempotent — unique constraint catches re-dismissals. */
  create(input: ThemeDismissalInsert): Promise<void>;

  /** Returns the set of dismissed pairs for a workspace as a Set keyed
   *  on `${theme_a_id}::${theme_b_id}` — refreshCandidates filters in-memory. */
  listPairKeysByWorkspace(
    teamId: string | null,
    userId: string
  ): Promise<Set<string>>;
}
```

**Supabase adapters** mirror the established pattern (`scopeByTeam`, `[supabase-...-repo]` log prefix per method, throw with context on errors).

#### Per-theme stats query

Lives as a helper on `theme-candidate-service.ts` (not a separate repo — single call site, single domain):

```typescript
async function fetchThemeStats(
  serviceClient: SupabaseClient,
  themeIds: string[]
): Promise<Map<string, ThemeSideStats>> {
  // SELECT theme_id, COUNT(*) AS assignment_count, COUNT(DISTINCT se.session_id),
  //        COUNT(DISTINCT se.metadata->>'client_name'), MAX(st.created_at)
  // FROM signal_themes st INNER JOIN session_embeddings se ON st.embedding_id = se.id
  // WHERE st.theme_id = ANY($1) GROUP BY theme_id
  // → Map<theme_id, ThemeSideStats>
}
```

One round trip. In-memory join into the candidate pairs.

### Service Changes

#### New: `lib/services/theme-candidate-service.ts`

```typescript
const DEFAULT_CANDIDATE_THRESHOLD = 0.80;
const DEFAULT_TOP_N = 20;
const VOLUME_NORM = 200;
const RECENCY_HALF_LIFE_DAYS = 30;
const W_SIM = 0.5;
const W_VOL = 0.3;
const W_REC = 0.2;
const KEYWORD_CAP = 3;

const STOP_WORDS = new Set(["the","a","an","of","and","or","to","for","in","on","with","is","are"]);

const LOG = "[theme-candidate-service]";

export interface WorkspaceCtx {
  teamId: string | null;
  userId: string;
}

export interface RefreshResult {
  workspace: WorkspaceCtx;
  candidatesGenerated: number;
  pairsAboveThreshold: number;
  dismissedFiltered: number;
  elapsedMs: number;
}

/**
 * Rebuilds the persisted candidate set for a single workspace.
 * Atomic from the admin's perspective: the transactional replace inside the
 * repository ensures readers never see a half-replaced list.
 */
export async function refreshCandidates(input: {
  workspace: WorkspaceCtx;
  serviceClient: SupabaseClient;
  candidateRepo: ThemeCandidateRepository;
  pairsRepo: ThemeCandidatePairsRepository;
  dismissalRepo: ThemeDismissalRepository;
  themeRepo: ThemeRepository;
}): Promise<RefreshResult> {
  // 1. Read threshold from env (or fall back).
  // 2. pairsRepo.findPairs(...) → CandidatePair[]
  // 3. dismissalRepo.listPairKeysByWorkspace(...) → Set<string>
  // 4. Filter pairs by dismissals.
  // 5. fetchThemeStats(serviceClient, unique theme ids) → Map<themeId, stats>
  // 6. For each surviving pair: build ThemeCandidateInsert (compute scores +
  //    shared_keywords from theme name/description tokens via themeRepo cache).
  // 7. candidateRepo.deleteByWorkspace + candidateRepo.bulkCreate inside
  //    a transaction (RPC or sequential within try/catch).
  // 8. Log summary; return RefreshResult.
}

export async function listCandidates(input: {
  workspace: WorkspaceCtx;
  candidateRepo: ThemeCandidateRepository;
  limit?: number;  // defaults to THEME_CANDIDATE_TOP_N
  offset?: number;
}): Promise<ThemeCandidateWithThemes[]> {
  // candidateRepo.listByWorkspace with workspace + clamp limit to [1, 100].
}

export async function dismissCandidate(input: {
  candidateId: string;
  workspace: WorkspaceCtx;
  actingUserId: string;
  candidateRepo: ThemeCandidateRepository;
  dismissalRepo: ThemeDismissalRepository;
}): Promise<void> {
  // 1. candidateRepo.getById(id) — verify it exists + matches workspace
  //    (defense in depth; API also checks).
  // 2. dismissalRepo.create({...pair, dismissed_by: actingUserId}).
  // 3. candidateRepo.deleteById(id) — keeps the candidates surface tight.
  //    Future refreshes naturally exclude the dismissed pair.
}

// --- private helpers ---

function combinedScore(sim: number, vol: number, rec: number): number {
  return W_SIM * sim + W_VOL * vol + W_REC * rec;
}

function volumeScore(totalAssignments: number): number {
  return Math.min(1, Math.log10(totalAssignments + 1) / Math.log10(VOLUME_NORM + 1));
}

function recencyScore(lastAssignedAt: string | null): number {
  if (!lastAssignedAt) return 0;
  const days = (Date.now() - new Date(lastAssignedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-Math.max(0, days) / RECENCY_HALF_LIFE_DAYS);
}

function extractSharedKeywords(a: { name: string; description: string | null }, b: typeof a): string[] {
  // Lowercase, tokenize on \W+, drop stop-words, intersect, cap at KEYWORD_CAP.
}
```

**Why scores are computed in JS, not SQL:** the formula has tunable weights that should live next to the rest of the service config. Keeping math in TypeScript means a weight change is a code edit + redeploy, not a migration.

**Why dismissals are filtered before insert (not after read):** P2.R5 requires that dismissed pairs are excluded from the candidate list "going forward unless the underlying themes change materially". Filtering at refresh time means the candidates table is always exactly what the admin should see — page reads stay simple. The dismissals table acts as the source-of-truth for "do not show again"; the candidates table is the materialised result.

### API Routes

All routes admin-gated via `requireTeamAdmin` (existing helper from PRD-023 Part 2). Personal workspace bypasses team checks but still requires authentication.

```
GET    /api/themes/candidates?limit=20&offset=0
POST   /api/themes/candidates/refresh
POST   /api/themes/candidates/[id]/dismiss

GET    /api/cron/refresh-theme-candidates       (Vercel cron, CRON_SECRET-gated)
```

**Validation:** every route parses input with a Zod schema (`limit` clamped 1..100, `offset` non-negative integer, `id` UUID).

**Response shape (`GET /api/themes/candidates`):**

```typescript
{
  candidates: ThemeCandidateWithThemes[];
  total: number;       // count for pagination affordances
  hasMore: boolean;
  lastRefreshedAt: string | null;  // generatedAt from any row in the set
}
```

**Cron route:**

```typescript
// app/api/cron/refresh-theme-candidates/route.ts
export async function GET(request: NextRequest) {
  // 1. Verify CRON_SECRET header (Vercel cron pattern).
  // 2. Read all (teamId, userId) pairs that have ≥ 2 active themes —
  //    one query against themes GROUP BY workspace HAVING COUNT(*) >= 2.
  // 3. Promise.allSettled(workspaces.map(refreshCandidates)) — one slow
  //    workspace doesn't stall the rest; failures are logged per workspace.
  // 4. Return summary — { workspacesProcessed, succeeded, failed }.
}
```

`vercel.json` gains:

```json
{
  "crons": [
    { "path": "/api/cron/refresh-theme-candidates", "schedule": "0 3 * * *" }
  ]
}
```

### UI

```
app/settings/themes/
├── page.tsx                              # Server component — admin gate, render shell
└── _components/
    ├── themes-page-content.tsx           # Client component — fetches GET /api/themes/candidates
    ├── candidate-list.tsx                # List rendering with "Show more" affordance
    ├── candidate-row.tsx                 # Single pair display (P2.R3 fields)
    ├── refresh-button.tsx                # POST /api/themes/candidates/refresh
    └── dismiss-action.tsx                # Per-row dismiss button + optimistic update
```

**`candidate-row.tsx` displays per P2.R3:**
- Both theme names (bolded) + descriptions
- Similarity score as a confidence indicator (e.g., "94% match" with a coloured pill — `>= 0.92` green, `0.85–0.92` amber, `< 0.85` neutral)
- Per-side stats grid: `42 signals · 12 sessions · 8 clients` for theme A, similar for theme B
- Shared-keywords hint: `Shared: API, performance` (omitted if empty)
- "Last refreshed at" timestamp (in the page header, not per row)
- Two action buttons: "Dismiss" (wired in Part 2), "Merge…" (placeholder; Part 3 wires onClick to open the merge dialog)

**Sidebar nav update** — `components/layout/app-sidebar.tsx` adds a fourth settings entry conditionally:

```typescript
const settingsNavItems = [
  { label: "Team Management", href: "/settings/team" },
  { label: "Extraction Prompt", href: "/settings/prompts" },
  // PRD-026: visible to admins/owners only
  ...(isAdmin ? [{ label: "Themes", href: "/settings/themes" }] : []),
];
```

`isAdmin` is the existing role flag from `useAuth()`/`AuthContext`.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/026-theme-deduplication/003-create-theme-candidates-and-dismissals.sql` | **Create** | Migration — both tables, indexes, RLS |
| `docs/026-theme-deduplication/004-find-theme-candidate-pairs.sql` | **Create** | RPC — pairwise similarity above threshold for a workspace |
| `docs/026-theme-deduplication/005-fetch-theme-stats.sql` | **Create** | RPC — per-theme assignment / session / client counts + last-assigned timestamp (added in Increment 2.3 alongside the service that consumes it) |
| `lib/types/theme-candidate.ts` | **Create** | `ThemeCandidate`, `ThemeSideStats`, `ThemeCandidateWithThemes`, `ThemeDismissal` |
| `lib/repositories/theme-candidate-repository.ts` | **Create** | `ThemeCandidateRepository` + `ThemeCandidatePairsRepository` interfaces |
| `lib/repositories/supabase/supabase-theme-candidate-repository.ts` | **Create** | Supabase adapter — bulk insert, scoped delete, list with theme join, getById, deleteById, RPC wrapper |
| `lib/repositories/theme-dismissal-repository.ts` | **Create** | `ThemeDismissalRepository` interface |
| `lib/repositories/supabase/supabase-theme-dismissal-repository.ts` | **Create** | Supabase adapter — create + listPairKeysByWorkspace |
| `lib/services/theme-candidate-service.ts` | **Create** | `refreshCandidates`, `listCandidates`, `dismissCandidate` + scoring math + keyword helper |
| `app/api/themes/candidates/route.ts` | **Create** | `GET` — admin-gated list endpoint |
| `app/api/themes/candidates/refresh/route.ts` | **Create** | `POST` — admin-gated on-demand refresh |
| `app/api/themes/candidates/[id]/dismiss/route.ts` | **Create** | `POST` — admin-gated dismiss |
<!-- Cron route + vercel.json deferred per Decision 20 revision (stale-on-mount auto-refresh in Increment 2.6 instead). -->

| `app/settings/themes/page.tsx` | **Create** | Admin-gated server-component shell |
| `app/settings/themes/_components/themes-page-content.tsx` | **Create** | Client component — list + refresh wiring |
| `app/settings/themes/_components/candidate-list.tsx` | **Create** | List rendering + "Show more" |
| `app/settings/themes/_components/candidate-row.tsx` | **Create** | Single pair display |
| `app/settings/themes/_components/refresh-button.tsx` | **Create** | Manual-refresh button + loading state |
| `app/settings/themes/_components/dismiss-action.tsx` | **Create** | Per-row dismiss button + optimistic update |
| `components/layout/app-sidebar.tsx` | Modify | Conditionally add "Themes" entry for admins |
| `ARCHITECTURE.md` | Modify | New tables, RPC, file map for `app/settings/themes/` + new repositories/services, status line |
| `CHANGELOG.md` | Modify | PRD-026 Part 2 entry |

### Implementation

#### Increment 2.1 — Schema + RPC

**What:** Land migrations `003` and `004`. New tables + RPC + RLS policies.

**Steps:**

1. Create `docs/026-theme-deduplication/003-create-theme-candidates-and-dismissals.sql` with both tables, indexes, RLS policies (idempotent via `IF NOT EXISTS`).
2. Create `docs/026-theme-deduplication/004-find-theme-candidate-pairs.sql` with the RPC.
3. Apply both to Supabase (dev first, prod after the rest of Part 2 ships).
4. Smoke-check: insert a fake row directly via SQL editor (workspace-scoped); confirm RLS lets the owning user read it and another user does not.
5. Smoke-check the RPC: pick a workspace with ≥ 2 active themes; call `find_theme_candidate_pairs(team_id, NULL, 0.5)` (deliberately low threshold). Confirm it returns the expected pairs.

**Verification:**

- `\d theme_merge_candidates` and `\d theme_merge_dismissals` show all columns + indexes.
- `SELECT proname FROM pg_proc WHERE proname = 'find_theme_candidate_pairs';` returns one row.
- Cross-workspace read attempt returns zero rows (RLS fence holds).
- `npx tsc --noEmit` passes (no type changes yet, but verifies the migration's existence didn't break anything).

**Post-increment:** None. ARCHITECTURE batched in 2.6.

---

#### Increment 2.2 — Types + repositories

**What:** Domain types + the four interface files + their two Supabase adapters. No behaviour changes yet — this increment alone does not affect any user surface.

**Steps:**

1. Create `lib/types/theme-candidate.ts` with all four types.
2. Create `lib/repositories/theme-candidate-repository.ts` and `lib/repositories/theme-dismissal-repository.ts` interfaces.
3. Create the Supabase adapters following the established pattern (`scopeByTeam`, `[supabase-...]` logging, error wrapping).
4. The adapters' `listByWorkspace` performs the join to `themes` for current name+description; map the result via a row→domain mapper that validates pair ordering invariant (defensive — DB CHECK should enforce, but mismatch would surface here).

**Verification:**

1. `npx tsc --noEmit` passes.
2. Hand-test from a Node REPL or one-off script: insert a fake candidate row; `listByWorkspace` returns it with theme names populated.

**Post-increment:** None.

---

#### Increment 2.3 — Service: `refreshCandidates` + `listCandidates` + `dismissCandidate`

**What:** Wire the three service operations + the scoring math + keyword helper. This is the meat of Part 2.

**Steps:**

1. Create `lib/services/theme-candidate-service.ts` per the §Service Changes sketch.
2. Implement `refreshCandidates`: pair-find → dismissal filter → stats fetch → score compute → keyword extract → transactional replace via repo.
3. Implement `listCandidates` with the limit clamp.
4. Implement `dismissCandidate`: getById guard → dismissal insert → candidate delete.
5. Implement the private helpers (`combinedScore`, `volumeScore`, `recencyScore`, `extractSharedKeywords`).
6. `THEME_CANDIDATE_SIMILARITY_THRESHOLD` and `THEME_CANDIDATE_TOP_N` env-var reads with validation + warning fallback (mirroring `theme-prevention.ts`).

**Verification:**

1. `npx tsc --noEmit` passes.
2. Repl/script: call `refreshCandidates` against a dev workspace seeded with two near-duplicate themes ("API Performance", "API Speed"). Confirm:
   - `theme_merge_candidates` has the pair after refresh.
   - `combined_score` is in `[0, 1]`.
   - `shared_keywords` includes "api" (or "API" lowercased — verify the casing decision).
3. Call `dismissCandidate` for that pair. Confirm the dismissal row exists and the candidate row is gone.
4. Call `refreshCandidates` again. The pair does NOT come back (dismissal filter holds).
5. Manually delete one of the two themes (hard DELETE in SQL editor for testing) → cascade removes the dismissal. Re-refresh: with the theme gone, no pair surfaces (only one theme remains).

---

#### Increment 2.4 — API routes (admin-gated)

**What:** The three user-facing routes + Zod validation + role checks.

**Steps:**

1. Create `app/api/themes/candidates/route.ts` (GET): Zod schema for `limit`/`offset`, role check via `requireTeamAdmin`, delegate to `listCandidates`, return `{ candidates, total, hasMore, lastRefreshedAt }`.
2. Create `app/api/themes/candidates/refresh/route.ts` (POST): role check, delegate to `refreshCandidates`, return `RefreshResult`.
3. Create `app/api/themes/candidates/[id]/dismiss/route.ts` (POST): role check, parse `id` as UUID, delegate to `dismissCandidate`. Return 204.
4. Each route logs entry/exit/error per the project's logging convention.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Manual `curl` (or browser DevTools fetch) tests:
   - Authenticated admin → `GET` returns the list.
   - Authenticated non-admin (member) → `GET` returns 403.
   - Unauthenticated → 401.
   - Refresh + dismiss tested similarly.
3. Confirm the route logs include the expected prefix and don't duplicate logs from the service layer (per CLAUDE.md "helpers don't log — routes preserve their own").

---

#### Increment 2.5 — DEFERRED (cron route + scheduling)

Originally specced as a Vercel cron at `0 3 * * *` UTC sweeping every workspace daily. Revised per Decision 20 — the staleness mechanism moves to the page mount in Increment 2.6 (cheaper, scoped to workspaces an admin actually visits). A real cron remains a backlog item; revisit if production telemetry shows the once-per-admin-visit cadence is insufficient.

---

#### Increment 2.6 — `/settings/themes` page UI + sidebar nav

**What:** The user-facing surface. Server-rendered shell + client-rendered list with refresh + dismiss.

**Steps:**

1. Create `app/settings/themes/page.tsx`: server component, runs `requireTeamAdmin` (or its equivalent for the Settings parent layout's auth context); returns 403 if non-admin reaches it directly. Renders `<ThemesPageContent />`.
2. Create `_components/themes-page-content.tsx`: fetches `GET /api/themes/candidates` on mount; if `lastRefreshedAt` is `null` or older than `THEME_CANDIDATE_STALE_HOURS` (default `24`, env-tunable), automatically fires a `POST /api/themes/candidates/refresh` and re-fetches before rendering the list (Decision 20 — stale-on-mount auto-refresh, replaces the deferred cron). The auto-refresh shows the same loading affordance as the manual refresh button so the admin sees a single, coherent loading state on their first visit of the day. Renders `<RefreshButton />` and `<CandidateList />`. Tracks loading + error states; toasts on refresh success/failure.
3. Create `_components/candidate-list.tsx`: renders rows; "Show more" affordance bumps `limit` and re-fetches.
4. Create `_components/candidate-row.tsx`: displays per §UI; "Merge…" button has `disabled` (or `aria-label="Coming in Part 3"`) for now.
5. Create `_components/refresh-button.tsx`: button + loading spinner; success toast updates `lastRefreshedAt`.
6. Create `_components/dismiss-action.tsx`: button + confirmation tooltip; optimistic remove on success; rollback on failure.
7. Update `components/layout/app-sidebar.tsx`: conditionally include the "Themes" entry for admins/owners.
8. Apply the design tokens from `globals.css` — no inline colours; pill colours go through CSS custom properties (`--color-status-success`, `--color-status-warning`, `--color-status-neutral` or equivalents already in the codebase).

**Verification:**

1. `npx tsc --noEmit` passes.
2. Run dev server. Sign in as admin → settings sidebar shows "Themes" → click → list renders with seeded near-duplicate pair.
3. Click "Dismiss" → row disappears optimistically; backend confirms; refresh page → row stays gone.
4. Click "Refresh" → button shows loading state → list updates; "Last refreshed at" timestamp updates.
5. Sign in as member (non-admin) on the same workspace → no "Themes" entry in nav. Direct navigation to `/settings/themes` returns 403.
6. Mobile responsive check — narrow the viewport; confirm rows wrap cleanly and buttons remain reachable.
7. Dark mode check — pill colours and text contrast against both light and dark backgrounds.

---

#### Increment 2.7 — End-of-part audit

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report.

**Checklist:**

1. **SRP:** confirm each new module does one thing — `theme-candidate-service.ts` orchestrates; `theme-candidate-repository.ts` is data access; the candidate-row component is rendering only (no fetch lifecycle); `dismiss-action.tsx` owns its own button + side-effect.
2. **DRY:** verify `extractSharedKeywords`, scoring helpers, threshold reads each have one home. The `requireTeamAdmin` pattern is the existing helper from PRD-023 — reused, not redefined.
3. **Design tokens:** every colour, spacing, font-size on the new UI references CSS custom properties or Tailwind tokens. No hex literals in `_components/*.tsx`. Pill colour decisions for the similarity-score indicator go through the existing badge tokens.
4. **Logging:** every API route + service method logs entry/exit/error per the project convention. The cron route logs per-workspace and overall summary.
5. **Dead code:** no commented-out blocks, no unused imports, no half-finished components.
6. **Convention compliance:** kebab-case files; PascalCase types; UPPER_SNAKE for constants; named exports only (page.tsx + route.ts use `default` per Next.js requirement); import order per CLAUDE.md.
7. **Database review:** RLS policies match the documented intent; cross-workspace read attempt returns zero rows; CHECK constraints hold (try inserting a row with `theme_a_id > theme_b_id` — should fail).
8. **Error paths:** simulate a slow `find_theme_candidate_pairs` (e.g., add a `pg_sleep`); confirm the on-demand refresh times out gracefully; admin sees an error toast, not a hung spinner.
9. **ARCHITECTURE.md:**
   - Add `theme_merge_candidates` and `theme_merge_dismissals` to the data-model section with all columns, indexes, RLS notes.
   - Add the RPC `find_theme_candidate_pairs` to the RPC list (alongside `match_session_embeddings`, `sessions_over_time`).
   - File map: add `app/settings/themes/`, `app/api/themes/`, `app/api/cron/refresh-theme-candidates/`, the new repos/service/types.
   - Implementation status line: append "PRD-026 Part 2 (Platform-Suggested Merge Candidates) implemented".
10. **CHANGELOG.md:** new entry under `[Unreleased]` summarising Part 2 — schema, service, API, UI, cron, threshold/weights pinned, forward-compat notes for Part 3.
11. **Verify file references in docs still resolve.**
12. **Re-run flows touched by Part 2:**
    - Capture → AI extraction → background chain → assignments persist (Part 1 path unchanged).
    - Admin opens `/settings/themes` → list renders → refresh → dismiss → refresh again (no resurrection).
    - Cron manual trigger from Vercel dashboard → all workspaces refresh.
13. **Final:** `npx tsc --noEmit`.

This audit closes Part 2.

---

## Part 3: Admin-Confirmed Theme Merge

> Implements **P3.R1–P3.R8** from PRD-026.

### Overview

Lands the actual cleanup action that Parts 1–2 set the stage for. An admin clicks "Merge…" on a candidate row, picks the canonical side, sees a blast-radius preview, and confirms — at which point the entire merge runs server-side as a single Postgres transaction: every `signal_themes` row pointing to the archived theme is re-pointed to the canonical theme, the archived theme is marked archived with a `merged_into_theme_id` pointer, the residual candidate row is removed, and an audit record is written. Five moving pieces:

1. **Schema** — new `theme_merges` audit table + new `merge_themes` Postgres function (the atomic unit of work). The function is the only legitimate write path for merging; the API never calls multiple statements sequentially against `signal_themes` and `themes`.
2. **Service** — `theme-merge-service.ts` owns two operations: `mergeCandidatePair(candidateId, canonicalThemeId, actorId)` runs the RPC and returns a typed `MergeResult` (the shape Part 4 will hand straight into the `theme.merged` notification payload); `listRecentMerges(workspaceCtx, options)` reads the audit table for the "Recent merges" surface.
3. **API routes** — `POST /api/themes/candidates/[id]/merge` (admin-gated) wraps `mergeCandidatePair`. `GET /api/themes/merges` (admin-gated) wraps `listRecentMerges`.
4. **UI** — confirmation dialog with the canonical-flip toggle and blast-radius preview, hosted by `themes-page-content.tsx` so the candidate row stays a thin presentation component. The candidate row's previously-disabled "Merge…" button is wired via `onMerge(candidate)` callback. New `recent-merges-section.tsx` sits below the candidates list on `/settings/themes`.
5. **Forward-compat for Part 4** — the service's `MergeResult` shape is a strict superset of `themeMergedPayloadSchema` from `lib/notifications/events.ts`. Part 4 imports the service and emits the notification immediately after `mergeCandidatePair` returns; Part 3 does **not** emit (separation of concerns — Part 3 is "do the merge"; Part 4 is "tell the workspace").

The flow on confirmation:

```
Admin clicks "Merge…" on a candidate row
   → CandidateRow fires onMerge(candidate)
   → ThemesPageContent opens MergeDialog with the candidate
Admin picks canonical (defaults to higher-volume side), reads the preview
   → MergeDialog computes "X signal assignments will be re-pointed; Y sessions, Z clients affected" from the candidate's snapshot stats
Admin clicks Confirm
   → POST /api/themes/candidates/<id>/merge { canonicalThemeId }
   → server: requireWorkspaceAdmin → service.mergeCandidatePair
   → service.mergeCandidatePair calls the merge_themes RPC inside one Postgres transaction
   → RPC: validate → re-point signal_themes (with conflict-aware delete-then-update) → archive → cleanup candidate + dismissal rows → insert audit row → return { auditId, reassignedCount, ...names }
   → service returns MergeResult to the route
   → route returns 200 with MergeResult
Client closes dialog, fires success toast, re-fetches the candidates list (the row is already gone) and the recent-merges list (now has the new entry on top)
```

### Forward Compatibility Notes

- **Part 4 (Notify Affected Users):** the service's `MergeResult` carries `archivedThemeId / archivedThemeName / canonicalThemeId / canonicalThemeName / signalAssignmentsRepointed` (= `reassignedCount`). Part 4 will additionally resolve `actorName` (from `profiles.email` until a richer profile lands) and call `notificationService.emit({ eventType: "theme.merged", payload: { ...result, actorId, actorName }, teamId, broadcast: true })` as a fire-and-forget chain after a successful merge. The `theme.merged` event type is already registered (see `lib/notifications/events.ts`); the renderer is already populated (`GitMerge` icon, deep-link to `/settings/themes`, title `Theme "X" merged into "Y"`). Part 4 ships zero schema changes — it's a single emit call wired into Part 3's success path.
- **Backlog (reverse-merge / unmerge):** the archived theme keeps its row + `merged_into_theme_id` pointer + the audit log carries the snapshotted name + reassigned count. A reverse-merge flow would walk the audit row, re-create the archived theme by un-archiving + clearing `merged_into_theme_id`, and re-point the captured `signal_themes` rows back. The data is already there; only the UI + reverse-RPC are missing.
- **Backlog (bulk merge):** the merge RPC is per-pair. A `merge_themes_bulk(candidate_ids[])` wrapper that calls `merge_themes` inside one outer transaction is an additive RPC — the service's `mergeCandidatePair` contract doesn't change.
- **Backlog (auto-merge above 0.95):** PRD's backlog item. A scheduled function would call `merge_themes` for any candidate above the auto-threshold whose `combined_score` exceeds X. Same RPC; new caller. Not in scope.

### Technical Decisions

Continuing the numbering from Parts 1–2's decisions.

22. **The merge is one Postgres function (`merge_themes`), not multiple Supabase JS calls.** P3.R5 ("no observable intermediate state") rules out a multi-statement client-side transaction — Supabase JS doesn't expose `BEGIN; ... COMMIT;` cleanly, and round-trip overhead alone makes a multi-step approach slower than a single function call. PL/pgSQL gives us multiple statements inside a single implicit transaction, error handling via `RAISE EXCEPTION`, and `RETURNING` for the audit-id round-trip. Same pattern as `match_session_embeddings` and `find_theme_candidate_pairs` (`SECURITY DEFINER`); same callers (service-role client only). The function is the **single source of truth** for the merge sequence — the service, route, and UI never re-implement the steps.

23. **`signal_themes` re-point uses delete-then-update to satisfy the unique constraint.** The (embedding_id, theme_id) unique index would fire if a single signal already had assignments to *both* sides of the merge (rare but real — can happen when AI extracts the same signal under two near-duplicate themes in different sessions). The function first `DELETE`s `signal_themes` rows where `theme_id = archived_id` AND a row with the same `embedding_id` already exists with `theme_id = canonical_id` — those duplicates resolve in favour of the existing canonical assignment. Then `UPDATE`s every remaining `archived → canonical` row. No conflict can fire post-update; the unique-index invariant holds throughout. The function returns the **post-dedup count** (number of rows actually re-pointed, including the deletes) so the UI's success toast reports the real impact.

24. **`theme_merges` audit row is a snapshot, not a join.** Stores `archived_theme_id`, `canonical_theme_id`, `archived_theme_name`, `canonical_theme_name`, `actor_id`, `reassigned_count`, `distinct_sessions`, `distinct_clients`, `team_id`, `initiated_by`, `merged_at`. The names are snapshotted at merge time so the audit trail is meaningful even after a future rename. There are **no foreign keys** on `archived_theme_id` / `canonical_theme_id` to `themes.id` — the merge spec archives (not deletes) the theme row, but a future hard-delete or workspace cleanup shouldn't cascade-destroy the audit history. This is also why we don't store `theme_id` references that depend on `themes.id` continuing to exist.

25. **Cleanup of `theme_merge_candidates` and `theme_merge_dismissals` happens inside the merge transaction.** After re-point + archive, any candidate row referencing the archived theme is stale (the pair no longer makes sense — one side is archived). Same for any dismissal involving the archived theme. The function `DELETE`s both inside the transaction so the surface is consistent the moment the response returns. If we deferred cleanup to the next refresh, an admin would briefly see candidate rows that reference an archived theme (which would 404 in the UI when clicked).

26. **Canonical default = higher-volume side; admin can flip.** P3.R3. The candidate row's snapshot stats already carry `assignment_count` per side, so the dialog computes the default without an extra round trip. Flipping the toggle re-renders the dialog (different "X will be re-pointed" preview) but doesn't refetch — the same stats apply, just inverted. The route validates that `canonicalThemeId` matches one of the candidate's `theme_a_id` / `theme_b_id`; otherwise 400.

27. **Blast-radius preview reads the candidate snapshot, not a fresh query.** The candidate row already has `theme_*_assignment_count`, `theme_*_distinct_sessions`, `theme_*_distinct_clients` from the last refresh (snapshotted, max 24h stale per Decision 20). Re-querying live stats at dialog-open would double the cost on every Merge click. The dialog explicitly labels the preview "approximately N signals" — and the success toast reports the **actual** post-merge count returned by the RPC. If the dialog showed "~100 signals" and the toast says "97 re-pointed", that's expected and acceptable. P3.R2 requires the disclaimer about chat-history not being modified; that's a literal string in the dialog body.

28. **The merge service does not emit the notification.** Strict Part 3 vs Part 4 separation. The service returns `MergeResult` and exits; Part 4's chain (when shipped) will call `notificationService.emit` with a payload built from `MergeResult` plus the resolved actor name. Until Part 4 lands, merges work end-to-end and the audit log is the visibility mechanism for other workspace members. This means Part 4's diff is **literally one fire-and-forget call** in `mergeCandidatePair` (or a thin wrapper if we want the chain pattern to match `runSessionPostResponseChain`); the service contract does not change.

29. **Three-layer admin gating, identical to Part 2.** Sidebar nav already filters out non-admins (`useIsWorkspaceAdmin` from Part 2). Page server-component already returns the "admin-only" fallback. The new merge + recent-merges API routes use the existing `requireWorkspaceAdmin` helper. No new gating primitives — every layer Part 2 introduced is reused.

30. **Recent merges renders a bounded snapshot, not paginated infinity.** Default top 10 (env-tunable later if needed); "Show more" expands to next 10. Same fetch-`limit + 1` pattern as `listCandidates`. Audit logs grow linearly, but a workspace doesn't merge daily — even a heavy 1-merge-per-week workspace produces 52 rows a year. No archival or partitioning ceremony for Part 3; revisit if workspaces start churning hundreds of merges a year.

### Database Changes

#### Migration: `006-create-theme-merges-and-merge-rpc.sql`

```sql
-- ============================================================
-- PRD-026 Part 3: Theme merge audit log + atomic merge RPC.
-- ============================================================

-- ------------------------------------------------------------
-- theme_merges (audit log)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS theme_merges (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  UUID REFERENCES teams(id) ON DELETE CASCADE,
  initiated_by             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Snapshot ids: NOT FK, so the audit row survives a future hard-delete
  -- of either theme. Decision 24.
  archived_theme_id        UUID NOT NULL,
  canonical_theme_id       UUID NOT NULL,
  archived_theme_name      TEXT NOT NULL,
  canonical_theme_name     TEXT NOT NULL,

  actor_id                 UUID NOT NULL REFERENCES auth.users(id),
  reassigned_count         INTEGER NOT NULL,
  distinct_sessions        INTEGER NOT NULL,
  distinct_clients         INTEGER NOT NULL,

  merged_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recent-merges read pattern: workspace-scoped, ordered by merged_at DESC.
CREATE INDEX IF NOT EXISTS theme_merges_team_merged_at_idx
  ON theme_merges (team_id, merged_at DESC)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS theme_merges_personal_merged_at_idx
  ON theme_merges (initiated_by, merged_at DESC)
  WHERE team_id IS NULL;

ALTER TABLE theme_merges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team members read team merges" ON theme_merges;
CREATE POLICY "team members read team merges"
  ON theme_merges FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND is_team_member(team_id));

DROP POLICY IF EXISTS "users read own personal merges" ON theme_merges;
CREATE POLICY "users read own personal merges"
  ON theme_merges FOR SELECT TO authenticated
  USING (team_id IS NULL AND initiated_by = auth.uid());

-- INSERTs go through the merge_themes RPC under SECURITY DEFINER; no
-- INSERT policy is intentionally needed for the authenticated role.

-- ------------------------------------------------------------
-- merge_themes — the atomic merge function (Decision 22)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION merge_themes(
  archived_theme_id  UUID,
  canonical_theme_id UUID,
  acting_user_id     UUID
)
RETURNS TABLE (
  audit_id              UUID,
  reassigned_count      INTEGER,
  distinct_sessions     INTEGER,
  distinct_clients      INTEGER,
  archived_theme_name   TEXT,
  canonical_theme_name  TEXT,
  team_id               UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_archived           themes%ROWTYPE;
  v_canonical          themes%ROWTYPE;
  v_count              INTEGER;
  v_distinct_sessions  INTEGER;
  v_distinct_clients   INTEGER;
  v_audit_id           UUID;
BEGIN
  -- Lock both theme rows up-front to serialise concurrent merges of the
  -- same pair (rare, but racy). FOR UPDATE blocks any other merge or
  -- archive of these themes until COMMIT.
  SELECT * INTO v_archived  FROM themes WHERE id = archived_theme_id  FOR UPDATE;
  SELECT * INTO v_canonical FROM themes WHERE id = canonical_theme_id FOR UPDATE;

  IF v_archived.id IS NULL OR v_canonical.id IS NULL THEN
    RAISE EXCEPTION 'theme(s) not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_archived.id = v_canonical.id THEN
    RAISE EXCEPTION 'cannot merge a theme into itself' USING ERRCODE = '22023';
  END IF;

  IF v_archived.is_archived OR v_canonical.is_archived THEN
    RAISE EXCEPTION 'cannot merge an already-archived theme' USING ERRCODE = '22023';
  END IF;

  -- Workspace-scope check: both themes must belong to the same workspace.
  IF v_archived.team_id IS DISTINCT FROM v_canonical.team_id THEN
    RAISE EXCEPTION 'themes belong to different workspaces' USING ERRCODE = '22023';
  END IF;
  IF v_archived.team_id IS NULL
     AND v_archived.initiated_by IS DISTINCT FROM v_canonical.initiated_by THEN
    RAISE EXCEPTION 'personal-workspace themes belong to different users'
      USING ERRCODE = '22023';
  END IF;

  -- Capture pre-merge stats (Decision 24 — snapshotted on the audit row).
  SELECT
    COUNT(*),
    COUNT(DISTINCT se.session_id),
    COUNT(DISTINCT (se.metadata->>'client_name'))
  INTO v_count, v_distinct_sessions, v_distinct_clients
  FROM signal_themes st
  INNER JOIN session_embeddings se ON st.embedding_id = se.id
  WHERE st.theme_id = archived_theme_id;

  -- Re-point signal_themes (Decision 23 — delete-then-update so the
  -- (embedding_id, theme_id) unique index never fires).
  DELETE FROM signal_themes
  WHERE theme_id = archived_theme_id
    AND embedding_id IN (
      SELECT embedding_id FROM signal_themes WHERE theme_id = canonical_theme_id
    );

  UPDATE signal_themes
  SET theme_id = canonical_theme_id
  WHERE theme_id = archived_theme_id;

  -- Archive + pointer (P3.R4).
  UPDATE themes
  SET is_archived = true,
      merged_into_theme_id = canonical_theme_id,
      updated_at = now()
  WHERE id = archived_theme_id;

  -- Cleanup stale candidates / dismissals (Decision 25).
  DELETE FROM theme_merge_candidates
  WHERE theme_a_id IN (archived_theme_id, canonical_theme_id)
     OR theme_b_id IN (archived_theme_id, canonical_theme_id);

  DELETE FROM theme_merge_dismissals
  WHERE theme_a_id IN (archived_theme_id, canonical_theme_id)
     OR theme_b_id IN (archived_theme_id, canonical_theme_id);

  -- Audit row.
  INSERT INTO theme_merges (
    team_id, initiated_by,
    archived_theme_id, canonical_theme_id,
    archived_theme_name, canonical_theme_name,
    actor_id, reassigned_count, distinct_sessions, distinct_clients
  ) VALUES (
    v_archived.team_id, v_archived.initiated_by,
    archived_theme_id, canonical_theme_id,
    v_archived.name, v_canonical.name,
    acting_user_id, v_count, v_distinct_sessions, v_distinct_clients
  )
  RETURNING id INTO v_audit_id;

  audit_id             := v_audit_id;
  reassigned_count     := v_count;
  distinct_sessions    := v_distinct_sessions;
  distinct_clients     := v_distinct_clients;
  archived_theme_name  := v_archived.name;
  canonical_theme_name := v_canonical.name;
  team_id              := v_archived.team_id;
  RETURN NEXT;
END;
$$;
```

**Why `RAISE EXCEPTION` not Postgres `assert`:** `RAISE EXCEPTION` propagates as a PostgREST error with the SQLSTATE code, which the service maps to a typed error class (see §Service Changes). `assert` aborts the function and returns a generic error.

**Why we lock both theme rows with `FOR UPDATE`:** prevents two concurrent merges from racing. Without the lock, two admins clicking Merge on overlapping pairs could each pass the validation step and both write archive flags, producing an inconsistent post-state. With the lock, the second merge blocks until the first commits, then sees `is_archived = true` and exits with the right error.

### Type Definitions

#### `lib/types/theme-merge.ts`

```typescript
export interface ThemeMerge {
  id: string;
  teamId: string | null;
  initiatedBy: string;
  archivedThemeId: string;
  canonicalThemeId: string;
  archivedThemeName: string;
  canonicalThemeName: string;
  actorId: string;
  reassignedCount: number;
  distinctSessions: number;
  distinctClients: number;
  mergedAt: string;
}

/**
 * Output of the `merge_themes` RPC, surfaced by the service to the route.
 * A strict superset of `themeMergedPayloadSchema` from
 * `lib/notifications/events.ts` minus `actorName` (Part 4 will resolve
 * `actorName` from the profile when emitting the notification).
 */
export interface MergeResult {
  auditId: string;
  archivedThemeId: string;
  archivedThemeName: string;
  canonicalThemeId: string;
  canonicalThemeName: string;
  /** Renamed from RPC's `reassigned_count` for the camelCase domain shape;
   *  same semantics as `themeMergedPayloadSchema.signalAssignmentsRepointed`. */
  signalAssignmentsRepointed: number;
  distinctSessions: number;
  distinctClients: number;
  teamId: string | null;
}
```

### Repository Changes

#### `lib/repositories/theme-merge-repository.ts`

```typescript
import type { ThemeMerge, MergeResult } from "@/lib/types/theme-merge";

export interface ListMergesOptions {
  limit: number;
  offset: number;
}

export interface ThemeMergeRepository {
  /**
   * Calls `merge_themes` RPC. The RPC enforces every workspace-scope and
   * archive invariant; this method just translates the row to MergeResult
   * and surfaces typed errors via the SQLSTATE codes raised inside.
   */
  executeMerge(input: {
    archivedThemeId: string;
    canonicalThemeId: string;
    actorId: string;
  }): Promise<MergeResult>;

  /** Read recent merges for a workspace, ordered by mergedAt DESC. */
  listByWorkspace(
    teamId: string | null,
    userId: string,
    options: ListMergesOptions
  ): Promise<ThemeMerge[]>;
}
```

The Supabase adapter follows the established `[supabase-theme-merge-repo]` log-prefix convention. The `executeMerge` adapter inspects `error.code` from the RPC failure to throw typed errors — `MergeValidationError` (`22023`) for "themes not found / same theme / cross-workspace / already archived"; `MergeNotFoundError` (`P0002`) for missing themes specifically. Anything else surfaces as a generic `MergeRepoError`.

### Service Changes

#### `lib/services/theme-merge-service.ts`

```typescript
const LOG = "[theme-merge-service]";
const DEFAULT_RECENT_TOP_N = 10;
const MAX_RECENT_TOP_N = 100;

/** Surfaces to the route layer — translated to 404. */
export class CandidateNotFoundForMergeError extends Error {
  constructor(message: string) { super(message); this.name = "CandidateNotFoundForMergeError"; }
}

/** Surfaces to the route layer — translated to 400. */
export class InvalidCanonicalChoiceError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidCanonicalChoiceError"; }
}

export interface ListRecentMergesResult {
  items: ThemeMerge[];
  hasMore: boolean;
}

/**
 * Runs the merge transaction for one candidate pair.
 *
 * 1. Looks up the candidate to derive the archived side (the one the admin
 *    didn't pick as canonical) and to validate workspace ownership.
 * 2. Calls executeMerge on the RPC. The RPC handles the atomic re-point +
 *    archive + cleanup.
 * 3. Returns MergeResult — caller (Part 4) will use this to emit the
 *    `theme.merged` notification once that part lands.
 *
 * Note: the candidate row is removed by the RPC's cleanup (Decision 25),
 * not by an explicit second call. Keeping the cleanup inside the
 * transaction means the candidate disappears atomically with the merge.
 */
export async function mergeCandidatePair(input: {
  candidateId: string;
  canonicalThemeId: string;
  workspace: WorkspaceCtx;
  actorId: string;
  candidateRepo: ThemeCandidateRepository;
  mergeRepo: ThemeMergeRepository;
}): Promise<MergeResult> {
  // 1. Load candidate; verify it belongs to this workspace (defense in
  //    depth — the API already gated, but a misrouted call could land here).
  // 2. Derive archivedThemeId from the candidate's theme_a_id/theme_b_id.
  //    Validate canonicalThemeId is one of the two; otherwise throw
  //    InvalidCanonicalChoiceError.
  // 3. Call mergeRepo.executeMerge(...).
  // 4. Log the result; return.
}

export async function listRecentMerges(input: {
  workspace: WorkspaceCtx;
  mergeRepo: ThemeMergeRepository;
  limit?: number;
  offset?: number;
}): Promise<ListRecentMergesResult> {
  // Fetch limit+1 → derive hasMore → return.
}
```

### API Routes

```
POST /api/themes/candidates/[id]/merge
  body: { canonicalThemeId: string }
  returns: MergeResult
  errors: 400 (invalid canonical), 403 (non-admin), 404 (candidate gone),
          409 (RPC validation — already archived, cross-workspace, etc.),
          500 (unexpected)

GET /api/themes/merges?limit=&offset=
  returns: { items: ThemeMerge[], hasMore: boolean }
  errors: 401, 403, 500
```

Both admin-gated via the existing `requireWorkspaceAdmin` helper. Zod validation:
- `[id]` UUID
- `canonicalThemeId` UUID, must match one of the candidate's two ids (validated in service)
- `limit` integer 1..100 (clamped), `offset` integer ≥ 0

Logging mirrors the Part 2 routes (`[api/themes/candidates/[id]/merge]`, `[api/themes/merges]` prefixes; entry/exit/error). Routes do not duplicate the service's `[theme-merge-service]` logs.

### UI Changes

```
app/settings/themes/_components/
├── merge-dialog.tsx                # NEW — confirmation dialog with
│                                     canonical-flip toggle, blast-radius
│                                     preview, P3.R2 disclaimer text,
│                                     Confirm + Cancel
├── recent-merges-section.tsx       # NEW — sibling section below the
│                                     candidates list; fetches GET /merges,
│                                     renders rows, "Show more"
├── candidate-row.tsx               # MODIFY — wire onMerge(candidate)
│                                     callback; remove disabled state on
│                                     "Merge…" button
├── themes-page-content.tsx         # MODIFY — host MergeDialog open state,
│                                     pass onMerge into rows, on success
│                                     re-fetch candidates + recent-merges
```

**`merge-dialog.tsx`** uses the project's existing `Dialog` primitive (`@/components/ui/dialog`). The canonical-flip is a controlled radio (default = side with higher `assignmentCount`); the preview reads the candidate's snapshot (Decision 27) and shows live "X signal assignments will be re-pointed; Y sessions, Z clients affected" computed on each toggle. The disclaimer ("Past chat messages won't be rewritten — only future chat queries will use the canonical name.") is a literal string in the dialog body. Confirm button shows a loading state during the POST; Cancel is disabled during the POST so the admin can't double-click.

**`recent-merges-section.tsx`** renders each merge as a single-line item: `{archivedThemeName} → {canonicalThemeName}` with a smaller caption `{reassignedCount} signal assignments · {distinctSessions} sessions · {distinctClients} clients · {relativeTime(mergedAt)}`. Bounded N=10 with "Show more". Uses the same status tokens as the candidate row.

**`candidate-row.tsx`** modification is small: add an `onMerge?: (candidate: ThemeCandidateWithThemes) => void` prop, change the "Merge…" button from `disabled` to wired (`onClick={() => onMerge?.(candidate)}`), drop the `aria-label="Merge — coming in Part 3"` placeholder copy.

**`themes-page-content.tsx`** modification: `useState` for `dialogCandidate: ThemeCandidateWithThemes | null`; `onMerge` opens the dialog by setting state; `onMergeConfirmed` runs the POST, on success refetches `listCandidates` + recent-merges and closes the dialog; on error shows toast + keeps the dialog open. The recent-merges section hooks its own `refresh` callback into the post-merge re-fetch.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/026-theme-deduplication/006-create-theme-merges-and-merge-rpc.sql` | **Create** | Migration — `theme_merges` audit table + indexes + RLS + `merge_themes` RPC |
| `lib/types/theme-merge.ts` | **Create** | `ThemeMerge`, `MergeResult` |
| `lib/repositories/theme-merge-repository.ts` | **Create** | `ThemeMergeRepository` interface, `ListMergesOptions`, typed errors `MergeValidationError`, `MergeNotFoundError`, `MergeRepoError` |
| `lib/repositories/supabase/supabase-theme-merge-repository.ts` | **Create** | Supabase adapter — RPC wrapper for `executeMerge`, `listByWorkspace` join-free read with workspace scope |
| `lib/services/theme-merge-service.ts` | **Create** | `mergeCandidatePair`, `listRecentMerges`, typed errors `CandidateNotFoundForMergeError`, `InvalidCanonicalChoiceError` |
| `app/api/themes/candidates/[id]/merge/route.ts` | **Create** | `POST` — admin-gated merge confirmation |
| `app/api/themes/merges/route.ts` | **Create** | `GET` — admin-gated recent merges |
| `app/settings/themes/_components/merge-dialog.tsx` | **Create** | Confirmation dialog with flip toggle + preview + disclaimer |
| `app/settings/themes/_components/recent-merges-section.tsx` | **Create** | Sibling section below candidates list |
| `app/settings/themes/_components/candidate-row.tsx` | Modify | Wire `onMerge` callback; drop the disabled-placeholder state |
| `app/settings/themes/_components/themes-page-content.tsx` | Modify | Host dialog open state; coordinate re-fetch on success |
| `lib/repositories/index.ts` + `lib/repositories/supabase/index.ts` | Modify | Barrel re-exports |
| `ARCHITECTURE.md` | Modify | New table, new RPC, file map for the new repo/service/UI components, status line, new architecture-decision entry |
| `CHANGELOG.md` | Modify | PRD-026 Part 3 entry |

### Implementation

#### Increment 3.1 — Schema + RPC

**What:** Land migration `006`. `theme_merges` table + `merge_themes` PL/pgSQL function + RLS.

**Steps:**

1. Create `docs/026-theme-deduplication/006-create-theme-merges-and-merge-rpc.sql` containing the table, indexes, RLS policies, and the function (idempotent: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`).
2. Apply to Supabase (dev first).
3. Smoke-check the function:
   - Pick a workspace with two themes that have signal assignments.
   - Call `SELECT * FROM merge_themes('<archived>', '<canonical>', '<actor>')` directly.
   - Verify: archived theme has `is_archived = true` and `merged_into_theme_id = <canonical>`; `signal_themes` rows previously pointing at archived now point at canonical; `theme_merges` has one new row; affected `theme_merge_candidates` and `theme_merge_dismissals` rows are gone.
   - Re-call with the same archived id → should `RAISE EXCEPTION 'cannot merge an already-archived theme'`.
   - Call with `archived = canonical` → should raise.
   - Call with cross-workspace ids → should raise.

**Verification:**

- `\d theme_merges` shows all columns + indexes + RLS on.
- `SELECT proname FROM pg_proc WHERE proname = 'merge_themes';` returns one row.
- All four error paths raise the correct SQLSTATE.

**Post-increment:** None. ARCHITECTURE batched in 3.6.

---

#### Increment 3.2 — Types + repository

**What:** `lib/types/theme-merge.ts`, the interface, the Supabase adapter.

**Steps:**

1. Create `lib/types/theme-merge.ts` with `ThemeMerge` and `MergeResult`.
2. Create `lib/repositories/theme-merge-repository.ts` with the interface + typed error classes.
3. Create `lib/repositories/supabase/supabase-theme-merge-repository.ts`:
   - `executeMerge` calls `serviceClient.rpc("merge_themes", { archived_theme_id, canonical_theme_id, acting_user_id })`. On error, inspects `error.code` and throws `MergeValidationError` for `22023`, `MergeNotFoundError` for `P0002`, `MergeRepoError` otherwise. On success, maps the single row to `MergeResult`.
   - `listByWorkspace` selects `*` with workspace scope, ordered by `merged_at DESC`, range pagination.
4. Wire into `lib/repositories/index.ts` and `lib/repositories/supabase/index.ts` barrel re-exports.

**Verification:**

1. `npx tsc --noEmit` passes.
2. From a Node REPL: instantiate `createThemeMergeRepository(serviceClient)` and call `executeMerge` against a dev workspace. Verify the result shape matches `MergeResult`.

**Post-increment:** None.

---

#### Increment 3.3 — Service: `mergeCandidatePair` + `listRecentMerges`

**What:** Implement the two service operations.

**Steps:**

1. Create `lib/services/theme-merge-service.ts`:
   - Imports the candidate repo (for the candidate-id lookup), merge repo, types, errors.
   - `mergeCandidatePair`:
     1. `candidateRepo.getById(candidateId)` → if null, throw `CandidateNotFoundForMergeError`.
     2. Verify candidate.workspace matches the input workspace (defence in depth; API also checks).
     3. Validate `canonicalThemeId` ∈ {`themeAId`, `themeBId`}; otherwise throw `InvalidCanonicalChoiceError`.
     4. Compute `archivedThemeId` as the other side.
     5. `mergeRepo.executeMerge({ archivedThemeId, canonicalThemeId, actorId })`.
     6. Log the result; return.
   - `listRecentMerges`: clamp limit to `[1, MAX_RECENT_TOP_N]`; fetch `limit + 1`; derive `hasMore`; return.
2. Add typed errors and `ListRecentMergesResult` interface.

**Verification:**

1. `npx tsc --noEmit` passes.
2. REPL test: call `mergeCandidatePair` against a dev candidate. Verify success + the candidate row is gone (Decision 25).
3. Call again with a stale candidate id → `CandidateNotFoundForMergeError`.
4. Call with `canonicalThemeId` that's neither side → `InvalidCanonicalChoiceError`.

---

#### Increment 3.4 — API routes

**What:** The two route handlers + Zod validation.

**Steps:**

1. Create `app/api/themes/candidates/[id]/merge/route.ts`:
   - Zod validate `[id]` (UUID) at the param level + body `{ canonicalThemeId: UUID }`.
   - `requireAuth` → `requireWorkspaceAdmin` (forbidden message: "Only workspace admins can merge themes").
   - Build `candidateRepo` + `mergeRepo`.
   - `mergeCandidatePair(...)` inside try/catch:
     - `CandidateNotFoundForMergeError` → 404
     - `InvalidCanonicalChoiceError` → 400
     - `MergeValidationError` → 409 (the merge can't proceed: already archived, cross-workspace, etc.)
     - `MergeNotFoundError` → 404 (themes vanished between candidate refresh and merge)
     - `MergeRepoError` / unexpected → 500
   - Return 200 with `MergeResult`.
2. Create `app/api/themes/merges/route.ts`:
   - Zod validate `?limit=&offset=`.
   - `requireAuth` → `requireWorkspaceAdmin`.
   - Build `mergeRepo`.
   - `listRecentMerges(...)`; return `{ items, hasMore }`.

**Verification:**

1. `npx tsc --noEmit` passes.
2. `curl` round trips for the happy path and each error path. Non-admin team members → 403.

---

#### Increment 3.5 — UI: dialog + recent-merges + wiring

**What:** Build the four UI changes.

**Steps:**

1. Create `app/settings/themes/_components/merge-dialog.tsx`:
   - Props: `candidate: ThemeCandidateWithThemes | null`, `onCancel: () => void`, `onConfirmed: (result: MergeResult) => void`.
   - Internal state: `canonicalThemeId` (defaults to higher-volume side), `isPending`.
   - Renders only when `candidate !== null`; reads from candidate snapshot for the preview.
   - On Confirm: POST → success → `onConfirmed(result)`; failure → toast + keep dialog open.
2. Create `app/settings/themes/_components/recent-merges-section.tsx`:
   - Self-contained: fetches `GET /api/themes/merges?limit=10`. Tracks `limit` for "Show more".
   - Re-export a `refresh()` imperative handle (via `useImperativeHandle` on a `ref` from the parent) so `themes-page-content` can re-fetch after a confirmed merge.
3. Modify `candidate-row.tsx`:
   - Add `onMerge?: (candidate: ThemeCandidateWithThemes) => void` prop.
   - Replace `disabled` + `aria-label="Merge — coming in Part 3"` + `title="Coming soon"` on the "Merge…" button with `onClick={() => onMerge?.(candidate)}`.
4. Modify `themes-page-content.tsx`:
   - Add `dialogCandidate` state.
   - Add `recentMergesRef` (ref forwarded to `RecentMergesSection`).
   - `onMerge(candidate)` opens the dialog by setting state.
   - `onMergeConfirmed(result)` closes the dialog, fires `toast.success("Merged ${result.archivedThemeName} → ${result.canonicalThemeName} (${result.signalAssignmentsRepointed} signals)")`, refetches `listCandidates` and triggers `recentMergesRef.current?.refresh()`.
   - Pass `onMerge` into `<CandidateList />` → `<CandidateRow />`.
   - Render `<RecentMergesSection ref={recentMergesRef} />` below the candidates list.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Smoke test in browser:
   - Click "Merge…" on a candidate → dialog opens with default canonical = higher-volume side.
   - Toggle canonical → preview "X signals will be re-pointed" updates.
   - Confirm → loading state → dialog closes → success toast → candidate row gone → recent-merges section shows the new entry on top.
   - Cancel → dialog closes; candidate row still there.
   - Sign in as non-admin → no Themes nav entry; direct `/api/themes/candidates/<id>/merge` POST returns 403.
3. Mobile width: dialog renders cleanly; recent-merges rows wrap.
4. Dark mode: status pills and disclaimer text legible.

---

#### Increment 3.6 — End-of-part audit

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report.

**Checklist:**

1. **SRP:** `merge-dialog.tsx` does only "show + confirm"; `recent-merges-section.tsx` does only "fetch + render"; the service's two functions don't share state; the RPC is the only place that touches `signal_themes` for a merge.
2. **DRY:** the candidate-snapshot stats power both the dialog preview and the candidate-row footer — single source. No duplicated workspace-membership check between API and service (both go through `requireWorkspaceAdmin` / `matchesWorkspace`). The audit log query reuses `pairKey` semantics where applicable.
3. **Design tokens:** every new colour/spacing on the dialog and the recent-merges section uses CSS custom properties / Tailwind tokens (matching the Part 2 audit's status-token convention).
4. **Logging:** API + service log entry/exit/error; route prefixes are distinct (`[api/themes/candidates/[id]/merge]`, `[api/themes/merges]`); the RPC errors carry SQLSTATE so production grep on `[supabase-theme-merge-repo]` can surface them.
5. **Dead code:** none. The pre-existing "Coming in Part 3" placeholder copy on the Merge button is replaced, not commented out.
6. **Convention compliance:** kebab-case files, PascalCase types, UPPER_SNAKE constants, named exports only, import order per CLAUDE.md.
7. **Database review:** `theme_merges` RLS is read-only for members; INSERT goes through the SECURITY DEFINER RPC; concurrent-merge race is prevented by `FOR UPDATE` on both theme rows.
8. **Error paths:** force the RPC to fail mid-transaction (e.g., temporarily drop a column) and confirm the database is unchanged afterwards (P3.R5 atomic invariant).
9. **ARCHITECTURE.md:**
   - Add `theme_merges` to the data-model section.
   - Add `merge_themes` to the RPC list.
   - File-map entries for the new repo/service/types/UI components.
   - Status line append: "PRD-026 Part 3 (Admin-Confirmed Theme Merge) implemented".
   - New architecture-decision entry covering the atomic-transaction design + the candidates/dismissals cleanup-on-merge invariant + the audit-log-as-snapshot design.
10. **CHANGELOG.md:** new PRD-026 Part 3 entry under `[Unreleased]`.
11. **Verify file references in docs still resolve.**
12. **Re-run flows touched by Part 3:**
    - Capture → AI extraction → background chain (Parts 1–2 paths unchanged).
    - Admin opens `/settings/themes` → list renders → Merge → dialog → Confirm → row gone → recent-merges populated.
    - Dashboard widget that previously surfaced the archived theme now surfaces the canonical one (the `is_archived = false` filter excludes archived rows; signal_themes joins now resolve to canonical).
    - Chat history: previous messages still mention the archived name verbatim; a new chat query for the same topic resolves to the canonical name (P3.R4 verification).
13. **Final:** `npx tsc --noEmit`.

This audit closes Part 3.

---

## Part 4: Notify Affected Users of Merges

> Implements **P4.R1–P4.R4** from PRD-026.

### Overview

Closes the merge-deduplication arc by telling the workspace what just happened. Two user-visible changes; one structural promise that requires no work.

1. **Notification emit on every merge** — the merge route fires a `theme.merged` event into PRD-029's notification primitive after a successful merge. Members see the bell badge, open the dropdown, and read "Theme \"X\" merged into \"Y\"" with a deep-link to `/settings/themes` (renderer is already populated from PRD-029 Part 3).
2. **Recent-merge indicator on theme widgets** — `top_themes`, `theme_trends`, and `theme_client_matrix` show a small `GitMerge` icon next to themes that have been the canonical destination of a merge in the last `THEME_MERGE_INDICATOR_WINDOW_DAYS` (default `7`). Tooltip reads "Recently merged"; the audit detail lives one click away in the "Recent merges" section of `/settings/themes`.
3. **Chat history not modified** — already true post-Part 3 (the merge transaction touches `signal_themes` and `themes`, not `messages`). P4.R3 is verified, not implemented.

The flow on a confirmed merge:

```
Admin clicks Confirm → POST /api/themes/candidates/[id]/merge
   → mergeCandidatePair → executeMerge RPC
   → route returns 200 with MergeResult
   → after() schedules: notificationService.emit({ eventType: "theme.merged",
                                                    payload: ...result,
                                                    teamId,
                                                    broadcast })
   → background: insert workspace_notifications row → Realtime broadcast
   → other members' bells: badge increments, dropdown shows the new row
```

The flow when a member opens the dashboard the next morning:

```
GET /dashboard
   → widgets fetch their data + GET /api/dashboard?action=recently-merged-themes
   → recently-merged-themes returns Set<canonicalThemeId>
   → top_themes / theme_trends / theme_client_matrix render a GitMerge
     indicator on the rows whose ids appear in the set
   → user mouses over → "Recently merged" tooltip → optionally clicks
     /settings/themes for the audit detail
```

### Forward Compatibility Notes

Part 4 is the closing part of PRD-026. No further parts queued. Backlog items the spec deliberately defers:

- **Per-user notification preferences (mute, unsubscribe).** Out of scope; PRD-029 hasn't shipped the preference primitive yet. When it does, `theme.merged` consumes it without a service-shape change.
- **Dashboard indicator with merge details inline (e.g., "Recently merged from 'API Speed'").** First ship: simple `GitMerge` + "Recently merged" tooltip. The audit log on `/settings/themes` is the authoritative source for "what merged into what". Promote to inline detail only if user feedback shows the round trip to settings is friction.
- **Re-extract chat conversations to use canonical names.** PRD-026 P4.R3 explicitly says past chat messages are not rewritten. A future "re-run this conversation" feature would naturally produce canonical names (chat queries read from non-archived themes); not a Part 4 deliverable.
- **Notification suppression for the actor.** Per the existing notification-service shape, broadcasts go to every team member including the actor. Showing the actor a notification about their own action is mildly redundant but harmless. PRD-029's bell already visually deprioritises read rows; a self-suppression filter is a backlog item if it becomes friction.

### Technical Decisions

Continuing the numbering from Parts 1–3's decisions.

25. **Emit happens in the merge route via `after()`, not inside the service.** Service contract for Part 3 was deliberately frozen so Part 4's diff is a single call site (Decision 28 of Part 3 documented this). The route is the right home: it already owns request lifecycle (auth, role check, request → response framing); adding a "fire after response" side effect there matches the `runSessionPostResponseChain` pattern. Service stays focused on "do the merge"; route owns "do the merge AND notify". No service-shape change; `mergeCandidatePair` is unchanged.

26. **Skip emit for personal workspaces.** PRD-029's `workspace_notifications.team_id NOT NULL` schema rules it out anyway, and notifying a personal-workspace owner about their own action has no value (they're the only member). Personal-workspace merges still write the `theme_merges` audit row + the dashboard indicator works (the indicator query is workspace-scoped, not team-scoped). Code-wise: a `if (result.teamId !== null)` guard around the `after()` schedule.

27. **Actor name = `auth.user.email`.** The current `profiles` table carries `{ id, email, is_admin, can_create_team }` — no display name field. Email is the closest human-readable identifier we have, and it's already in `auth.user.email` from `requireAuth` (no additional query). When the project ships a richer profile (display name, avatar URL), this resolves to one line: replace `auth.user.email` with the resolved display name. The notification renderer's `theme.merged` title doesn't surface `actorName` today (it shows "Theme \"X\" merged into \"Y\"" — the actor is the bell row's implicit context); the field is in the payload for future-renderer consumption.

28. **Indicator window: 7 days default, env-tunable via `THEME_MERGE_INDICATOR_WINDOW_DAYS`.** Long enough that a user returning Monday still sees Friday's merge; short enough that the dashboard doesn't accumulate permanent visual noise. The env var is a single-line override for workspaces with different cadences. Tunable from production telemetry without a code deploy.

29. **Indicator data shape: `Set<canonicalThemeId>` from a single workspace-scoped query.** Reads `theme_merges` filtered by workspace + `merged_at >= NOW() - INTERVAL X DAYS`. The `(team_id, merged_at DESC)` index from Part 3 supports it. One query per dashboard load, returns ≤ a handful of ids in any realistic workspace. Map<canonical, archivedNames[]> deferred — the audit log on `/settings/themes` is the detailed source of truth; the dashboard's only job is "this theme had recent merges, click to investigate".

30. **Indicator UI: `GitMerge` lucide icon with "Recently merged" tooltip.** Same icon the notification renderer already uses for `theme.merged` events (cross-surface consistency). Sized at 14px; muted-foreground colour; positioned inline-end of the theme name in each widget. Subtle (doesn't change the theme's primary visual treatment); discoverable (tooltip explains what the icon means). Emoji or "RECENTLY MERGED" pill considered and rejected — too visually loud for a workspace that might have several recent merges.

31. **Indicator-fetching shared via a single dashboard query action, not per-widget.** New `recently-merged-themes` action on `/api/dashboard`. The widgets' existing `useDashboardFetch` hook handles the round trip. One fetch per dashboard render, three consumers — simpler than per-widget fetches that would each independently hit the same query. The action returns `{ themeIds: string[] }`; the widget code derives `Set<string>` for membership testing.

### Database Changes

**None.** Part 4 reads from the existing `theme_merges` table (added in Part 3) and writes to `workspace_notifications` (added in PRD-029 Part 1) via the existing `notificationService.emit` API. No new tables, no new RPCs, no schema migrations.

### Type Definitions

**No new domain types.** `theme.merged`'s payload type (`ThemeMergedPayload`) and the `WorkspaceNotification` shape are already exported from `@/lib/notifications/events` and `@/lib/types/notification` respectively.

A small dashboard-action type addition for the new query action — already implied by the existing `QueryAction` registry pattern in `lib/services/database-query/action-metadata.ts`.

### Service Changes

**No new service file.** Part 4 reuses two existing services:

- `lib/services/notification-service.ts` (PRD-029 Part 1) — `emit({ eventType, payload, teamId, userId? })`.
- `lib/services/theme-merge-service.ts` (Part 3) — unchanged.

A new query helper lives in:

- `lib/services/database-query/shared/theme-helpers.ts` — adds `fetchRecentlyMergedThemeIds(serviceClient, workspaceCtx, windowDays)`. Returns `Promise<Set<string>>` of canonical theme ids merged within the window. Uses the existing `(team_id, merged_at DESC)` index. Co-located with the existing theme-helper functions for cohesion.

### API Route Changes

#### Modify: `app/api/themes/candidates/[id]/merge/route.ts`

After `mergeCandidatePair` resolves, schedule the notification emit via `next/server`'s `after()`:

```typescript
import { after } from "next/server";
import { createNotificationRepository } from "@/lib/repositories/supabase/supabase-notification-repository";
import { emit as emitNotification } from "@/lib/services/notification-service";

// After existing mergeCandidatePair success path, before NextResponse.json:
if (result.teamId !== null) {
  after(async () => {
    try {
      const notificationRepo = createNotificationRepository(wsAdmin.serviceClient);
      await emitNotification(notificationRepo, {
        eventType: "theme.merged",
        teamId: result.teamId,
        // userId omitted → broadcast to all team members.
        payload: {
          archivedThemeId: result.archivedThemeId,
          archivedThemeName: result.archivedThemeName,
          canonicalThemeId: result.canonicalThemeId,
          canonicalThemeName: result.canonicalThemeName,
          actorId: auth.user.id,
          actorName: auth.user.email ?? "unknown",
          signalAssignmentsRepointed: result.signalAssignmentsRepointed,
        },
      });
    } catch (err) {
      console.error(
        `${LOG_PREFIX} POST — notification emit failed (merge succeeded):`,
        err instanceof Error ? err.message : err
      );
    }
  });
}
```

**Why a try/catch around the emit:** the notification is a side effect of the merge, not a precondition. A failed emit must not surface as a merge failure to the user; the merge already committed and the audit row is the durable record. Logging the failure server-side gives observability without affecting UX.

**Why `if (result.teamId !== null)`:** Decision 26.

**Why `auth.user.email ?? "unknown"`:** `User.email` is technically `string | undefined` per Supabase's types, though in practice every authenticated user has one. The `?? "unknown"` is a defensive fallback; the renderer's title doesn't show `actorName` today, so the value only ever surfaces if a future renderer change adds it.

Add `export const maxDuration = 60` to the route file (matches `runSessionPostResponseChain`'s pattern from PRD-023 — keeps the function instance alive past the JSON response until the `after()` callback resolves; raises the Hobby-tier ceiling from 10s).

#### Modify: `lib/services/database-query/action-metadata.ts` and the executor

Add a `recently-merged-themes` action:
- Input: workspace scope (already standard).
- Output: `{ themeIds: string[] }`.
- Implementation: calls `fetchRecentlyMergedThemeIds` from `theme-helpers.ts`.

The chat tool surface should NOT expose this action — it's a dashboard-only thing; the `ACTION_METADATA` registry's `chatExposed: false` flag (or equivalent) keeps it off the LLM tool surface.

### UI Changes

```
app/dashboard/_components/widgets/
├── top-themes-widget.tsx                 # MODIFY — render GitMerge icon
│                                            inline-end of each theme row
│                                            whose id is in recentlyMergedSet
├── theme-trends-widget.tsx               # MODIFY — same indicator on each
│                                            line's legend label
└── theme-client-matrix-widget.tsx        # MODIFY — same indicator on the
                                             theme row label

components/dashboard/
└── recent-merge-indicator.tsx            # NEW (small) — shared GitMerge +
                                             tooltip wrapper used by all
                                             three widgets so the visual
                                             treatment stays consistent
```

`recent-merge-indicator.tsx` exports a single `<RecentMergeIndicator />` component:
- Renders a 14px `GitMerge` icon from `lucide-react`.
- Wrapped in a tooltip ("Recently merged") using the project's existing tooltip primitive (or a `title` attribute as a minimum).
- Uses `text-muted-foreground` so it doesn't compete with the theme name.

Each widget receives the `recentlyMergedSet` (a `Set<string>` of canonical theme ids) — either via prop drilling from a dashboard-level fetch, or by each widget independently calling the new `recently-merged-themes` action via `useDashboardFetch`. Per Decision 31, the cleaner version is a shared dashboard-level fetch + context provider, but per-widget fetch is acceptable if the implementation cost is comparable.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/api/themes/candidates/[id]/merge/route.ts` | Modify | Schedule `notificationService.emit` via `after()` on success; skip personal workspaces; `maxDuration = 60` declaration |
| `lib/services/database-query/shared/theme-helpers.ts` | Modify | Add `fetchRecentlyMergedThemeIds(serviceClient, workspaceCtx, windowDays)` |
| `lib/services/database-query/action-metadata.ts` | Modify | Register `recently-merged-themes` action |
| `lib/services/database-query/domains/themes.ts` (or wherever theme-action handlers live) | Modify | Implement the `recently-merged-themes` handler — delegates to the helper |
| `app/api/dashboard/route.ts` | Modify (only if Zod schema enumerates the action) | Add `recently-merged-themes` to the validated action enum |
| `components/dashboard/recent-merge-indicator.tsx` | **Create** | Shared `GitMerge` + tooltip wrapper |
| `app/dashboard/_components/widgets/top-themes-widget.tsx` | Modify | Render `<RecentMergeIndicator />` inline-end of theme rows whose id is in the set |
| `app/dashboard/_components/widgets/theme-trends-widget.tsx` | Modify | Same — on legend labels |
| `app/dashboard/_components/widgets/theme-client-matrix-widget.tsx` | Modify | Same — on row labels |
| `ARCHITECTURE.md` | Modify | RPC list unchanged; status line append; brief note on the Part 4 indicator + emit chain |
| `CHANGELOG.md` | Modify | PRD-026 Part 4 entry |

### Implementation

#### Increment 4.1 — Emit `theme.merged` from the merge route

**What:** Wire the notification emit into the merge route's success path via `after()`.

**Steps:**

1. Open `app/api/themes/candidates/[id]/merge/route.ts`.
2. Add imports: `after` from `next/server`, `createNotificationRepository` from the Supabase adapter, `emit as emitNotification` from the notification service.
3. Add `export const maxDuration = 60` at the top (matching the existing `runSessionPostResponseChain` pattern).
4. After `mergeCandidatePair` resolves and *before* `NextResponse.json(result)`, schedule the emit per the §API Route Changes snippet, guarded by `if (result.teamId !== null)`.
5. Wrap the emit in try/catch so a notification failure logs but doesn't surface as a merge failure.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Smoke test in browser:
   - Log in as admin in a team workspace; click Merge on a candidate.
   - Confirm: merge succeeds; bell on a *different* signed-in member's session shows a new unread badge within Realtime's window; opening the dropdown shows "Theme \"X\" merged into \"Y\"" with `GitMerge` icon and `/settings/themes` deep-link.
3. Personal workspace merge: confirm no `workspace_notifications` row was inserted (the schema rules it out anyway, and the route's guard skips the emit).
4. Failure mode: temporarily stop the notifications insert (e.g., disable RLS or revoke a policy) and merge. Confirm: merge still succeeds, response returns 200 with `MergeResult`, server logs `[api/themes/candidates/[id]/merge] POST — notification emit failed (merge succeeded):` with the underlying error.

**Post-increment:** None. ARCHITECTURE batched in 4.3.

---

#### Increment 4.2 — Recent-merge indicator on dashboard widgets

**What:** Add the helper, the dashboard action, the shared indicator component, and wire it into the three theme widgets.

**Steps:**

1. Add `fetchRecentlyMergedThemeIds(serviceClient, workspaceCtx, windowDays)` to `lib/services/database-query/shared/theme-helpers.ts`. Reads `theme_merges` filtered by workspace + `merged_at >= NOW() - INTERVAL X DAYS`. Returns `Set<string>` (or `string[]`; widgets can wrap).
2. Read `THEME_MERGE_INDICATOR_WINDOW_DAYS` env var (default `7`) at the helper's call site (matches `theme-prevention.ts`'s threshold-read pattern with validation + warning fallback).
3. Register `recently-merged-themes` action in `action-metadata.ts` (with `chatExposed: false` so the LLM tool doesn't see it). Wire the handler to the helper.
4. Update `app/api/dashboard/route.ts`'s Zod action enum (if the existing pattern uses one).
5. Create `components/dashboard/recent-merge-indicator.tsx` — small wrapper around `GitMerge` (14px) + tooltip ("Recently merged").
6. Update each of `top-themes-widget.tsx`, `theme-trends-widget.tsx`, `theme-client-matrix-widget.tsx`:
   - Fetch the `recently-merged-themes` action's data alongside the widget's primary fetch.
   - For each theme rendered, conditionally render `<RecentMergeIndicator />` inline-end of the name when the id is in the set.

**Verification:**

1. `npx tsc --noEmit` passes.
2. Smoke test in browser:
   - Confirm a merge in a workspace.
   - Open `/dashboard` — the canonical theme should show the `GitMerge` icon next to its name in `top_themes`, `theme_trends`, and `theme_client_matrix`.
   - Hover the icon — tooltip reads "Recently merged".
   - Wait > `THEME_MERGE_INDICATOR_WINDOW_DAYS` (or set the env to `0` for the test) — the indicator disappears on next dashboard load.
3. Mobile/dark-mode check: the indicator is legible and doesn't break the row layout.

**Post-increment:** None.

---

#### Increment 4.3 — End-of-part audit + ARCHITECTURE.md + CHANGELOG.md

Per CLAUDE.md "End-of-part audit" — produces fixes, not a report. Genuine pass (per Part 3's audit lesson — explicitly grep `lib/utils/` and `lib/api/` before writing new helpers; explicitly check every count-interpolating UI string for `count === 1` correctness).

**Checklist:**

1. **SRP:** the merge route owns "do the merge + schedule notification" (one bounded responsibility). Service unchanged. The dashboard helper does only "fetch recent canonical theme ids". The indicator component does only "render the icon + tooltip".
2. **DRY:** `RecentMergeIndicator` is the single place that renders the GitMerge icon for the dashboard; the three widgets reuse it. Helper is one function. Env-var read pattern matches Parts 1–2.
3. **Design tokens:** indicator uses defined CSS vars / shadcn tokens (`text-muted-foreground` or `var(--text-muted)`). No hardcoded colours.
4. **Logging:** notification emit failure logs at the route level with `[api/themes/candidates/[id]/merge]` prefix. Dashboard helper logs at `[theme-helpers]` (matches existing helper-log convention).
5. **Dead code:** no unused imports; no commented-out code. Confirm Part 4's diff in the merge route doesn't leave a stub.
6. **Convention compliance:** kebab-case files, PascalCase types, named exports, import order per CLAUDE.md.
7. **Database review:** no new schema; the `theme_merges` query uses the existing index. Workspace-scope check is reused.
8. **Error paths:** verify the emit failure doesn't surface as a 500 to the user; verify a personal-workspace merge doesn't hit the emit at all.
9. **ARCHITECTURE.md:**
   - Status line: append "PRD-026 Part 4 (Notify Affected Users of Merges) implemented".
   - Add a brief description of the indicator + the `theme.merged` emit chain to the dashboard architecture decision (or a new entry).
   - File map: add `components/dashboard/recent-merge-indicator.tsx` and the new `recently-merged-themes` query action.
10. **CHANGELOG.md:** new PRD-026 Part 4 entry under `[Unreleased]`.
11. **Verify file references in docs still resolve.**
12. **Re-run flows touched by Part 4:**
    - Capture → AI extraction → background chain (Parts 1–2 paths unchanged).
    - Admin opens `/settings/themes` → list renders → Merge → dialog → Confirm → row gone → recent-merges populated → other team members see bell badge → bell dropdown shows the rendered notification.
    - Member opens `/dashboard` → canonical theme shows the GitMerge indicator.
    - Chat history: previous messages still mention the archived name verbatim; a new chat query for the same topic resolves to the canonical name (P4.R3 verification).
13. **Final:** `npx tsc --noEmit`.

This audit closes Part 4 and the entirety of PRD-026.

---

## Backlog (PRD-026 closure)

Items the four parts deliberately deferred. Re-evaluate after PRD-026 has been live in production for a full quarter.

- **LLM-judged candidate filtering** (Part 2 backlog).
- **Automatic merge of very-high-confidence pairs** (Parts 2–3 backlog).
- **Reverse-merge / unmerge UI** (Part 3 backlog — the data substrate exists; only UI + reverse-RPC missing).
- **Bulk merge** (Part 3 backlog).
- **Per-workspace tunable similarity / candidate / indicator thresholds** (Parts 1–4 backlog — three env vars currently global).
- **True background cron for candidate refresh** (Part 2 backlog — replaced by stale-on-mount in Increment 2.6 per Decision 20).
- **Theme synonym/topic hierarchy** (PRD-026 backlog).
- **Cross-workspace theme suggestions** (PRD-026 backlog).
- **Inline merge details on dashboard indicator** (Part 4 backlog — currently a generic "Recently merged" tooltip).
- **Notification suppression for the actor** (Part 4 backlog).
