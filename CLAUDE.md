# Synthesiser — Development Rules

## First Steps Every Session

1. Read `ARCHITECTURE.md` before making any changes — it contains the full system design, file map, data flow, and conventions.
2. If modifying any file, read it first — don't assume from memory.
3. If modifying a page or component, read its co-located components and relevant section files first.
4. Always ask for plan confirmation before coding.
5. Never make a document without being asked for explicitly.

## Development Process

Every change follows this sequence. No step is skipped.

1. Understand the purpose — why does this matter to the user?
2. Write the PRD in `docs/<number>-<feature-name>/prd.md`
3. Get explicit approval on the PRD
4. Write the TRD in `docs/<number>-<feature-name>/trd.md` — **never before PRD approval**
5. Implement one part at a time in small, pushable increments
6. Verify before every push (see Quality Gates below)
7. Update `ARCHITECTURE.md` and `CHANGELOG.md` after each part completes

**Trivial fixes** (typos, CSS tweaks, one-line bugs) may skip the PRD/TRD but still require explicit approval before any code is changed. Never change code silently.

### Document Structure

- **Master PRD** (`docs/master-prd/prd.md`) defines full product scope across numbered sections.
- **Section PRDs** live in `docs/<number>-<name>/prd.md` with co-located `trd.md`.
- **PRD contains:** purpose, user story, requirements per part (P1.R1, P1.R2…), acceptance criteria (checkboxes per part), and a backlog section. No technical details — those go in the TRD.
- **TRD mirrors PRD parts** — same part numbers, same boundaries. Each part includes: database models, API endpoints, frontend pages/components, files changed, and implementation increments. The TRD answers "how" for everything the PRD says "what."
- **Write TRD parts one at a time, but reference the entire PRD.** Each TRD part must account for forward compatibility — data structures and interfaces should carry the shape that later parts will need, even if unused until then.
- **Parts break into increments.** An increment is a self-contained, verifiable unit of work. A PR is the smallest pushable unit of code.

### Quality Gates

**Before every push:**

1. Code quality — read every modified file for syntax errors, unused imports, broken references
2. PRD compliance — confirm implementation covers each requirement
3. No regressions — trace existing flows through modified files
4. Documentation consistency — `ARCHITECTURE.md` and READMEs match the code

**End-of-part audit** (last increment of every TRD part):

1. SRP violations — each file, component, and function does one thing
2. DRY violations — shared patterns extracted, no duplication
3. Design token adherence — no hardcoded colours, sizes, or spacing; use CSS custom properties or Tailwind tokens
4. Logging — all API routes and services log entry, exit, and errors
5. Dead code — no unused imports, variables, or files remain
6. Convention compliance — naming, exports, import order, TypeScript strictness

This increment produces fixes, not a report.

**After each TRD part completes:**

1. Update `ARCHITECTURE.md` if file structure, routes, services, tables, or env vars changed
2. Update `CHANGELOG.md` with what the part delivered
3. Verify all file references in documentation still exist
4. Test the flows affected by the part
5. If modifying the database schema, regenerate Supabase types

**End-of-PRD audit** (after the final part of every PRD completes):

1. Run the full end-of-part audit checklist (above) across all files touched by the PRD
2. Verify `ARCHITECTURE.md` file map is complete and accurate — every file, directory, route, and doc folder that exists in the codebase must be reflected
3. Verify `CHANGELOG.md` has entries for every completed part
4. Run `npx tsc --noEmit` for a final type check
5. This audit produces fixes and documentation updates, not a report

`ARCHITECTURE.md` reflects what exists in the codebase — never pre-fill with planned-but-unbuilt structures.

### Architecture

- **Respect existing architecture decisions.** `ARCHITECTURE.md` documents platform-specific rules, data flow, and constraints. Read and follow them before making changes.

---

## Development Practices — SOLID & Clean Code

These principles apply to every change across both frontend and API routes.

- **Single Responsibility (S).** Each file, component, and function does one thing. If a component handles both UI rendering and data fetching, split them. If an API route does validation and persistence, separate the concerns.
- **Open/Closed (O).** Extend behavior without modifying existing code. Use props, composition, and factory patterns instead of editing working code to add new behavior.
- **Liskov Substitution (L).** All implementations of an interface must be interchangeable. Every shared component works with its default props alone.
- **Interface Segregation (I).** Don't force consumers to depend on things they don't use. Keep component prop interfaces minimal. Keep utility functions focused — don't add optional parameters that only one caller needs.
- **Dependency Inversion (D).** High-level modules should not depend on low-level details. Components consume props, not global state. API routes call service functions, not raw database queries.

Additional practices:

- **DRY — Extract shared patterns into reusable components.** If the same UI pattern or logic appears in two or more places, extract it into a shared location. Don't duplicate code across files.
- **Delete dead code immediately.** Unused files, imports, and components are never left "just in case." If it's not imported anywhere, it's deleted.
- **Naming reflects purpose.** File names, component names, and function names describe what they do — not how they're implemented.
- **Composition over inheritance.** Build complex components by composing simple ones. Use props and children, not deep hierarchies.
- **Fail explicitly.** Errors are caught, logged, and surfaced to the user — never silently swallowed unless explicitly documented in the architecture.
- **Log everything that matters.** Every API route and service function should log: entry with input context, exit with outcome, and errors with full stack traces. No silent failures — if you catch an exception, you log it before handling it.

---

## Frontend — Next.js Conventions

These rules apply to every file under `app/`, `components/`, and `lib/`.

### Component Architecture

- **Page routes are thin.** Page files set up the shell (layout, metadata) and compose from smaller components. No business logic in page files.
- **Co-locate private components with their route.** Route-specific components live in a `_components/` directory next to their page file and are never imported outside that route.
- **Shared components are extracted once reused.** If a component is used across two or more routes, extract it into `components/`. Single-route components stay co-located.
- **UI primitives are untouchable.** shadcn/ui components are never modified with business logic. Extend via composition, not modification.
- **Default to Server Components.** Every component is a React Server Component unless it needs client-side interactivity (`useState`, `useEffect`, event handlers, browser APIs). Only add `'use client'` when the component genuinely requires it. Never mark a parent as `'use client'` just because one child needs it — push the client boundary as deep as possible.
- **Metadata is co-located with routes.** Every page exports a `metadata` object or `generateMetadata` function for SEO. Never hardcode `<title>` or `<meta>` tags in components.
- **Use `next/image` for all images.** Never use raw `<img>` tags.
- **Use `next/link` for all internal navigation.** Never use `<a>` tags for internal routes. Never use `window.location` for client-side navigation — use `useRouter()` from `next/navigation`.
- **Environment variables follow the `NEXT_PUBLIC_` convention.** Client-accessible env vars must be prefixed with `NEXT_PUBLIC_`. Server-only secrets (Supabase service role key, AI provider API keys) must never be prefixed. Never expose API keys or secrets to the client bundle.

### TypeScript Patterns

- **Strict mode is enabled.** No `any` types unless absolutely unavoidable and documented with a comment explaining why.
- **Props use interfaces, not types.** Define `interface ComponentProps { ... }` above the component. Always include `className?: string` for composability.
- **Zod for validation, infer for types.** Forms use `z.object()` schemas with `type FormFields = z.infer<typeof schema>`. Never duplicate types manually when Zod can infer them.
- **Discriminated unions for state machines.** Use `type AIState = 'idle' | 'structuring' | 'success' | 'error'` — never booleans for multi-state flows.
- **Error narrowing.** Always use `err instanceof Error ? err.message : 'Something went wrong'` in catch blocks. Never assume `err` is an Error.
- **Prefer `satisfies` over `as`.** Use `const config = { ... } satisfies Config` for type-safe object literals. Reserve `as` for genuinely narrowing an unknown type, never to silence errors.
- **Database types are generated from Supabase.** Use the Supabase CLI to generate TypeScript types from the database schema. Never manually define types that duplicate the database schema.

### State Management

- **React hooks only.** No Redux, Zustand, or external state libraries. `useState` for component state, `useRef` for mutable values that don't trigger renders, `useCallback` for stable function references.
- **Custom hooks in `lib/hooks/`.** Prefix with `use-` (file) and `use` (function). Return objects, not arrays. Include cleanup in `useEffect` return.
- **Forms use react-hook-form + zod.** Always: `useForm<T>({ resolver: zodResolver(schema), defaultValues: {...} })`. Never manage form state manually.
- **No global state.** Components receive data via props. Context is used only for cross-cutting concerns (auth, theme). Never use context as a general state store.
- **Derive state, don't sync it.** If a value can be computed from existing state or props, compute it inline or with `useMemo`. Never use `useEffect` to sync one state variable to another.

### Styling Rules

- **Tailwind CSS with a clean, professional design.** White background, neutral greys, single brand accent colour (indigo/purple). Polished enough for paying customers, no unnecessary visual complexity.
- **Use a utility function for conditional classes.** Never concatenate class strings manually. Always use `cn()` (clsx + tailwind-merge) that handles Tailwind class conflicts.
- **Desktop-first, mobile-responsive.** The primary experience is desktop. All pages must be fully responsive and usable on mobile, but desktop is the design priority.
- **Consistent spacing and sizing.** Use Tailwind's spacing scale consistently. Don't mix arbitrary pixel values with Tailwind units.
- **Theme and typography are defined globally.** All shared colours, font sizes, font weights, border radii, shadows, and brand tokens (accent colours, status colours, badge colours) must be defined in `globals.css` using CSS custom properties or Tailwind's `@layer` directives — never scattered as inline values across components. Components reference these global tokens via Tailwind classes or `var(--token-name)`. This makes theme-wide changes a single-file edit instead of a project-wide find-and-replace. If a colour, font size, or spacing value appears in more than one component, it belongs in the global stylesheet.

### API Routes (Next.js Route Handlers)

- **All external API calls are server-side only.** AI model calls, Supabase service-role operations, and any secret-dependent logic lives in `app/api/` route handlers. Never call these from the client directly.
- **Route handlers validate input with Zod.** Every POST/PUT handler parses the request body with a Zod schema. Invalid input returns 400 with a descriptive error.
- **Route handlers don't contain business logic.** They validate input, call service functions from `lib/services/`, and format responses. If a route handler has more than one responsibility (validation + business logic + response formatting), extract the business logic to a service.
- **HTTP status codes are explicit.** 400 = bad input, 401 = unauthenticated, 403 = forbidden, 404 = not found, 409 = conflict, 422 = unprocessable (e.g., AI model returned bad output), 500 = server error. Always include a JSON body with a `message` field.
- **Service functions live in `lib/services/`.** Each domain gets a service file (e.g., `session-service.ts`, `theme-service.ts`, `ai-service.ts`). Services handle data access (Supabase queries), business logic, and external API calls (AI models). Services never import from `next/server` — they are framework-agnostic.

---

## Supabase & Database Conventions

- **Supabase client is created once per context.** Use `createServerClient` in server components and API routes (with cookies). Use `createBrowserClient` in client components. Never instantiate clients inline.
- **Two client types: `anon` and `service_role`.** The `anon` client respects RLS and is used for user-facing reads/writes. The `service_role` client bypasses RLS and is used only in server-side admin operations. Never expose the service role key to the client.
- **Row-Level Security (RLS) is always enabled.** Every table has RLS policies. Default deny — explicitly grant access. All rows readable and writable only by authenticated users.
- **Schema changes are documented.** Every migration is recorded in the TRD before execution. The ARCHITECTURE.md data model section is updated after each migration.
- **Timestamps are UTC.** All `created_at`, `updated_at`, `deleted_at` columns use `timestamptz` and store UTC values.
- **Soft deletes for domain entities** (clients, sessions, teams, master signals). Use a `deleted_at` column. Queries filter `WHERE deleted_at IS NULL` unless explicitly recovering deleted records. Hard deletes for transient/operational data (expired tokens, temporary records) that have no audit or recovery value.
- **Use Supabase's generated types.** Run `supabase gen types typescript` after schema changes and commit the output. Never hand-write types that duplicate the schema.

---

## Authentication — Google OAuth via Supabase Auth

- **Supabase Auth handles the OAuth flow.** No custom OAuth implementation. Use `supabase.auth.signInWithOAuth({ provider: 'google' })` on the client and Supabase's built-in session management.
- **Open authentication.** Any Google account can sign in. There is no email domain restriction. The OAuth callback exchanges the code for a session and redirects to `/capture`.
- **Auth state is provided via a React context.** A single `AuthProvider` wraps the app and exposes `user`, `isAuthenticated`, `isLoading`, and `signOut`. Components read auth state from context.
- **Middleware protects all routes.** Next.js middleware checks for a valid Supabase session on every request. Unauthenticated users are redirected to the sign-in page.
- **Session persistence.** Supabase Auth handles session refresh via cookies. The user is not forced to re-authenticate on every visit.
- **Sign-out clears the session.** `supabase.auth.signOut()` clears cookies and redirects to the sign-in page.

---

## AI Integration — Provider-Agnostic via Vercel AI SDK

- **All AI calls are server-side.** Made from Next.js API routes, never from the browser. API keys are environment variables, never exposed to the client.
- **Provider and model are environment variables.** `AI_PROVIDER` (e.g., `anthropic`, `openai`, `google`) and `AI_MODEL` (e.g., `claude-sonnet-4-20250514`, `gpt-4o`, `gemini-2.0-flash`) are set in `.env` and read by the `resolveModel()` function in `ai-service.ts`. Never hardcode provider or model names.
- **Vercel AI SDK is the abstraction layer.** The `ai-service.ts` file uses `generateText()` from the `ai` package. Provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) are thin adapters. Adding a new provider is a single `case` in the `PROVIDER_MAP`.
- **Prompts are version-controlled.** Prompt templates live in `lib/prompts/` as named exports. Each prompt file contains the system message, user message template, and expected response schema. Changing a prompt is a code change that goes through review.
- **Set `maxTokens` on every call.** Never let the model decide how long to respond. Set explicit limits based on expected output size.
- **Handle all failure modes.** Every AI call must handle: timeouts, rate limits (429), malformed responses, empty responses, and service outages. Retry transient failures (429, 5xx, network errors) up to 3 times with exponential backoff. Don't retry 4xx errors (except 429) — that's a prompt or config bug.
- **Degrade gracefully.** If the AI model fails after retries, the user can still save raw notes manually. AI structuring is an enhancement, not a gate.
- **Never expose raw API errors to users.** Wrap failures in user-friendly messages. Log the raw error server-side.
- **Be explicit about what the model should NOT do.** "Do not hallucinate data not present in the notes", "If a field cannot be extracted, return null", "Do not add conversational text in the JSON response."

---

## Error Handling Patterns

1. **API routes** return appropriate HTTP status codes with `{ message: string }` JSON bodies. They catch errors from services and translate them to HTTP responses.
2. **Service functions** throw typed errors or return error objects. They never import HTTP-specific constructs.
3. **Client-side error handling** uses toast notifications for transient errors (save failed, API timeout) and inline error states for persistent issues (form validation, empty states).
4. **Supabase errors** are caught at the service layer. If Supabase is unreachable, read operations show "Could not load data — please refresh." Write operations show a toast.
5. **Auth errors** are handled globally. If any API call returns 401, the auth layer triggers re-authentication. In-progress form data is preserved in `localStorage` and restored after re-auth.

---

## Naming Conventions

| Category | Convention | Example |
|----------|-----------|---------|
| Files | kebab-case | `session-form.tsx`, `ai-service.ts` |
| Directories | kebab-case | `_components/`, `lib/services/` |
| Components | PascalCase | `SessionForm`, `SignalIndex` |
| Props interfaces | PascalCase + Props | `SessionFormProps`, `ClientCardProps` |
| Event handlers | handle + Action | `handleSubmit`, `handleStructure` |
| Custom hooks | use + Name | `useAuth`, `useSessions` |
| Constants | UPPER_SNAKE_CASE | `MAX_RAW_NOTES_LENGTH`, `ALLOWED_DOMAIN` |
| Zod schemas | camelCase + Schema | `sessionSchema`, `structuredOutputSchema` |
| API routes | kebab-case REST | `/api/sessions`, `/api/sessions/[id]`, `/api/ai/structure` |
| DB tables | snake_case plural | `sessions`, `themes`, `session_themes` |
| DB columns | snake_case | `client_name`, `session_date`, `created_at` |
| Env vars | UPPER_SNAKE_CASE | `AI_PROVIDER`, `AI_MODEL`, `NEXT_PUBLIC_SUPABASE_URL` |

### Exports

- **Named exports only.** Use `export function Component()` — not `export default`. Exception: Next.js page and layout components use `export default` as required by the framework.
- **Types exported alongside code.** `export interface`, `export type` in the same file as the component or function that uses them.

### Import Order

1. React and Next.js: `import { useState } from 'react'`, `import Link from 'next/link'`
2. Third-party libraries: `import { z } from 'zod'`, `import { useForm } from 'react-hook-form'`
3. Internal utilities: `import { cn } from '@/lib/utils'`
4. Internal components: `import { Button } from '@/components/ui/button'`
5. Internal services/hooks: `import { useAuth } from '@/lib/hooks/use-auth'`
6. Types (if separate): `import type { Session } from '@/lib/types'`

