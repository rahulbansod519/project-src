# Workspace

## Overview

pnpm workspace monorepo using TypeScript. AI Avatar Creator application that lets users create a digital human clone of themselves using camera/microphone, then generate AI-powered lip-sync videos.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, Tailwind CSS, TanStack React Query, wouter, Framer Motion, Zustand

## External AI Services

- **D-ID** (`https://api.d-id.com`) — Avatar creation (actors) and video generation (lip-sync talks/clips)
- **ElevenLabs** (`https://api.elevenlabs.io/v1`) — Voice cloning from audio samples

API keys are provided by the user in the Settings page and stored in localStorage. They are passed to the backend as `X-DID-Api-Key` and `X-ElevenLabs-Api-Key` request headers.

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── did.ts          # D-ID API integration
│   │       │   └── elevenlabs.ts   # ElevenLabs API integration
│   │       ├── middlewares/
│   │       │   └── apikeys.ts      # Extracts X-DID-Api-Key and X-ElevenLabs-Api-Key headers
│   │       └── routes/
│   │           ├── avatars.ts      # Avatar CRUD + voice upload
│   │           ├── videos.ts       # Video generation + status polling
│   │           └── settings.ts     # API key connection test
│   └── avatar-creator/     # React + Vite frontend
│       └── src/
│           ├── pages/
│           │   ├── dashboard.tsx       # Home with avatar and video stats
│           │   ├── capture-studio.tsx  # Camera capture + voice recording wizard
│           │   ├── avatar-detail.tsx   # Avatar details and associated videos
│           │   ├── script-studio.tsx   # Script-to-video generation
│           │   ├── video-library.tsx   # All videos grid
│           │   └── settings.tsx        # API key configuration
│           ├── hooks/
│           │   ├── use-api-auth.ts     # Reads API keys from Zustand store
│           │   ├── use-camera.ts       # Camera stream + photo capture
│           │   └── use-media-recorder.ts # Audio recording with MediaRecorder
│           ├── lib/
│           │   ├── store.ts            # Zustand store (API keys, settings)
│           │   └── utils.ts            # Utility functions
│           └── components/
│               └── layout.tsx          # App shell with sidebar navigation
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/
│       └── src/schema/
│           ├── avatars.ts  # avatars table (id, name, did_avatar_id, elevenlabs_voice_id, ...)
│           └── videos.ts   # videos table (id, avatar_id, script, status, video_url, ...)
```

## App Features

### User Flow
1. **Settings** — Enter D-ID and ElevenLabs API keys, test connection
2. **Capture Studio** — 3-step wizard: face capture via webcam → voice sample via microphone → name and submit
3. **Avatar Created** — D-ID actor is created from the captured image; ElevenLabs voice is cloned from audio
4. **Script Studio** — Select avatar, enter script, choose emotion (neutral/happy/sad/excited/calm/confident/serious), language, optional background URL → generate video
5. **Video Library** — View all videos, download MP4s, track status (pending/processing/ready/failed)

### API Endpoints (under `/api`)
- `GET /healthz` — Health check
- `GET /avatars` — List all avatars
- `POST /avatars` — Create avatar (with optional imageBase64 or imageUrl)
- `GET /avatars/:id` — Get avatar
- `DELETE /avatars/:id` — Delete avatar
- `POST /avatars/:id/voice` — Upload voice sample (audioBase64) → ElevenLabs clone
- `GET /avatars/:id/videos` — List videos for avatar
- `GET /videos` — List all videos
- `POST /videos` — Generate video (avatarId, script, language, emotion, backgroundUrl)
- `GET /videos/:id` — Get video (also polls D-ID status if pending)
- `DELETE /videos/:id` — Delete video
- `POST /settings/test` — Test API key validity

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate React Query hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
