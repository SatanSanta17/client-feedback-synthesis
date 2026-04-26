# PRD-027: Testing Foundation

## Purpose

The codebase has the structural ingredients for testability — repository pattern, framework-agnostic services, an existing `MockSessionRepository` — but no test runner, no test files, and no CI step. Every PRD that ships ships untested business logic; every regression is discovered in production or by manual walkthrough; the cost of retrofitting tests across the codebase compounds with every part shipped.

The fix is not "add tests everywhere." That's a treadmill that's never finished and never enforced. The fix is to seed *just enough* infrastructure that writing a test for new work is a 30-second activation rather than a setup task, plus a CI gate that makes "did this break the existing tests?" a visible question on every PR. From there, the project rules treat tests as a normal part of acceptance criteria for future PRDs — the suite grows organically with new work, not as a separate project.

This PRD locks in the test stack, wires the CI gate, seeds tests for the highest-risk services so the practice is real before it's institutional, and updates the development rules so new PRDs include test acceptance criteria where applicable.

## User Story

As a developer, I want a test runner already configured so writing a test for new business logic is a 30-second activation — not a setup task that blocks every new PRD.

As a code reviewer, I want a CI step that runs the test suite on every PR and fails when tests fail, so broken or untested critical-path changes can't merge silently.

As future-me maintaining a service that someone else extended, I want the highest-risk services (extraction chain, theme assignment, AI calls, database queries) covered enough that a regression in those paths surfaces in CI before it reaches production.

As a contributor reading the project rules, I want a clear, documented expectation that new service-layer code ships with tests — so the discipline is part of the process, not a per-reviewer judgement call.

---

## Part 1 — Test Runner and CI Gate

**Severity:** Medium — without this, the rest of the work has nowhere to land. Must ship before Parts 2 or 3 are meaningful.

### Requirements

**P1.R1 — A test runner is installed and configured for the project.**
The runner supports TypeScript natively (no separate transpile step), works with the project's existing module resolution (path aliases like `@/lib/...` resolve correctly in tests), and runs in both Node and a JSDOM environment so the same runner serves service tests today and component tests later. The TRD pins the specific runner.

**P1.R2 — `npm test` runs the suite locally.**
A `test` script in `package.json` runs the full suite. Watch mode is available via a documented flag for development. Running tests does not require any setup beyond `npm install`.

**P1.R3 — A CI step runs tests on every pull request.**
Every PR opened against `main` triggers a CI run that includes the test step. The step's output is visible on the PR; a failing test blocks merge. The CI configuration lives in the repo so the gate is code-reviewable.

**P1.R4 — Test runs are deterministic.**
The seed test suite contains no flaky tests, no network calls, no time-dependent assertions, and no shared mutable state across files. Tests pass on a clean machine and pass identically on CI.

**P1.R5 — Test runs are fast enough not to discourage developers.**
The full seed suite runs in well under a minute locally and on CI. The TRD pins the exact ceiling; the PRD's requirement is that running tests does not feel like a tax.

### Acceptance Criteria

- [ ] P1.R1 — A test runner is installed; importing a service via `@/lib/services/...` works inside a test file.
- [ ] P1.R2 — `npm test` runs the suite from a clean clone after `npm install`, with no extra setup.
- [ ] P1.R3 — Opening a PR triggers CI; the CI run reports test results on the PR; a deliberately broken test causes the merge gate to fail.
- [ ] P1.R4 — The seed suite runs 10 times in a row locally and on CI with identical results.
- [ ] P1.R5 — The seed suite completes within the latency ceiling pinned in the TRD on a representative CI runner.

---

## Part 2 — Seed Service-Layer Tests

**Severity:** Medium — these are the tests that make the foundation worth having. Without them, P1 is plumbing without water.

### Requirements

**P2.R1 — The five highest-risk services have happy-path tests.**
Each of the following services ships with at least its primary happy-path covered:
- `session-service` — create, update, delete flows (uses existing `MockSessionRepository`).
- `theme-service` — `assignSessionThemes` with a mocked AI response and a mocked theme repo.
- `embedding-orchestrator` — `generateSessionEmbeddings` with chunked input and a mock embedding repo.
- `ai-service` — `callModel` / `callModelObject` with a mocked provider.
- `database-query-service` — at least one action per domain (counts, themes, drill-downs).

The "happy path" for each is the contract the rest of the system relies on; the test fails if that contract changes silently.

**P2.R2 — Each seed service has at least one known-failure-mode test.**
For each service in P2.R1, at least one failure scenario that has bitten the project (or that is structurally likely) is tested. Examples: AI provider 429 with successful retry, embedding repo upsert failure, mismatched chunk/embedding-id counts in theme assignment, invalid input rejected at the service boundary. The failures-bitten list is captured in the TRD; the requirement is that no seed service has only happy-path coverage.

**P2.R3 — Mocks are reusable and centralised.**
The existing `MockSessionRepository` pattern is followed: any new mock repository (theme, embedding, signal-theme, ai-service) lives in `lib/repositories/mock/` (for repos) or an equivalent `lib/services/mock/` (for service mocks like AI). Tests do not invent ad-hoc mocks inline.

**P2.R4 — Tests do not call external services.**
No test makes a network call, hits Supabase, or invokes an AI provider. Every external dependency is mocked at the repository or service-mock boundary.

**P2.R5 — Test files are co-located or mirrored in a discoverable structure.**
The TRD picks the convention (co-located `service-name.test.ts` next to the source file, or a parallel `tests/` tree). The requirement is that finding the test for a given service is mechanical, not a search.

### Acceptance Criteria

- [ ] P2.R1 — Every named service has at least one happy-path test that asserts the service's primary contract.
- [ ] P2.R2 — Every named service has at least one failure-mode test; the failure list is documented in the TRD.
- [ ] P2.R3 — All mocks live in the chosen central location; no test file defines an inline mock for a repository or service that another test would also need.
- [ ] P2.R4 — Running the suite with the network disabled produces identical results to running it online.
- [ ] P2.R5 — Locating the test file for a given service is a single navigation step from the service file (per the TRD's chosen convention).

---

## Part 3 — Make Tests a Default Part of Acceptance Criteria

**Severity:** Low — pure documentation / process. Without this, the seed tests stay frozen at five services and never grow.

### Requirements

**P3.R1 — `CLAUDE.md` is updated to require tests in acceptance criteria for new service-layer work.**
The Development Process section is updated so that new PRDs touching service-layer code include test coverage in their acceptance criteria. The bar is the same as P2.R1/R2: at minimum, a happy-path test plus one failure-mode test per new service function or service file. PRDs that introduce only UI components or thin route handlers may exempt themselves explicitly.

**P3.R2 — The Quality Gates section adds a "tests pass" check.**
"Before every push" gains: tests pass locally. End-of-part audit gains: new service code introduced in this part has tests; existing tests still pass.

**P3.R3 — `ARCHITECTURE.md` documents the testing convention.**
A short section describes: where tests live (per the convention chosen in P2.R5), how to run them, what the seed services covered, and the rule that mocks live in the central location. Future contributors find the path without asking.

**P3.R4 — PRD-027 itself sets the example.**
This PRD's acceptance criteria already include test-shaped checks for the seed services. Subsequent PRDs follow the same pattern.

### Acceptance Criteria

- [ ] P3.R1 — `CLAUDE.md` Development Process section explicitly requires tests for new service-layer work; the exception conditions are spelled out.
- [ ] P3.R2 — `CLAUDE.md` Quality Gates section includes "tests pass" before every push and within the end-of-part audit.
- [ ] P3.R3 — `ARCHITECTURE.md` has a "Testing" section covering location, run command, seed coverage, and mock convention.
- [ ] P3.R4 — A new PRD opened after this one (any of PRD-025, PRD-026, or a successor) includes test-shaped acceptance criteria for any service-layer requirement, by inspection.

---

## Backlog

Items intentionally deferred — real follow-ups, but not load-bearing on closing E13.

- **Route-handler integration tests.** Tests that exercise an API route end-to-end with a mocked Supabase + AI but a real Next.js handler. High value once the seed suite is established; out of scope for the foundation.
- **Component tests (React Testing Library).** Useful for the few components with real client-side logic (`use-chat`, `expanded-session-row`, the merge candidate UI when PRD-026 ships). Out of scope here — service tests are the higher-leverage starting point.
- **End-to-end tests (Playwright or equivalent).** Critical paths: auth + capture + chat. High value, high cost (setup, flakiness, CI runtime). Deferred until the suite has a track record of catching regressions and the team has bandwidth.
- **Coverage thresholds.** Coverage targets before there's a baseline produce busy-work tests. Once the seed suite stabilizes and the discipline is real, a soft minimum on service-layer files could land.
- **AI prompt snapshot tests.** Catch unintended prompt changes (a tweak to `theme-assignment-prompt.ts` could silently degrade extraction quality). Useful but specific; deferred.
- **Performance / chain-timing regression tests.** The post-response chain has a 60s ceiling and per-stage timing logs (E2). A test that asserts p95 stays under a threshold would catch regressions earlier than telemetry. Deferred until telemetry shows the ceiling matters.
- **Mutation testing.** Real, but at the very tail of the maturity curve. Out of scope.
