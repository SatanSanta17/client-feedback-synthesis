---
title: Synthesiser — Internal Pitch
audience: Internal (leadership / team)
format: Markdown slide deck (one slide per `---`)
notes: Paste into Google Slides, Gamma, or render with Marp.
---

# Synthesiser
### Turn customer conversations into a live answer to *"what are clients telling us?"*

Internal pitch · 2026

Speaker notes: We do dozens of discovery calls. The notes are everywhere. The cross-client signal is nowhere. Synthesiser fixes that.

---

## The problem

PMs and founders run dozens of discovery calls. **Capture isn't broken — synthesis is.**

- Notes live in Notion, Granola, personal docs
- The painful question is cross-client: *"How many clients raised attribution? Which segment? Is it on the roadmap?"*
- Today: a human re-reads everything. Done quarterly at best.
- Roadmap calls are made on **anecdote**, not evidence.

---

## Why now

- **LLMs made structured extraction a commodity** — what used to need a researcher now runs in seconds.
- **pgvector + RAG made cross-document search cheap to ship** — semantic + keyword retrieval over a private corpus is no longer infra-heavy.
- **Discovery volume is up** — early-stage PMs run 20–40 calls/month.
- **Roadmap pressure is up** — leadership wants evidence, not vibes.

The technical primitives just got cheap. The expectations just got higher. The gap between them is the opportunity.

---

## The market

Three adjacent categories, none of them hit the bullseye:

| Category | Examples | What they optimise for | Why it leaves a gap |
|---|---|---|---|
| Sales conversation intelligence | Gong, Chorus, Avoma | Deal coaching, rep performance | Heavy, expensive, recording-dependent |
| User research repositories | Dovetail, Notably, Condens | Tagging, affinity mapping | Assume a dedicated researcher |
| Feedback aggregation | Productboard, Cycle, Enterpret | Tickets, reviews, NPS | High-volume, low-context — not discovery |
| AI note-takers | Granola, Fathom, Otter | Single-meeting capture | Stop at the meeting boundary |

**Unmet job:** light-touch capture + serious synthesis, owned by the PM/founder.

---

## What Synthesiser is

A **synthesis-first** product for teams running customer discovery.

Three layers:
1. **Frictionless capture** — paste raw notes, AI structures them, human reviews, save.
2. **Live synthesis** — cross-client themes, signal strength, staleness detection, roadmap gap analysis.
3. **Agentic chat over the corpus** *(shipping)* — ask natural-language questions across every session, scoped to your workspace.

No recording infra. No Zoom bot. No tagging tax.

---

## How it works

```
Raw notes  ─►  AI structures  ─►  Human reviews  ─►  Saved to DB
                                                          │
                                                          ▼
                            Signal extraction (per session)
                                                          │
                                                          ▼
                       Master synthesis (cross-client, live)
                                                          │
                                                          ▼
                  Dashboard  +  Agentic chat over the corpus
```

- **Auth & workspaces:** Google + email/password, personal or team scoping
- **AI layer:** Vercel AI SDK — provider/model swappable via env
- **Retrieval:** pgvector + full-text search, RRF-fused (PRD-033)

---

## Competitive positioning

What we do that others don't:

- **Synthesis is the headline, not a side feature.** The dashboard answers cross-client questions out of the box.
- **No capture infra required.** Works with whatever note-taker the user already uses.
- **Built for the PM/founder, not the researcher.** No tagging discipline required for value.
- **Roadmap coverage is built in.** Not just "here's a theme" — "here's the gap between client demand and your roadmap."
- **Chat-native interface coming.** Most competitors bolt chat onto a feed. We're treating it as the primary lens.

---

## The moat

Defensibility is in being **synthesis-native**, not retrofitting synthesis onto something else.

- **Data shape advantage** — schema designed for cross-client questions from day one (signals, master signals, themes, clients, sessions all first-class).
- **Workflow lock-in** — once a team's discovery flows through Synthesiser, the synthesis quality compounds with every session.
- **Provider-agnostic AI** — not tied to one model vendor; we ride the model curve, we don't get squeezed by it.
- **Interop, not replacement** — sit *above* Granola/Fathom/Otter. Capture is commoditising; synthesis is where durable value sits.

**The risk:** Productboard, Cycle, or a note-taker extends upward into synthesis. The answer is to be there first and be better at the cross-client question.

---

## Where we're going

Shipped:
- Foundation, capture flow, signal extraction, master signal synthesis
- Team workspaces, role-based access, invitations
- AI provider abstraction, email/password auth

In flight:
- **Agentic chat (PRD-033)** — RAG over the corpus, hybrid retrieval, workspace-scoped
- **File upload (PRD-013)** — chat exports, transcripts, PDFs, surveys feed the same pipeline
- **Code quality hardening (PRD-012)** — SOLID/DRY pass

Next 2 quarters:
- Roadmap-coverage gap analysis as a first-class surface
- Slack integration — proactive alerts when a theme crosses a threshold
- Feature-advisor agent integration — replace flat-file reads with live DB queries

---

## The ask

To go from internal tool to defensible product, we need:

- **Endorsement** — surface this to teams running discovery inside InMobi as the default tool.
- **Design partners** — 3–5 teams committed to using it for a quarter and giving feedback.
- **Headcount/time** — dedicated cycles for the agentic chat surface and the roadmap-gap module.
- **GTM signal** — early decision on whether this stays internal, ships as a product, or becomes infrastructure for the feature-advisor agent.

The technical foundation is in place. The question is how big we want to play.
