# AI Avatar Creator

Create a digital human clone of yourself — capture your face and voice, then generate AI-powered lip-sync videos from any script. Runs fully offline on Apple Silicon.

## What It Does

1. **Capture Studio** — take a photo with your webcam + record a voice sample
2. **Script Studio** — write a script, preview your cloned voice instantly, generate a lip-sync video
3. **Video Library** — watch, download, and manage all generated videos

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite, Tailwind CSS, TanStack Query, Zustand |
| Backend | Express 5, TypeScript, Drizzle ORM, PostgreSQL |
| Voice cloning | Chatterbox TTS (350MB, beats ElevenLabs in blind tests) |
| Lip-sync video | SadTalker (runs on Apple Silicon MPS/CPU) |
| Database | PostgreSQL (Neon free tier recommended) |

## Prerequisites

- Node.js 24 + pnpm
- Python 3.11 — `brew install python@3.11`
- ffmpeg — `brew install ffmpeg`
- PostgreSQL (use [Neon](https://neon.tech) free tier)

## Setup

### 1. Install Node dependencies
```bash
pnpm install
pnpm add -w lightningcss-darwin-arm64 @tailwindcss/oxide-darwin-arm64
```

### 2. Install Python dependencies + SadTalker (one time, ~7 GB)
```bash
# Installs venv + Chatterbox TTS + SadTalker + model checkpoints
# Pass an install path as first argument (default: next to install.sh)
bash artifacts/local-video-service/install.sh /path/to/install
```

This sets up a Python venv, clones SadTalker, downloads all model weights, and writes a ready-to-use `start-service.sh`.

### 3. Push database schema (one time)
```bash
cd lib/db
DATABASE_URL='your-neon-url' pnpm push
```

## Running

Start all 3 services in separate terminals:

**Terminal 1 — Python video service**
```bash
cd artifacts/local-video-service

# Dev mode (instant stub videos, no RAM needed)
DEV_MODE=true bash start-service.sh

# (real lip-sync, needs ~6GB free RAM)
bash start-service.sh
```

**Terminal 2 — Express backend**
```bash
cd artifacts/api-server
PORT=3001 DATABASE_URL='your-neon-url' pnpm dev
```

**Terminal 3 — React frontend**
```bash
cd artifacts/avatar-creator
PORT=5173 BASE_PATH=/ BACKEND_URL=http://localhost:3001 pnpm dev
```

Open **http://localhost:5173**

## RAM Requirements

| Mode | RAM |
|------|-----|
| DEV_MODE (stub videos) | ~1 GB |
| Audio preview only | ~3 GB |
| Full video generation | ~6 GB |

Free up RAM before production mode — close Chrome, Slack, etc.

## Voice Cloning Tips

- Record voice sample in a quiet room (no background noise)
- Speak naturally at your normal pace — 10–15 seconds minimum
- Keep mic 20–30cm from mouth
- Re-record if output sounds American — sample quality is everything

## Key Parameters (Chatterbox TTS)

| Parameter | Range | Effect |
|-----------|-------|--------|
| `cfg_weight` | 0–1 | How closely it follows your voice. Sweet spot: **0.55–0.65** |
| `exaggeration` | 0–1 | How much it copies your speaking style. Sweet spot: **0.4–0.5** |

## Architecture

```
Browser → Vite (5173) → [proxy] → Express API (3001) → PostgreSQL (Neon)
                                                       → Python Service (8001)
                                                           ├── Chatterbox TTS
                                                           └── SadTalker
```

- API contract defined in `lib/api-spec/openapi.yaml` — source of truth
- Run `pnpm codegen` from `lib/api-spec/` after changing endpoints
- Schema changes: `pnpm push` from `lib/db/`

## Docs

- [`RUNNING.md`](./RUNNING.md) — detailed setup guide
- [`docs/voice-cloning-case-study.md`](./docs/voice-cloning-case-study.md) — how we achieved near-perfect voice cloning
