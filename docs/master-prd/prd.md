# Master PRD: Client Feedback Capture and Synthesis Dashboard

> This is the master product requirements document. It defines the full product scope across numbered sections. Each section is implemented via its own dedicated PRD and TRD in `docs/<number>-<name>/`. This document is the big picture — individual PRDs contain the detailed requirements, parts, and acceptance criteria.

## Purpose

Teams run structured discovery sessions with prospective and existing clients. Notes from these sessions are the primary raw material for understanding client needs, identifying product gaps, and prioritising the roadmap.

Today this process is entirely manual and fragmented: session notes live in personal documents, Notion pages, and email threads. Synthesising themes across clients requires someone to manually read all notes and write a summary — a task that takes hours and is done infrequently. There is no cross-client signal index, no way to answer "how many clients raised attribution?", and no visible mapping between client concerns and roadmap coverage.

This product gives the team two things:
1. A structured way to capture session notes without friction (paste raw notes, Claude structures them, human reviews, save)
2. A live synthesis dashboard that surfaces cross-client themes, signal strength, client profiles, and roadmap gap analysis

The byproduct: the feature-advisor agent eventually gets a database query tool to replace flat-file reading of `synthesis.md`, making AI-assisted roadmap planning more reliable and scalable.

## User Story

As a team member, I want to paste raw session notes into a tool that structures them automatically and saves them to a shared database, so that I don't have to manually format notes and the team can see cross-client themes and roadmap gaps in real time.

---

## Document Hierarchy

```
Master PRD (this file)
  └── Sections (high-level scope, defined here)
        └── Individual PRDs (docs/<number>-<name>/prd.md)
              └── Parts (detailed requirements within each PRD)
                    └── TRD (docs/<number>-<name>/trd.md) — mirrors PRD parts
                          └── Increments (implementation chunks within each TRD part)
                                └── PRs (one or more per increment)
```

---

## Section 1: Foundation ✅

**PRD:** `docs/001-foundation/prd.md` — Implemented (2026-03-25)

**Scope:** Project scaffold, app shell with tab navigation, Google OAuth authentication with domain restriction, database schema setup.

**Deliverable:** User can sign in with Google and see the app shell with tab navigation.

---

## Section 2: Capture Tab ✅

**PRD:** `docs/002-capture-tab/prd.md` — Implemented (2026-03-25)

**Scope:** Database schema for sessions/themes/clients, session form with all fields, "Structure with AI" integration via Claude, structured output preview with editable fields, save/update/soft-delete, past sessions sidebar with search and click-to-edit.

**Deliverable:** User can paste notes, structure them with Claude, save, and edit past sessions. Database tables exist to support the capture flow.

---

## Section 3: Synthesis Dashboard (Partial) ✅

**PRD:** `docs/003-signal-extraction/prd.md` (Signal Extraction) — Implemented (2026-03-26)
**PRD:** `docs/004-master-signals/prd.md` (Master Signal View) — Implemented (2026-03-26)

**Scope:** Signal extraction via Claude, master signal synthesis, summary header bar, signal index table, client profile cards, theme drill-downs with inline editing, roadmap gaps panel.

**Delivered so far:** Signal extraction from raw session notes via Claude. Master signal page with AI-synthesised cross-client analysis, staleness detection, cold start/incremental generation, and PDF download. Master signal cleanup on session deletion (PRD-006): tainted flag, auto cold-start regeneration, deletion-aware staleness banner, and settings prompt selection. Remaining dashboard features (signal index table, client profile cards, theme drill-downs, roadmap gaps) are not yet implemented.

---

## Section 4: Hardening and Edge Cases

**PRD:** Not yet written

**Scope:** Error states, optimistic locking, form preservation on auth expiry, large-note handling, responsive tweaks, empty states.

**Deliverable:** Production-ready error handling and edge case coverage.

---

## Section 5: Deploy and Production Readiness

**PRD:** Not yet written

**Scope:** Vercel production deployment, Supabase production project, domain setup, security review, final QA.

**Deliverable:** Live, production-ready application.

---

## Open Access (Amendment to Section 1) ✅

**PRD:** `docs/008-open-access/prd.md` — Implemented (2026-04-02)

**Scope:** Remove email domain restriction, isolate all data per user (sessions, master signals, clients, prompts), remove admin role system.

**Deliverable:** Any Google account can sign in. Each user operates in complete isolation with full prompt control.

---

## AI Provider Abstraction (Amendment to Section 3)

**PRD:** `docs/009-ai-provider-abstraction/prd.md` — Draft

**Scope:** Replace direct Anthropic SDK integration with the Vercel AI SDK. Support switching AI provider and model via environment variables.

**Deliverable:** Developers can switch between Anthropic, OpenAI, Google, and other providers without code changes.

---

## Out of Scope

- Real-time collaboration / multiplayer editing (planned for future)
- Automatic theme extraction at save time (themes are manually tagged)
- Roadmap integration (no Jira tickets or spec file creation)
- Client-facing session summaries
- Attachment or file upload (notes are text-only)
- Audit log UI
- Email/Slack notifications
- Mobile-first design
- Self-service theme management (merge, split, archive)
- Feature-advisor DB query tool (future integration, separate task)

---

## Backlog

- AI-assisted theme linking: automatically suggest theme tags when saving a session based on existing themes in the database
- Slack integration: notify a channel when a new session is captured or a theme crosses a signal strength threshold
- Export to CSV/PDF: export the synthesis dashboard or client profiles for stakeholder presentations
- Feature-advisor integration: wire the feature-advisor agent to query the sessions database directly instead of reading flat files
- Theme lifecycle management: merge duplicate themes, archive stale themes, split overloaded themes
- Session attachments: upload PDFs or audio recordings alongside text notes
