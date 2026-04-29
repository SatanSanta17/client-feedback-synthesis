# PRD-026: Theme Deduplication

## Purpose

Theme reuse during signal extraction is determined by case-insensitive name matching (`ilike`). Semantically equivalent themes with different wording — "API Performance", "API Speed", "API Latency" — are treated as distinct and accumulate over time. The `top_themes`, `theme_trends`, and `theme_client_matrix` dashboard widgets fragment signal across near-duplicate rows; the chat tool's theme-related actions return diluted answers; the workspace's theme list grows unboundedly.

Two missing pieces drive this:

- **No prevention at write-time.** When the LLM proposes a "new" theme during extraction, we trust it. There's no semantic check against existing themes — a synonym slips through as a fresh row.
- **No repair for what's already accumulated.** Existing duplicates stay duplicated forever; there's no merge mechanism, manual or automatic.

This PRD addresses both: an embedding-based prevention guard at theme-creation time, a platform-curated list of merge candidates so admins don't have to audit the full taxonomy themselves, and an admin-confirmed merge surface that makes the cleanup explicit, visible, and safe.

## User Story

As an end user, I want my dashboard widgets to aggregate signal under a stable, non-fragmented theme taxonomy — so "API Performance" doesn't show up as three rows pretending to be three different topics.

As a workspace admin, I want the platform to tell me which themes look like duplicates and rank them by how much they matter — so reviewing the taxonomy is a 5-minute curated task, not a multi-hour audit. I want to confirm each merge with full visibility into what it will affect, and I want the action to be deliberate (not automatic) because I'm the one who knows whether two similar names are actually the same concept in our domain.

As a workspace member, I want a clear notification when a theme merge changes what my dashboard shows — so a name change in a widget doesn't feel like a glitch.

---

## Part 1 — Embedding-Based Prevention at Theme Creation

**Severity:** Medium-High — every extraction is a new chance to introduce duplicates. Without this part, manual merges become a treadmill.

### Requirements

**P1.R1 — Themes carry a vector representation.**
Every theme has an embedding derived from its name and description. Themes created before this part is shipped backfill their embeddings as part of rollout. After this part, no theme exists without an embedding.

**P1.R2 — A semantic-similarity check runs before any new theme is created.**
When the LLM proposes a "new" theme during signal extraction (or any future theme-creating code path), the proposed theme's name+description is embedded, compared against existing themes in the same workspace, and if the highest similarity exceeds a configured threshold, the existing theme is reused instead of inserting a duplicate.

**P1.R3 — The threshold is conservative by default.**
The default threshold is set high enough that the prevention mechanism rejects only confident matches. Genuinely-distinct themes ("API Performance" vs "API Cost") are never collapsed. The exact threshold value is pinned in the TRD with telemetry justification; the PRD's requirement is that prevention biases toward false-negatives (let some duplicates through) over false-positives (collapse distinct themes). Residual duplicates that slip through are caught by Part 2.

**P1.R4 — Prevention is observable.**
Every prevention decision (matched-and-reused, no-match-created-new) logs the proposed theme name, the matched theme name (if any), and the similarity score. This is what tunes the threshold over time.

**P1.R5 — Prevention does not perceptibly slow extraction.**
Adding the embedding generation + similarity search to `assignSessionThemes` does not add user-noticeable latency to the post-response chain. The TRD picks the implementation (precomputed theme-embeddings index, batched comparison, etc.) that meets this bar.

**P1.R6 — Exact name match remains the fast-path.**
A case-insensitive name match short-circuits the embedding check entirely — there's no value in re-comparing "API Performance" to "API Performance" via vector math. Only when name match fails does the similarity check run.

### Acceptance Criteria

- [ ] P1.R1 — Every row in `themes` has a non-null embedding column. A backfill script runs once during rollout to populate existing themes.
- [ ] P1.R2 — A new extraction that would have created "API Speed" when "API Performance" already exists in the same workspace produces zero new theme rows; the signal is assigned to "API Performance" instead.
- [ ] P1.R3 — Verified by a hand-curated set of "should-merge" and "should-not-merge" theme pairs; the threshold rejects all "should-not-merge" pairs.
- [ ] P1.R4 — Logs from theme assignment include the per-decision similarity score and matched theme name.
- [ ] P1.R5 — Chain timing logs do not show a step-change in p95 latency before vs. after this part lands.
- [ ] P1.R6 — Profiling shows exact-name match short-circuits before embedding generation when the proposed name matches an existing theme exactly.

---

## Part 2 — Platform-Suggested Merge Candidates

**Severity:** Medium — this is what makes Part 3 (admin merge) usable at scale. Without curated suggestions, an admin facing 200 themes won't review them.

### Requirements

**P2.R1 — The platform produces a ranked list of merge candidates per workspace.**
The candidate list is derived from theme embeddings — pairs of themes whose embedding similarity exceeds a "candidate" threshold (lower than the prevention threshold in P1, so we cast a wider net for human review than for automatic prevention). The list is the admin's starting point; they don't browse all themes.

**P2.R2 — Candidates are ranked by impact, not just similarity.**
Ranking factors that the TRD composes into a single score:
- **Similarity** — how confident the platform is that the pair is a duplicate.
- **Signal volume** — the total `signal_themes` assignment count across both themes (merging two themes with 50 + 80 assignments matters more than merging two with 1 + 1).
- **Recency** — pairs touching recently-active themes rank above pairs of stale ones.

A pair with very high similarity but trivial volume should sit below a pair with merely-good similarity but heavy volume. The TRD pins the exact weighting; the PRD's requirement is that the top of the list is where the admin's time pays off the most.

**P2.R3 — Each candidate explains itself.**
Every pair shown to the admin includes: both theme names + descriptions, the similarity score (or a human-readable confidence indicator), the assignment count for each side, the count of distinct sessions/clients each side touches, and a one-line "why this looks like a duplicate" hint (e.g., the closest matching tokens or a short LLM-generated rationale — the TRD picks).

**P2.R4 — The list is bounded and reviewable in one sitting.**
The default surface shows the top N candidates (e.g., top 20). Beyond that, the admin can opt to see lower-ranked candidates explicitly. Volume is gated so a workspace with hundreds of theoretical candidate pairs doesn't drown the admin in noise.

**P2.R5 — Admins can dismiss a candidate without merging.**
If two themes look similar but are domain-distinct ("API Performance" and "API Latency" might genuinely be tracked separately in some workspaces), the admin can mark the pair as "not a duplicate." Dismissed pairs are excluded from the candidate list going forward unless the underlying themes change materially. This is what keeps the list fresh and trustworthy across runs.

**P2.R6 — Candidate generation runs on demand and on a low cadence.**
Admins can trigger a refresh manually. The candidate list also refreshes periodically in the background (the TRD pins the cadence — e.g., once per day) so admins arriving at the surface always see a reasonably-current view without paying generation cost on every page load.

**P2.R7 — Candidates surface on a dedicated admin page.**
The candidate list is rendered on `/settings/themes` (admin-gated, alongside the existing `/settings/team` and `/settings/prompts` surfaces). Non-admins see no entry in the settings nav and the route returns 403 if reached directly. `/settings/themes` is also where merge confirmation (Part 3) and the recent-merges audit log (P3.R7) live — a single screen for the entire deduplication workflow.

### Acceptance Criteria

- [ ] P2.R1 — A workspace admin opening the merge surface sees a list of candidate pairs derived from theme embeddings, not the full theme taxonomy.
- [ ] P2.R2 — A candidate pair with low signal volume but very high similarity ranks below a pair with merely-good similarity but heavy signal volume. Verified by a curated test workspace.
- [ ] P2.R3 — Each candidate row shows both names, both descriptions, both assignment counts, both client/session counts, the confidence indicator, and a hint at why the pair was flagged.
- [ ] P2.R4 — The default view shows a bounded number of candidates; expanding to "see more" is an explicit user action.
- [ ] P2.R5 — Dismissing a pair removes it from subsequent renders of the candidate list. The dismissal is workspace-scoped and persists.
- [ ] P2.R6 — A manual refresh recomputes candidates; an automatic refresh runs on the configured cadence with no admin action.
- [ ] P2.R7 — `/settings/themes` exists, is admin-gated at both the UI nav and the API layer, and is the home for candidates, merge confirmation, and the audit log.

---

## Part 3 — Admin-Confirmed Theme Merge

**Severity:** Medium — addresses already-accumulated debt and the residual duplicates that slip past Part 1. Lower urgency than P1 (which is the bleed-stopper) but lands the user-visible cleanup.

### Requirements

**P3.R1 — Merging is admin-only.**
Only workspace admins (and owners) can confirm a merge. Members and viewers see no merge UI. The action is gated at both the API and UI layers.

**P3.R2 — Each merge shows a blast-radius preview before confirmation.**
Before confirming, the admin sees: the canonical theme they're keeping, the theme being merged into it, the count of signal assignments that will be re-pointed, and the count of distinct sessions/clients affected. The preview also states explicitly that *past chat message text is not modified* — only re-runs of the same query reflect the canonical name. This is the "I see what I'm about to do" moment.

**P3.R3 — The admin chooses which theme is canonical.**
The merge is directional. The admin picks which name and description survives; the other is archived. The default proposal is the theme with more existing signal assignments, but the admin can flip it.

**P3.R4 — Merge does not lose data.**
After merge: every `signal_themes` row that pointed to the archived theme now points to the canonical theme. The archived theme row is not deleted — it's marked archived with a pointer to the canonical (so the merge is auditable and theoretically reversible). No signal assignment is lost; no chat-history message text is rewritten.

**P3.R5 — Merge is atomic.**
A merge that fails partway leaves the workspace in its pre-merge state — no half-merged signal_themes, no archived theme without re-pointed children. The TRD pins the transactional mechanism; the PRD's requirement is that there is no observable intermediate state.

**P3.R6 — Merge frequency is admin-controlled, not automatic.**
There is no scheduled job that auto-merges on a threshold. Candidates surface (Part 2); the merge itself only happens when an admin confirms. This is intentional — frequency is gated by deliberate human action so users don't experience mysterious dashboard renames.

**P3.R7 — Merge history is visible to admins.**
The admin surface includes a "Recent merges" view: which pairs were merged, by whom, when, and how many assignments were affected. This is the audit trail.

**P3.R8 — Merge confirmation runs through a modal dialog on `/settings/themes`.**
Clicking a candidate row opens a confirmation dialog hosting the blast-radius preview (P3.R2) and the canonical-flip toggle (P3.R3). On confirm, the merge runs server-side, the row leaves the candidates section, the actor sees a success toast, and the workspace notification (Part 4) fires for other members. The "Recent merges" view (P3.R7) renders as a sibling section on the same page so the audit trail is one click away from the action that produced it.

### Acceptance Criteria

- [ ] P3.R1 — A non-admin viewing the same workspace sees no merge UI; the merge API returns 403 for non-admin callers.
- [ ] P3.R2 — Confirming a merge prompts a preview that names the canonical theme, the merging theme, the assignment count, the affected session/client counts, and the chat-history-preserved disclaimer. The admin must explicitly confirm.
- [ ] P3.R3 — The admin can swap which theme is canonical from the preview before confirming.
- [ ] P3.R4 — Post-merge: `SELECT count(*) FROM signal_themes WHERE theme_id = <archived>` returns zero; the archived theme row exists with `is_archived = true` and a pointer to the canonical; no chat message text is modified.
- [ ] P3.R5 — Forcing the re-point step to fail (manually) leaves the merge fully rolled back — the archived theme is still active, signal_themes is unchanged.
- [ ] P3.R6 — No background job auto-merges themes. Candidate pairs surface but require admin click to act.
- [ ] P3.R7 — A "Recent merges" view shows pairs merged, actor, timestamp, and assignment count.
- [ ] P3.R8 — Confirming a merge from the candidates list goes through a modal dialog on `/settings/themes`; on success the actor sees a toast and the candidate row disappears without a full page reload.

---

## Part 4 — Notify Affected Users of Merges

**Severity:** Low-Medium — pure UX. Without this, dashboards quietly rename rows and users wonder "did this just break?"

### Requirements

**P4.R1 — Workspace members are notified when a merge happens.**
The merge action emits a `theme.merged` event into the workspace notification primitive (see PRD-029). Members see a non-blocking notification — surfaced through whatever UI PRD-029 ships (header bell, dropdown, etc.) — that names the two themes merged and the canonical theme.

**P4.R2 — Affected dashboard widgets show a transient indicator.**
Widgets that depend on theme aggregation (`top_themes`, `theme_trends`, `theme_client_matrix`) display a subtle indicator on the affected theme for a configurable window after the merge — long enough that a user returning the next morning still sees it, short enough that it doesn't become permanent visual noise.

**P4.R3 — Chat history text is unchanged.**
Past assistant messages that named the merged theme literally are not rewritten. Only newly-generated chat responses reflect the canonical name. This is also stated in the merge preview (P3.R2) so admins set the same expectation before clicking.

**P4.R4 — Notifications consume a shared primitive.**
This PRD does not introduce its own notification surface. It depends on the workspace notification primitive specified in PRD-029 — table, service, and bell UI — that this part subscribes to via the `theme.merged` event type. PRD-029 (or at minimum the part of it that delivers the table, service, and bell UI) must land before P4.R1 can be implemented. Other workspace-level events (bulk re-extract completion, PRD-025 purge runs, PRD-028 supersession proposals) flow through the same primitive.

### Acceptance Criteria

- [ ] P4.R1 — A merge confirmed by an admin produces a `theme.merged` notification visible to other workspace members through the PRD-029 notification surface.
- [ ] P4.R2 — Affected dashboard widgets show the canonical theme with a "recently merged" indicator for the configured window post-merge.
- [ ] P4.R3 — Past chat messages referencing the archived theme name remain verbatim in the DB; a re-run of the same chat query produces the canonical name.
- [ ] P4.R4 — The merge notification flows through PRD-029's primitive; this PRD adds no bespoke notification UI of its own.

---

## Backlog

Items intentionally deferred — real follow-ups, but not load-bearing on closing E10.

- **LLM-judged candidate filtering.** Embedding similarity is cheap and good enough to nominate candidates. A second-pass LLM judgment ("are these two themes the same concept?") on the top candidates could raise precision further. Deferred until candidate-list quality becomes the bottleneck.
- **Automatic merge of very-high-confidence pairs.** The current design is admin-confirmed only. If candidate-list curation becomes a meaningful admin chore, an opt-in "auto-merge above 0.95" toggle could ship later. Not now — the user-confidence cost of getting it wrong is too high.
- **Theme synonym/topic hierarchy.** A two-tier taxonomy (canonical "topics" with synonym "themes" nested underneath) is more expressive but a bigger architectural change. Deferred.
- **Reverse-merge / unmerge.** The archived theme keeps its row + signal-assignment audit, so reversing is theoretically possible. No UI for it; deferred until anyone asks.
- **Bulk merge.** The current design is one-pair-at-a-time. A "merge all suggested pairs above X confidence" power-user action could land later. Out of scope for the first ship.
- **Cross-workspace theme suggestions.** "Workspaces like yours have themes named X, Y, Z" as a starting taxonomy. Out of scope; touches privacy + product positioning.
- **Per-workspace tunable similarity threshold.** Currently a single global value for prevention and a single global value for candidate generation. A larger workspace with finer-grained themes might want them lower; smaller might want them higher. Deferred until a workspace asks.
