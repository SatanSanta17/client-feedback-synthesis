# Synthesiser — Development Rules

## First Steps Every Session

1. Read `ARCHITECTURE.md` before making any changes — it contains the full system design, file map, data flow, and conventions.
2. If modifying any file, read it first — don't assume from memory.
3. If modifying a page or component, read its co-located components and relevant section files first.
4. Always ask for plan confirmation before coding.
5. Never make a document without being asked for explicitly.

## Critical Rules — Do NOT Violate

- **Follow the development process — no shortcuts.** Every change follows this sequence: (1) Understand the purpose — why does this matter to the user? (2) Write the PRD in `docs/<number>-<feature-name>/prd.md` (3) Get explicit approval on the PRD (4) Only after PRD approval, write the TRD in `docs/<number>-<feature-name>/trd.md` (5) Implement one PRD part at a time in small, pushable increments (6) Review, verify, move to the next part. No step is skipped. **Never create a TRD before its PRD is approved.**
- **No code changes without an approved PRD and TRD.** Every feature, fix, or refactor must first have a written PRD (Product Requirements Document) that is reviewed and approved. Only after PRD approval is the TRD (Technical Requirements Document) written. Code is not touched until both documents exist and are approved. No exceptions — not even "small" changes. **One exception:** trivial fixes (typos, CSS tweaks, one-line bugs) may skip the PRD/TRD — but still require explicit approval before any code is changed. Never change code silently.
- **Two-tier PRD structure: Master PRD and Section PRDs.** The Master PRD (`docs/master-prd/prd.md`) defines the full product scope across numbered sections. Each section gets its own dedicated PRD and TRD folder under `docs/<number>-<name>/` (e.g., `docs/001-foundation/`). The Master PRD is the big picture — section PRDs contain detailed requirements, parts, and acceptance criteria.
- **Section PRD/TRD folder convention.** Each section gets its own folder under `docs/` named `<number>-<feature-name>/` (e.g., `docs/001-foundation/`). Inside: `prd.md` (product requirements) and `trd.md` (technical design). The PRD is written first and submitted for approval. The TRD is only created after the PRD is explicitly approved — never at the same time. The PRD is product-only — requirements, acceptance criteria, user stories. The TRD is technical — DB schemas, API contracts, file changes, implementation increments.
- **Section PRDs have parts, not monolithic requirements.** Large sections are split into numbered parts within their PRD (Part 1, Part 2, Part 3). Each part has its own requirements (P1.R1, P1.R2, etc.) and acceptance criteria. The TRD mirrors the same part structure. Implementation happens one part at a time — the owner says "implement Part 1," that part ships, then "implement Part 2" when ready. Parts that aren't ready yet stay in the document as roadmap, not commitment.
- **PRD contains: purpose, user story, requirements (numbered per part), acceptance criteria (checkboxes per part), and a backlog section** for deferred ideas that don't belong in the current scope but shouldn't be forgotten. No technical details in the PRD — those go in the TRD.
- **TRD mirrors the PRD structure** — same part numbers, same feature boundaries. Each part includes: database models, API endpoints, frontend pages/components, files changed, and implementation increments. The TRD is the implementation blueprint — it answers "how" for everything the PRD says "what."
- **Each TRD part breaks down into increments. Each increment produces one or more PRs.** An increment is a self-contained, verifiable unit of implementation work. A PR is the smallest pushable unit of code. Never lose sight of the PRD's end goal, but never try to ship it all at once either.
- **Verify before every push.** Before code is pushed, every change must pass four checks: (1) **Code quality** — read every modified file end-to-end for syntax errors, unused imports, broken references, and consistency with existing patterns. (2) **PRD compliance** — walk through each PRD requirement and confirm the implementation covers it. (3) **No regressions** — trace existing flows through modified files to confirm the happy path still works and new code only activates in the intended scenario. (4) **Documentation consistency** — check if ARCHITECTURE.md or any README in the modified area is now factually incorrect. If it contradicts the new code, fix it.
- **Respect existing architecture decisions.** `ARCHITECTURE.md` documents platform-specific rules, data flow, and constraints that must not be violated. Read and follow them.
- **Update ARCHITECTURE.md after every change** that modifies file structure, adds routes, services, database tables, or environment variables. Architecture follows code — never the other way around. If something is documented in ARCHITECTURE.md, it must exist in the codebase. Never pre-fill architecture docs with planned-but-unbuilt structures.
- **Maintain the CHANGELOG.** Every user-facing change, API change, or database migration is logged in `CHANGELOG.md` with the date and a short description. Group entries under the relevant PRD/part number.

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
- **Environment variables follow the `NEXT_PUBLIC_` convention.** Client-accessible env vars must be prefixed with `NEXT_PUBLIC_`. Server-only secrets (Supabase service role key, Claude API key) must never be prefixed. Never expose API keys or secrets to the client bundle.

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

- **Tailwind CSS with a clean, utilitarian design.** White background, neutral greys, single brand accent colour (indigo/purple). No unnecessary visual complexity.
- **Use a utility function for conditional classes.** Never concatenate class strings manually. Always use `cn()` (clsx + tailwind-merge) that handles Tailwind class conflicts.
- **Mobile-readable, desktop-first.** The app is designed for desktop use. It should be legible on mobile but is not optimised for it.
- **Consistent spacing and sizing.** Use Tailwind's spacing scale consistently. Don't mix arbitrary pixel values with Tailwind units.
- **Theme and typography are defined globally.** All shared colours, font sizes, font weights, border radii, shadows, and brand tokens (accent colours, status colours, badge colours) must be defined in `globals.css` using CSS custom properties or Tailwind's `@layer` directives — never scattered as inline values across components. Components reference these global tokens via Tailwind classes or `var(--token-name)`. This makes theme-wide changes a single-file edit instead of a project-wide find-and-replace. If a colour, font size, or spacing value appears in more than one component, it belongs in the global stylesheet.

### API Routes (Next.js Route Handlers)

- **All external API calls are server-side only.** Claude API calls, Supabase service-role operations, and any secret-dependent logic lives in `app/api/` route handlers. Never call these from the client directly.
- **Route handlers validate input with Zod.** Every POST/PUT handler parses the request body with a Zod schema. Invalid input returns 400 with a descriptive error.
- **Route handlers don't contain business logic.** They validate input, call service functions from `lib/services/`, and format responses. If a route handler exceeds ~30 lines, extract logic to a service.
- **HTTP status codes are explicit.** 400 = bad input, 401 = unauthenticated, 403 = forbidden, 404 = not found, 409 = conflict, 422 = unprocessable (e.g., Claude returned bad output), 500 = server error. Always include a JSON body with a `message` field.
- **Service functions live in `lib/services/`.** Each domain gets a service file (e.g., `session-service.ts`, `theme-service.ts`, `ai-service.ts`). Services handle data access (Supabase queries), business logic, and external API calls (Claude). Services never import from `next/server` — they are framework-agnostic.

---

## Supabase & Database Conventions

- **Supabase client is created once per context.** Use `createServerClient` in server components and API routes (with cookies). Use `createBrowserClient` in client components. Never instantiate clients inline.
- **Two client types: `anon` and `service_role`.** The `anon` client respects RLS and is used for user-facing reads/writes. The `service_role` client bypasses RLS and is used only in server-side admin operations. Never expose the service role key to the client.
- **Row-Level Security (RLS) is always enabled.** Every table has RLS policies. Default deny — explicitly grant access. All rows readable and writable only by authenticated users.
- **Schema changes are documented.** Every migration is recorded in the TRD before execution. The ARCHITECTURE.md data model section is updated after each migration.
- **Timestamps are UTC.** All `created_at`, `updated_at`, `deleted_at` columns use `timestamptz` and store UTC values.
- **Soft deletes by default.** Use a `deleted_at` column. Queries filter `WHERE deleted_at IS NULL` unless explicitly recovering deleted records.
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

## AI Integration — Claude API Conventions

- **All Claude API calls are server-side.** Made from Next.js API routes, never from the browser. The API key is an environment variable (`ANTHROPIC_API_KEY`), never exposed to the client.
- **Prompts are version-controlled.** Prompt templates live in `lib/prompts/` as named exports. Each prompt file contains the system message, user message template, and expected response schema. Changing a prompt is a code change that goes through review.
- **Model name is an environment variable.** `CLAUDE_MODEL` (e.g., `claude-opus-4-5`) is set in `.env` and read in the service layer. Never hardcode model names.
- **Structured JSON output.** Claude is instructed to return JSON matching a defined schema. The API route parses the response with `JSON.parse()` wrapped in try/catch. Malformed output returns 422 to the client.
- **Validate Claude output against a Zod schema.** After parsing JSON, validate it against a Zod schema before returning to the client. Never trust raw LLM output.
- **Set `max_tokens` on every call.** Never let the model decide how long to respond. Set explicit limits based on expected output size.
- **Handle all failure modes.** Every Claude API call must handle: timeouts, rate limits (429), malformed responses, empty responses, and service outages. Retry transient failures (429, 500, timeout) up to 3 times with exponential backoff. Don't retry 400 errors — that's a prompt bug.
- **Degrade gracefully.** If Claude fails after retries, the user can still save raw notes manually. AI structuring is an enhancement, not a gate.
- **Never expose raw API errors to users.** Wrap failures in user-friendly messages. Log the raw error server-side.
- **Be explicit about what Claude should NOT do.** "Do not hallucinate data not present in the notes", "If a field cannot be extracted, return null", "Do not add conversational text in the JSON response."

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
| Env vars | UPPER_SNAKE_CASE | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `NEXT_PUBLIC_SUPABASE_URL` |

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

---

## After Making Changes

1. Update `ARCHITECTURE.md` if you changed any file structure, added routes, services, database tables, or env vars.
2. Update `CHANGELOG.md` with a short description of the change.
3. Verify all file references in documentation still exist.
4. Test the flows affected by the change.
5. If adding a new frontend component, verify it follows the naming, export, and styling conventions above.
6. If adding a new API route or service, verify it follows the validation, error handling, and logging conventions above.
7. If modifying the database schema, regenerate Supabase types and update the data model section in ARCHITECTURE.md.
