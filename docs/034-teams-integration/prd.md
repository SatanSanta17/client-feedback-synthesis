# PRD-034: Microsoft Teams Support Channel Integration

> **Status:** Placeholder — high-level only, not ready for implementation
> **Depends on:** PRD-002 (Capture), PRD-003 (Signal Extraction), PRD-010 (Team Access)
> **Deliverable:** Pull conversations from selected Microsoft Teams support channels into the platform as a new ingestion source, so support threads flow through the same signal-extraction pipeline as manually captured sessions.

## Purpose

Today the only way feedback enters the platform is via manual capture (typed/pasted notes, file uploads, video). A meaningful chunk of customer signal already lives in Microsoft Teams support channels — bug reports, feature requests, complaints, escalations — and it never makes it into Synthesiser unless someone manually copies it across. This PRD makes those channels a first-class ingestion source.

## User Story

As a workspace admin, I want to connect one or more Microsoft Teams support channels to my workspace so that conversations from those channels are automatically pulled in, mapped to clients, and processed through the existing signal-extraction pipeline — without anyone having to copy-paste threads manually.

---

## Part 1: Connection & Auth

**Scope:** Let a workspace admin connect their Microsoft tenant and authorise the platform to read selected Teams channels.

### Requirements

**P1.R1** — Admin can initiate a Microsoft connection from workspace settings via OAuth.
**P1.R2** — Connection stores tenant + token metadata at the workspace level (one connection per workspace, for now).
**P1.R3** — Admin can disconnect, which revokes tokens and stops further sync.

### Acceptance

- [ ] Admin can connect a Microsoft tenant
- [ ] Admin can disconnect at any time
- [ ] Non-admins cannot connect/disconnect

---

## Part 2: Channel Selection & Mapping

**Scope:** Admin picks which channels to ingest and how messages map to clients/sessions.

### Requirements

**P2.R1** — After connection, admin sees a list of Teams + channels they have access to and selects which ones to ingest.
**P2.R2** — Each ingested channel maps to a client (one channel → one client, initially).
**P2.R3** — Admin can pause/resume ingestion per channel.

### Acceptance

- [ ] Admin can select channels and assign each to a client
- [ ] Admin can pause/resume per channel
- [ ] Unmapped channels are not ingested

---

## Part 3: Sync & Ingestion

**Scope:** Pull messages from connected channels and convert them into sessions that the existing pipeline can process.

### Requirements

**P3.R1** — Messages from connected channels are pulled on a schedule (initial cadence TBD — likely polling, webhooks later).
**P3.R2** — A configurable grouping rule (e.g. per-thread, per-day) decides what becomes a single session.
**P3.R3** — Each ingested session is tagged with its source (`teams`) and original channel/thread reference.
**P3.R4** — Ingested sessions flow through the existing signal-extraction pipeline unchanged.

### Acceptance

- [ ] Messages from a connected channel land as sessions in the right client
- [ ] Sessions are visible as `source: teams` in the UI
- [ ] Re-running sync does not duplicate sessions

---

## Part 4: Visibility & Controls

**Scope:** Make it obvious in the UI which sessions came from Teams and let users manage them.

### Requirements

**P4.R1** — Session list shows a source badge (manual / upload / video / teams).
**P4.R2** — Teams-sourced sessions link back to the original Teams thread where possible.
**P4.R3** — Admin can see sync status (last sync time, last error) per channel.

### Acceptance

- [ ] Source is visible in session list and detail
- [ ] Last-sync status visible per connected channel
- [ ] Errors surface to the admin, not silently swallowed

---

## Backlog (out of scope for v1)

- Multi-tenant per workspace (more than one Microsoft connection)
- Many-to-one channel → client mapping or auto-mapping by sender
- Webhook-based real-time sync (replace polling)
- Slack / Discord / Zendesk / Intercom as additional sources via the same ingestion abstraction
- Two-way sync (post extracted insights back into the channel)
- Per-message redaction / PII scrubbing controls
- Backfill controls (how far back to ingest on first connect)
