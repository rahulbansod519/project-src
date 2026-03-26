# Running the AI Avatar Creator Locally

## Prerequisites

- Node.js 24 + pnpm
- Python 3.11 (in `/Volumes/RecordSSD/Avatar/avatar-venv/`)
- ffmpeg (`brew install ffmpeg`)
- PostgreSQL (Neon free tier recommended)
- SadTalker cloned to `/Volumes/RecordSSD/Avatar/SadTalker`

## One-time Setup

### 1. Install dependencies
```bash
pnpm install
pnpm add -w lightningcss-darwin-arm64 @tailwindcss/oxide-darwin-arm64
```

### 2. Push database schema
```bash
cd lib/db
DATABASE_URL='your-neon-url' pnpm push
```

## Starting the App (3 terminals)

### Terminal 1 — Python video service

**Dev mode** (instant stub videos, no RAM needed — use for UI development):
```bash
cd artifacts/local-video-service
DEV_MODE=true bash start-service.sh
```

**Production mode** (real lip-sync videos, needs ~6GB free RAM):
```bash
cd artifacts/local-video-service
bash start-service.sh
```

### Terminal 2 — Express backend
```bash
cd artifacts/api-server
PORT=3001 DATABASE_URL='your-neon-url' pnpm dev
```

### Terminal 3 — React frontend
```bash
cd artifacts/avatar-creator
PORT=5173 BASE_PATH=/ BACKEND_URL=http://localhost:3001 pnpm dev
```

Open **http://localhost:5173**

## Features

- **Capture Studio** — take a photo + record voice sample to create an avatar
- **Script Studio** — write a script, click **Preview Voice** to hear it instantly, then **Generate Video** for the full lip-sync video
- **Video Library** — view all generated videos

## Tips

- Use **Preview Voice** in Script Studio to hear your cloned voice before committing to a full video render
- First video generation loads SadTalker models (~2 min). All subsequent videos are faster
- Same avatar = cached 3DMM coefficients = faster rendering
- Keep scripts short (1-3 sentences) for faster video generation
- Free RAM before starting production mode: close Chrome, Slack, etc.

## RAM requirements

| Mode | RAM needed |
|------|-----------|
| DEV_MODE (stubs) | ~1 GB |
| Audio preview only | ~3 GB (XTTS) |
| Full video generation | ~6 GB (XTTS + SadTalker) |
