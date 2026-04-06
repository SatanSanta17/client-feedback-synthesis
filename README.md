# Synthesiser

Every team that talks to clients generates a goldmine of insight — and then buries it in personal docs, scattered Notion pages, and email threads nobody reads twice.

Synthesiser fixes that. Paste your raw session notes, let AI extract the signals, and watch a living cross-client analysis build itself over time. No formatting gymnastics. No manual theme-tracking spreadsheets. No "can someone summarise the last 20 calls?" Slack messages.

The result: your team always knows what clients are asking for, what's blocking them, and where your product gaps are — without anyone spending hours writing a synthesis doc that's outdated by next week.

## What it does

**Capture** — Paste raw session notes or upload files (TXT, PDF, CSV, DOCX, JSON). AI extracts structured signals: pain points, must-haves, competitive mentions, blockers, urgency, sentiment, and more. WhatsApp and Slack chat exports are auto-detected and restructured. Review, tweak if needed, save. Done in under a minute.

**Synthesise** — Every captured session feeds into a master signal document. AI merges signals across all clients, surfaces cross-client patterns, and generates strategic takeaways. Incrementally updates as new sessions come in — no need to rebuild from scratch.

**Download & Share** — Export the master signal as a clean PDF. Hand it to product, leadership, or anyone who needs the big picture without reading 50 session transcripts.

**Collaborate** — Create teams, invite members via email, and manage roles (owner, admin, sales). Team workspaces share sessions, signals, and the master document across all members with role-based access control.

## Why it matters

- **Hours → seconds.** Manual synthesis across 20+ client sessions takes a full day. This does it in one API call.
- **Nothing falls through the cracks.** Every signal is categorised and attributed. If three clients mentioned the same blocker, you'll know.
- **Always current.** The master signal updates incrementally. No stale quarterly reports.
- **Prompts are yours.** Admins can edit the AI prompts directly in the app. Tune the extraction and synthesis to match your team's language and priorities.
- **File uploads.** Attach raw transcripts, chat exports, or meeting notes directly — supports drag-and-drop, concurrent uploads, and a combined 50k character limit across notes and attachments.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript, strict mode) |
| Database | Supabase (PostgreSQL + Row-Level Security) |
| Storage | Supabase Storage (`SYNTHESISER_FILE_UPLOAD` bucket) |
| Auth | Google OAuth + email/password via Supabase Auth |
| AI | Vercel AI SDK — supports Anthropic, OpenAI, Google (server-side only) |
| Styling | Tailwind CSS + shadcn/ui |
| PDF | pdf-lib (client-side generation) |
| File parsing | pdf-parse, mammoth, papaparse (server-side) |
| Email | Brevo or Resend (provider-agnostic via `EMAIL_PROVIDER` env var) |
| Hosting | Vercel |

## Getting started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Fill in your Supabase, AI provider, and Google OAuth credentials

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
| `AI_PROVIDER` | AI provider: `anthropic`, `openai`, or `google` |
| `AI_MODEL` | Provider-specific model ID (e.g. `claude-sonnet-4-20250514`, `gpt-4o`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (when `AI_PROVIDER=anthropic`) |
| `OPENAI_API_KEY` | OpenAI API key (when `AI_PROVIDER=openai`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key (when `AI_PROVIDER=google`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `EMAIL_PROVIDER` | Email provider: `brevo` or `resend` |
| `BREVO_API_KEY` | Brevo API key (when `EMAIL_PROVIDER=brevo`) |
| `RESEND_API_KEY` | Resend API key (when `EMAIL_PROVIDER=resend`) |
| `EMAIL_FROM` | Sender address, e.g. `Synthesiser <noreply@synthesiser.app>` |
| `NEXT_PUBLIC_APP_URL` | Application base URL |

See `.env.example` for the full template.

## Project structure

```
app/
├── capture/           # Session capture form + past sessions table
├── m-signals/         # Master signal view + PDF export
├── settings/          # Prompt editor with version history
├── login/             # Email/password + Google OAuth sign-in
├── signup/            # New account registration
├── forgot-password/   # Password reset flow
├── reset-password/    # Password reset confirmation
├── invite/            # Team invitation acceptance
├── auth/              # OAuth callback handler
└── api/
    ├── ai/            # Signal extraction endpoint
    ├── clients/       # Client CRUD
    ├── files/         # Stateless file parse endpoint
    ├── invite/        # Invitation management
    ├── master-signal/ # Master signal generation + history
    ├── prompts/       # Prompt CRUD with version history
    ├── sessions/      # Session CRUD + attachment upload/download/delete
    └── teams/         # Team CRUD + member management

lib/
├── constants/         # Shared constants (file limits, icons)
├── email-templates/   # HTML email templates (invitations)
├── hooks/             # Custom React hooks
├── prompts/           # AI prompt templates (fallback defaults)
├── schemas/           # Shared Zod schemas
├── services/          # Business logic (AI, sessions, clients, attachments, teams, email, etc.)
├── supabase/          # Supabase client factories (browser + server + service role)
└── utils/             # Shared utilities (compose AI input, file size formatting, etc.)

components/
├── layout/            # App header, tab nav, user menu, workspace switcher
├── providers/         # Auth context provider
└── ui/                # shadcn/ui primitives

types/                 # Custom TypeScript declarations
docs/                  # PRDs and TRDs for each feature section
```

## Documentation

- `ARCHITECTURE.md` — Current system state, data model, API routes, auth flow
- `CHANGELOG.md` — Every change, grouped by feature
- `CLAUDE.md` — Development rules and conventions
- `docs/` — PRDs and TRDs for each feature section

## License

Private.
