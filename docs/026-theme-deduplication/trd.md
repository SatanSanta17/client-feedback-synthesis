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

## Parts 2–4

> Specified after Part 1 lands and the prevention threshold has accumulated telemetry. Each subsequent part will append a "Part N" section here, mirroring the structure above, and must respect the data shapes locked in by Part 1 (`themes.embedding`, `themes.merged_into_theme_id`, `buildThemeEmbeddingText`).
