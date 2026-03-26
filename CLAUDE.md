# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack TypeScript monorepo for an AI Avatar Creator — users create digital human clones and generate AI-powered lip-sync videos. Integrates with D-ID (avatar/video generation) and ElevenLabs (voice cloning) APIs.

## Monorepo Structure

- `artifacts/api-server/` — Express 5 backend
- `artifacts/avatar-creator/` — React 19 + Vite frontend
- `lib/api-spec/` — OpenAPI spec + Orval codegen config (source of truth for API contract)
- `lib/api-client-react/` — Generated React Query hooks (do not edit `src/generated/` manually)
- `lib/api-zod/` — Generated Zod validation schemas (do not edit `src/generated/` manually)
- `lib/db/` — Drizzle ORM schema + PostgreSQL connection

## Commands

```bash
# Root
pnpm build              # typecheck + build all packages
pnpm typecheck          # full type check (tsc --build for libs, then artifacts)
pnpm typecheck:libs     # type check shared libraries only

# Backend (from artifacts/api-server/)
pnpm dev                # build + start dev server
pnpm build              # esbuild → ESM bundle
pnpm typecheck

# Frontend (from artifacts/avatar-creator/)
pnpm dev                # Vite dev server on 0.0.0.0
pnpm build              # Vite production build
pnpm typecheck

# API codegen (from lib/api-spec/)
pnpm codegen            # regenerate api-client-react and api-zod from openapi.yaml

# Database (from lib/db/)
pnpm push               # push schema changes via Drizzle Kit
pnpm push-force         # force push schema changes
```

## Architecture

### Code Generation Pipeline
`lib/api-spec/openapi.yaml` is the single source of truth. Running `codegen` (Orval) regenerates:
- React Query hooks → `lib/api-client-react/src/generated/`
- Zod schemas + TS types → `lib/api-zod/src/generated/`

When changing API endpoints, update `openapi.yaml` first, then run codegen.

### Backend
- Express middleware chain: CORS → JSON parsing → API key extraction → pino-http logging → routes
- API keys come from request headers (`X-DID-Api-Key`, `X-ElevenLabs-Api-Key`) or env vars; injected into `req.didApiKey` / `req.elevenlabsApiKey` via middleware
- External integrations: `lib/did.ts` (D-ID), `lib/elevenlabs.ts` (ElevenLabs)
- DB types flow from `@workspace/db` (Drizzle-generated)

### Frontend
- Routing via `wouter`; page-based structure
- API keys stored in Zustand store with localStorage persistence (`store.ts`)
- Custom fetch wrapper in `api-client-react` injects base URL and auth tokens automatically — do not call `fetch` directly for API calls
- Path alias `@/` → `src/`
- Key domain hooks: `use-api-auth.ts`, `use-camera.ts`, `use-media-recorder.ts`, `use-face-mesh.ts` (MediaPipe)

### TypeScript Project References
Root `tsconfig.json` uses composite project references. Libraries emit only `.d.ts` files (`emitDeclarationOnly`). Run `pnpm typecheck:libs` before artifact typechecks to ensure declarations are current.

### Database
- Schema defined in `lib/db/schema/` (Drizzle ORM); tables: `avatars`, `videos`
- Zod schemas auto-derived from tables via `drizzle-zod`
- Schema changes require `pnpm push` from `lib/db/`

## Workspace Dependencies

Shared dependency versions are pinned via the pnpm workspace catalog in `pnpm-workspace.yaml`. When adding dependencies, use `catalog:` protocol entries rather than direct version strings where a catalog entry exists.
