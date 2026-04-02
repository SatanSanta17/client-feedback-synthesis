# Synthesiser

Every team that talks to clients generates a goldmine of insight — and then buries it in personal docs, scattered Notion pages, and email threads nobody reads twice.

Synthesiser fixes that. Paste your raw session notes, let AI extract the signals, and watch a living cross-client analysis build itself over time. No formatting gymnastics. No manual theme-tracking spreadsheets. No "can someone summarise the last 20 calls?" Slack messages.

The result: your team always knows what clients are asking for, what's blocking them, and where your product gaps are — without anyone spending hours writing a synthesis doc that's outdated by next week.

## What it does

**Capture** — Paste raw session notes. Claude extracts structured signals: pain points, must-haves, competitive mentions, blockers, urgency, sentiment, and more. Review, tweak if needed, save. Done in under a minute.

**Synthesise** — Every captured session feeds into a master signal document. AI merges signals across all clients, surfaces cross-client patterns, and generates strategic takeaways. Incrementally updates as new sessions come in — no need to rebuild from scratch.

**Download & Share** — Export the master signal as a clean PDF. Hand it to product, leadership, or anyone who needs the big picture without reading 50 session transcripts.

## Why it matters

- **Hours → seconds.** Manual synthesis across 20+ client sessions takes a full day. This does it in one API call.
- **Nothing falls through the cracks.** Every signal is categorised and attributed. If three clients mentioned the same blocker, you'll know.
- **Always current.** The master signal updates incrementally. No stale quarterly reports.
- **Prompts are yours.** Admins can edit the AI prompts directly in the app. Tune the extraction and synthesis to match your team's language and priorities.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Database | Supabase (PostgreSQL + Row-Level Security) |
| Auth | Google OAuth via Supabase Auth |
| AI | Claude API (server-side) |
| Styling | Tailwind CSS + shadcn/ui |
| PDF | pdf-lib (client-side generation) |
| Hosting | Vercel |

## Getting started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Fill in your Supabase, Anthropic, and Google OAuth credentials

# Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `ANTHROPIC_API_KEY` | Claude API key (server only) |
| `CLAUDE_MODEL` | Claude model identifier (e.g. `claude-sonnet-4-20250514`) |
| `NEXT_PUBLIC_APP_URL` | Application base URL |

See `.env.example` for the full template.

## Project structure

```
app/
├── capture/        # Session capture form + past sessions table
├── m-signals/      # Master signal view + PDF export
├── settings/       # Admin prompt editor with version history
├── login/          # Google OAuth sign-in
└── api/            # Server-side routes (AI, sessions, clients, prompts)

lib/
├── services/       # Business logic (AI, sessions, clients, prompts, profiles)
├── prompts/        # AI prompt templates (fallback defaults)
├── hooks/          # Custom React hooks
└── supabase/       # Supabase client factories

components/
├── layout/         # App header, tab nav, user menu
├── providers/      # Auth context
└── ui/             # shadcn/ui primitives
```

## Documentation

- `ARCHITECTURE.md` — Current system state, data model, API routes, auth flow
- `CHANGELOG.md` — Every change, grouped by feature
- `docs/` — PRDs and TRDs for each feature section

## License

Private.
