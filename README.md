# Synthesiser

Every team that talks to clients generates a goldmine of insight — and then buries it in personal docs, scattered Notion pages, and email threads nobody reads twice.

Synthesiser fixes that. Paste your raw session notes, let AI extract the signals, and watch a living cross-client analysis build itself over time. No formatting gymnastics. No manual theme-tracking spreadsheets. No "can someone summarise the last 20 calls?" Slack messages.

The result: your team always knows what clients are asking for, what's blocking them, and where your product gaps are — without anyone spending hours writing a synthesis doc that's outdated by next week.

## What it does

**Capture** — Paste raw session notes or upload files (TXT, PDF, CSV, DOCX, JSON). AI extracts structured signals: pain points, must-haves, competitive mentions, blockers, urgency, sentiment, and more. WhatsApp and Slack chat exports are auto-detected and restructured. Review, tweak if needed, save. Done in under a minute.

**Dashboard** — A live insights view at `/dashboard` with eight widgets: sentiment distribution (donut), urgency distribution (bar), session volume over time (area, week/month toggle), client health (scatter, sentiment × urgency), competitive mentions (bar), top themes (bar with chunk-type breakdown), theme trends (multi-line, granularity toggle), and theme-client matrix (intensity heatmap). AI-generated **headline insights** (trend / anomaly / milestone cards) sit above the grid and refresh on demand. Click any data point to drill down into the underlying signals grouped by client; shift+click to cross-filter every widget. Global filter bar (clients, date range, severity, urgency) is URL-encoded and shareable. One-click PNG export captures the filtered view with a context header.

**Chat (RAG)** — A full chat experience at `/chat` grounded in every session your team has captured. Conversation sidebar with search, pin, archive, rename, and delete. Virtualized message thread, streaming responses with markdown, inline citation chips that open the source signal, follow-up suggestions, in-conversation search with match navigation, starter questions for new conversations, and read-only archive mode.

**Themes** — Signals are automatically classified into workspace-scoped themes at extraction time. Embedding-based de-duplication collapses synonym proposals onto existing themes (HNSW-indexed `vector(1536)` per theme, configurable similarity threshold). For the long tail, admins get a `/settings/themes` page that surfaces ranked merge candidates with confidence pills, blast-radius preview, dismiss action, and an atomic merge transaction that re-points every signal assignment and writes an audit log entry. Affected users are notified.

**Notifications** — A real-time workspace bell aggregates events across every team you belong to: theme merges, supersession proposals, bulk re-extraction completions. Realtime delivery within 1–2 seconds (Supabase Realtime + RLS), with a 5-minute polling fallback. Per-user fan-out with actor suppression — you don't get notified about your own actions.

**Collaborate** — Create teams, invite members via email, manage roles (owner, admin, sales). Team workspaces share sessions, signals, themes, and prompts across members with role-based access control. Workspace switcher toggles between personal and team contexts.

**Landing** — Public marketing page at `/` with hero, framed product showcase, bento features grid, "Built for" personas, how-it-works flow, and a working contact form (rate-limited, honeypot-protected, persists to DB and emails the operator). Authenticated visitors auto-redirect to `/dashboard` (or `/capture` for new accounts).

## Why it matters

- **Hours → seconds.** Manual synthesis across 20+ client sessions takes a full day. This does it instantly.
- **Nothing falls through the cracks.** Every signal is categorised, themed, and attributed. If three clients mentioned the same blocker, you'll know.
- **Always current.** The dashboard updates automatically as new sessions come in. No stale quarterly reports.
- **Ask anything.** RAG chat answers plain-English questions across every session, with citations back to the source.
- **Prompts are yours.** Admins edit the AI extraction prompt directly in the app, with version history and revert.
- **File uploads.** Attach raw transcripts, chat exports, or meeting notes — drag-and-drop, concurrent uploads, 50k character combined limit.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict mode), React 19 |
| Database | Supabase (PostgreSQL + Row-Level Security + Realtime) |
| Vector search | pgvector with HNSW indexes (session embeddings + theme embeddings) |
| Storage | Supabase Storage (`SYNTHESISER_FILE_UPLOAD` bucket) |
| Auth | Google OAuth + email/password via Supabase Auth |
| AI | Vercel AI SDK — Anthropic, OpenAI, Google (server-side only) |
| Embeddings | OpenAI `text-embedding-3-small` via Vercel AI SDK |
| Charts | Recharts |
| Markdown | react-markdown + remark-gfm |
| Virtualization | react-virtuoso (chat thread) |
| Theming | next-themes (dark mode) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| PDF | pdf-lib (client-side generation) |
| File parsing | pdf-parse, mammoth, papaparse (server-side) |
| Image export | html-to-image (dashboard PNG export) |
| Email | Resend or Brevo (provider-agnostic via `EMAIL_PROVIDER`) |
| Hosting | Vercel |

## Getting started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Fill in your Supabase, AI provider, embedding provider, and email credentials

# Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase publishable (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `AI_PROVIDER` | AI provider: `anthropic`, `openai`, or `google` |
| `AI_MODEL` | Provider-specific model ID (e.g. `claude-sonnet-4-20250514`, `gpt-4o`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (when `AI_PROVIDER=anthropic`) |
| `OPENAI_API_KEY` | OpenAI API key (when `AI_PROVIDER=openai`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key (when `AI_PROVIDER=google`) |
| `EMBEDDING_PROVIDER` | Embedding provider (`openai`) |
| `EMBEDDING_MODEL` | Embedding model ID (e.g. `text-embedding-3-small`) |
| `EMBEDDING_DIMENSIONS` | Embedding vector size — must match the `vector(N)` column (1536 for `text-embedding-3-small`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `EMAIL_PROVIDER` | Email provider: `resend` or `brevo` |
| `RESEND_API_KEY` | Resend API key (when `EMAIL_PROVIDER=resend`) |
| `BREVO_API_KEY` | Brevo API key (when `EMAIL_PROVIDER=brevo`) |
| `EMAIL_FROM` | Sender address, e.g. `Synthesiser <noreply@synthesiser.app>` |
| `CONTACT_OPERATOR_EMAIL` | Recipient for landing-page contact-form notifications |
| `NEXT_PUBLIC_APP_URL` | Application base URL |
| `NEXT_PUBLIC_CALENDLY_URL` | Optional — when set, the contact section renders a "Book time directly" link |

See `.env.example` for the full template.

## Project structure

```
app/
├── page.tsx              # Public landing page (auth-aware redirect)
├── _components/          # Landing-page sections (hero, showcase, bento, personas, contact, footer)
├── capture/              # Session capture form + past sessions table
├── dashboard/            # Insights dashboard (8 widgets + headline insights + drill-down)
├── chat/                 # RAG chat interface
├── settings/
│   ├── prompts/          # Prompt editor with version history
│   ├── team/             # Team management (members, roles, invitations)
│   └── themes/           # Admin theme merge candidates + audit log
├── login/                # Email/password + Google OAuth sign-in
├── signup/               # New account registration
├── forgot-password/      # Password reset request
├── reset-password/       # Password reset confirmation
├── invite/               # Team invitation acceptance
├── auth/                 # OAuth callback handler
└── api/
    ├── ai/               # Signal extraction + master-signal generation
    ├── chat/             # Conversations, messages, streaming send
    ├── clients/          # Client CRUD
    ├── contact/          # Public contact form (rate-limited, honeypot)
    ├── dashboard/        # Dashboard query router + headline insights
    ├── files/            # Stateless file parse endpoint
    ├── invite/           # Invitation acceptance
    ├── master-signal/    # Master signal fetch (legacy backend, retired UI)
    ├── notifications/    # Bell listing, unread count, mark-read
    ├── prompts/          # Prompt CRUD with version history
    ├── sessions/         # Session CRUD + attachment upload/download/delete
    ├── teams/            # Team CRUD + member management + invitations
    └── themes/           # Merge candidates, dismiss, merge, audit list

lib/
├── api/                  # Shared route helpers (auth, validation, file uploads)
├── constants/            # Shared constants (file limits, icons)
├── cookies/              # Active-team cookie helpers
├── email-templates/      # HTML email templates
├── hooks/                # Custom React hooks
├── notifications/        # Event-type registry, renderers, repository
├── prompts/              # Default AI prompt templates
├── repositories/         # Data-access layer (themes, candidates, merges, notifications)
├── schemas/              # Shared Zod schemas
├── services/             # Business logic (AI, sessions, embeddings, themes, chat, etc.)
├── streaming/            # SSE streaming helpers for chat
├── supabase/             # Supabase client factories (browser, server, service role)
├── types/                # Database types generated from Supabase
└── utils/                # Shared utilities

components/
├── auth/                 # Auth form shell, email confirmation panel, password input
├── capture/              # Capture-form shared pieces
├── dashboard/            # Dashboard primitives shared across widgets
├── layout/               # App header, sidebar, user menu, workspace switcher
├── notifications/        # Notification bell + dropdown
├── providers/            # Auth context, theme provider
├── settings/             # Settings shell, accordion
└── ui/                   # shadcn/ui primitives

types/                    # Custom TypeScript declarations
docs/                     # PRDs and TRDs for each feature section
scripts/                  # One-shot scripts (e.g. theme-embedding backfill)
```

## Documentation

- `ARCHITECTURE.md` — Current system state, data model, API routes, auth flow
- `CHANGELOG.md` — Every change, grouped by feature
- `CLAUDE.md` — Development rules and conventions
- `docs/` — PRDs and TRDs for each feature section

## License

Private.
