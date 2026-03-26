# Local Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the D-ID cloud API with a fully local talking-head video generation pipeline using SadTalker (lip sync) + edge-tts (TTS), served from the existing Express backend with no external API keys required.

**Architecture:** A Python FastAPI microservice (`artifacts/local-video-service/`) wraps SadTalker and edge-tts. The Express backend's `routes/videos.ts` calls this service instead of D-ID. Avatar images are saved to the local filesystem instead of D-ID's CDN, and served as static files from Express. The existing DB schema and polling pattern are preserved — the `didVideoId` column stores the local job ID.

**Tech Stack:** Python 3.9+, FastAPI, SadTalker, edge-tts, Node.js/Express, TypeScript, vitest

---

## System Requirements

### Minimum (CPU-only)

| Requirement | Value |
|-------------|-------|
| Python | 3.9+ |
| RAM | 8 GB |
| Disk | 15 GB free (SadTalker models ~5 GB + workspace) |
| CPU | Any modern x86-64 or ARM64 |
| Time per video | ~5–15 minutes |

### Recommended (NVIDIA GPU)

| Requirement | Value |
|-------------|-------|
| GPU | NVIDIA with 6 GB+ VRAM (RTX 3060 or better) |
| CUDA | 11.8+ |
| Time per video | ~30–90 seconds |

### Apple Silicon (M1/M2/M3)
- Uses MPS acceleration (~2–4 minutes per video)
- Python 3.10+ recommended

### Internet
`edge-tts` requires internet access to Microsoft's Edge TTS service (no API key, free). For fully offline TTS, replace `edge-tts` in `main.py` with [`piper-tts`](https://github.com/rhasspy/piper): `pip install piper-tts` and swap the `run_tts` function.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `artifacts/local-video-service/requirements.txt` | Python dependencies |
| Create | `artifacts/local-video-service/install.sh` | Clone SadTalker + download models |
| Create | `artifacts/local-video-service/main.py` | FastAPI: `/generate`, `/status/{id}`, `/health` |
| Create | `artifacts/api-server/src/lib/storage.ts` | Save base64 images to local filesystem |
| Create | `artifacts/api-server/src/lib/storage.test.ts` | Tests for storage.ts |
| Create | `artifacts/api-server/src/lib/local-video.ts` | TypeScript HTTP client for Python service |
| Create | `artifacts/api-server/src/lib/local-video.test.ts` | Tests for local-video.ts |
| Create | `artifacts/api-server/vitest.config.ts` | vitest configuration |
| Modify | `artifacts/api-server/package.json` | Add vitest dev dependency + test scripts |
| Modify | `artifacts/api-server/src/app.ts` | Serve `uploads/` as static files |
| Modify | `artifacts/api-server/src/routes/avatars.ts` | Use `storage.ts` instead of `didUploadImage` |
| Modify | `artifacts/api-server/src/routes/videos.ts` | Use `local-video.ts` instead of `did.ts` |

---

## Task 1: Add vitest to api-server

**Files:**
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run from `artifacts/api-server/`:
```bash
pnpm add -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `artifacts/api-server/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
```

- [ ] **Step 3: Add test scripts to package.json**

In `artifacts/api-server/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs without error**

```bash
pnpm test
```
Expected output: "No test files found, exiting with code 0" (exits 0, no crash)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/package.json artifacts/api-server/vitest.config.ts
git commit -m "chore: add vitest to api-server"
```

---

## Task 2: Local image storage utility

**Files:**
- Create: `artifacts/api-server/src/lib/storage.ts`
- Create: `artifacts/api-server/src/lib/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/storage.test.ts`:
```typescript
import { describe, it, expect, afterEach } from "vitest";
import { saveBase64Image, urlPathToAbsPath } from "./storage.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

// 1×1 white JPEG encoded as base64
const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDB" +
  "kSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEB" +
  "AxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAA" +
  "AAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ACWAB//Z";

describe("saveBase64Image", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves a JPEG data URI to disk and returns a /uploads/images URL path", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));

    const urlPath = await saveBase64Image(TINY_JPEG, tmpDir);

    expect(urlPath).toMatch(/^\/uploads\/images\/.+\.jpg$/);
    const filename = path.basename(urlPath);
    const bytes = await fs.readFile(path.join(tmpDir, filename));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("creates the uploads directory if it does not exist", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));
    const subDir = path.join(tmpDir, "deep", "nested");

    const urlPath = await saveBase64Image(TINY_JPEG, subDir);

    expect(urlPath).toMatch(/^\/uploads\/images\/.+\.jpg$/);
  });
});

describe("urlPathToAbsPath", () => {
  it("converts a /uploads/images URL path to an absolute filesystem path", () => {
    const result = urlPathToAbsPath("/uploads/images/abc.jpg", "/app");
    expect(result).toBe("/app/uploads/images/abc.jpg");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm test
```
Expected: FAIL — `Cannot find module './storage.js'`

- [ ] **Step 3: Implement storage.ts**

Create `artifacts/api-server/src/lib/storage.ts`:
```typescript
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * Saves a base64-encoded image data URI to the local filesystem.
 * @param imageBase64 - data URI, e.g. "data:image/jpeg;base64,..."
 * @param uploadsDir  - absolute path to the directory to write into
 * @returns URL path for storing in DB, e.g. "/uploads/images/uuid.jpg"
 */
export async function saveBase64Image(
  imageBase64: string,
  uploadsDir: string
): Promise<string> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const filename = `${crypto.randomUUID()}.jpg`;
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, filename), buffer);
  return `/uploads/images/${filename}`;
}

/**
 * Converts a /uploads/... URL path to an absolute filesystem path.
 * @param urlPath    - e.g. "/uploads/images/uuid.jpg"
 * @param serverRoot - absolute path to the server's working directory
 */
export function urlPathToAbsPath(urlPath: string, serverRoot: string): string {
  return path.join(serverRoot, urlPath);
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm test
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/storage.ts artifacts/api-server/src/lib/storage.test.ts
git commit -m "feat: add local image storage utility"
```

---

## Task 3: TypeScript client for the local video service

**Files:**
- Create: `artifacts/api-server/src/lib/local-video.ts`
- Create: `artifacts/api-server/src/lib/local-video.test.ts`

- [ ] **Step 1: Write failing tests**

Create `artifacts/api-server/src/lib/local-video.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { localGenerateVideo, localGetVideoStatus } from "./local-video.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  process.env.LOCAL_VIDEO_SERVICE_URL = "http://localhost:8001";
});

describe("localGenerateVideo", () => {
  it("POSTs to /generate and returns jobId with processing status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job_id: "abc-123" }),
    });

    const result = await localGenerateVideo("/uploads/images/test.jpg", "Hello world", "en");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8001/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          image_path: "/uploads/images/test.jpg",
          script: "Hello world",
          language: "en",
        }),
      })
    );
    expect(result.jobId).toBe("abc-123");
    expect(result.status).toBe("processing");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal error",
    });
    await expect(
      localGenerateVideo("/img.jpg", "text", "en")
    ).rejects.toThrow("Local video service error: 500");
  });
});

describe("localGetVideoStatus", () => {
  it("maps 'ready' status to 'done' and extracts basename for videoUrl", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ready",
        video_path: "/some/deep/path/uploads/videos/abc-123.mp4",
      }),
    });

    const result = await localGetVideoStatus("abc-123");

    expect(result.status).toBe("done");
    expect(result.videoUrl).toBe("/uploads/videos/abc-123.mp4");
  });

  it("returns processing status with no videoUrl", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "processing" }),
    });

    const result = await localGetVideoStatus("abc-123");

    expect(result.status).toBe("processing");
    expect(result.videoUrl).toBeUndefined();
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "not found",
    });
    await expect(localGetVideoStatus("bad-id")).rejects.toThrow(
      "Local video service status error: 404"
    );
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm test
```
Expected: FAIL — `Cannot find module './local-video.js'`

- [ ] **Step 3: Implement local-video.ts**

Create `artifacts/api-server/src/lib/local-video.ts`:
```typescript
import path from "path";

const LOCAL_VIDEO_SERVICE_URL =
  process.env.LOCAL_VIDEO_SERVICE_URL ?? "http://localhost:8001";

export interface LocalVideoResult {
  jobId: string;
  status: "processing";
}

export interface LocalVideoStatus {
  status: "processing" | "done" | "failed";
  videoUrl?: string;
}

/**
 * Submit a video generation job to the local Python service.
 * @param imagePath - absolute filesystem path to the avatar image
 * @param script    - text to speak
 * @param language  - BCP-47 language code, e.g. "en", "es"
 */
export async function localGenerateVideo(
  imagePath: string,
  script: string,
  language: string = "en"
): Promise<LocalVideoResult> {
  const res = await fetch(`${LOCAL_VIDEO_SERVICE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_path: imagePath, script, language }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Local video service error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { job_id: string };
  return { jobId: data.job_id, status: "processing" };
}

/**
 * Poll the local Python service for a job's status.
 * Maps "ready" → "done" to match the status strings expected by routes/videos.ts.
 */
export async function localGetVideoStatus(
  jobId: string
): Promise<LocalVideoStatus> {
  const res = await fetch(`${LOCAL_VIDEO_SERVICE_URL}/status/${jobId}`);

  if (!res.ok) {
    throw new Error(`Local video service status error: ${res.status}`);
  }

  const data = (await res.json()) as {
    status: string;
    video_path?: string;
  };

  const status =
    data.status === "ready"
      ? "done"
      : (data.status as "processing" | "failed");

  const videoUrl = data.video_path
    ? `/uploads/videos/${path.basename(data.video_path)}`
    : undefined;

  return { status, videoUrl };
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm test
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/local-video.ts artifacts/api-server/src/lib/local-video.test.ts
git commit -m "feat: add TypeScript client for local video service"
```

---

## Task 4: Serve uploads as static files from Express

**Files:**
- Modify: `artifacts/api-server/src/app.ts`

- [ ] **Step 1: Update app.ts**

Replace the entire contents of `artifacts/api-server/src/app.ts` with:
```typescript
import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { extractApiKeys } from "./middlewares/apikeys.js";

const app: Express = express();
const uploadsDir = path.join(process.cwd(), "uploads");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);
app.use(cors());
app.use("/uploads", express.static(uploadsDir));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(extractApiKeys);
app.use("/api", router);

export default app;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/app.ts
git commit -m "feat: serve uploads/ directory as static files"
```

---

## Task 5: Update avatar creation to store images locally

**Files:**
- Modify: `artifacts/api-server/src/routes/avatars.ts`

The `POST /avatars` handler currently calls `didUploadImage()` when a D-ID key is present. Replace that with local filesystem storage, which works regardless of whether a D-ID key exists.

- [ ] **Step 1: Update imports in avatars.ts**

Replace the import line:
```typescript
import { didUploadImage } from "../lib/did.js";
```
With:
```typescript
import path from "path";
import { saveBase64Image } from "../lib/storage.js";
```

- [ ] **Step 2: Replace the POST /avatars handler body**

Replace the entire `router.post("/avatars", ...)` handler:
```typescript
router.post("/avatars", async (req, res): Promise<void> => {
  const parsed = CreateAvatarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, imageBase64, imageUrl: providedImageUrl, pose } = parsed.data;

  let finalImageUrl: string | undefined = providedImageUrl ?? undefined;

  if (imageBase64) {
    const uploadsDir = path.join(process.cwd(), "uploads", "images");
    finalImageUrl = await saveBase64Image(imageBase64, uploadsDir);
    req.log.info({ finalImageUrl }, "Avatar image saved locally");
  }

  const [avatar] = await db
    .insert(avatarsTable)
    .values({
      name,
      imageUrl: finalImageUrl ?? null,
      thumbnailUrl: imageBase64 ?? null,
      didAvatarId: null,
      status: "ready",
      hasVoice: false,
      pose: pose ?? null,
    })
    .returning();

  res.status(201).json(GetAvatarResponse.parse(avatar));
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/avatars.ts
git commit -m "feat: store avatar images on local filesystem instead of D-ID CDN"
```

---

## Task 6: Replace D-ID video generation with local service

**Files:**
- Modify: `artifacts/api-server/src/routes/videos.ts`

- [ ] **Step 1: Replace imports**

Replace:
```typescript
import {
  didGenerateTalkVideo,
  didGetVideoStatus,
  didUploadImage,
} from "../lib/did.js";
```
With:
```typescript
import path from "path";
import { localGenerateVideo, localGetVideoStatus } from "../lib/local-video.js";
import { saveBase64Image, urlPathToAbsPath } from "../lib/storage.js";
```

- [ ] **Step 2: Replace the pollVideoStatus function**

Replace the entire `pollVideoStatus` function:
```typescript
async function pollVideoStatus(
  videoId: string,
  localJobId: string
): Promise<void> {
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes at 5-second intervals

  const poll = async (): Promise<void> => {
    if (attempts >= maxAttempts) {
      await db
        .update(videosTable)
        .set({
          status: "failed",
          errorMessage: "Timeout waiting for local video generation",
          updatedAt: new Date(),
        })
        .where(eq(videosTable.id, videoId));
      return;
    }
    attempts++;

    try {
      const result = await localGetVideoStatus(localJobId);

      if (result.status === "done" && result.videoUrl) {
        await db
          .update(videosTable)
          .set({
            status: "ready",
            videoUrl: result.videoUrl,
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, videoId));
      } else if (result.status === "failed") {
        await db
          .update(videosTable)
          .set({
            status: "failed",
            errorMessage: "Local video generation failed",
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, videoId));
      } else {
        setTimeout(poll, 5000);
      }
    } catch {
      setTimeout(poll, 5000);
    }
  };

  setTimeout(poll, 5000);
}
```

- [ ] **Step 3: Replace the POST /videos handler**

Replace the entire `router.post("/videos", ...)` handler:
```typescript
router.post("/videos", async (req, res): Promise<void> => {
  const parsed = GenerateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    avatarId,
    script,
    language = "en",
    emotion = "neutral",
    backgroundUrl,
    backgroundColorHex,
    stitch = false,
  } = parsed.data;

  const [avatar] = await db
    .select()
    .from(avatarsTable)
    .where(eq(avatarsTable.id, avatarId));

  if (!avatar) {
    res.status(400).json({ error: "Avatar not found" });
    return;
  }

  if (!avatar.imageUrl) {
    res.status(400).json({
      error: "Avatar has no source image. Please recreate the avatar.",
    });
    return;
  }

  // Lazily migrate avatars that still have a base64 data URI as their image.
  let imageUrlPath = avatar.imageUrl;
  if (avatar.imageUrl.startsWith("data:")) {
    req.log.info({ avatarId: avatar.id }, "Migrating base64 avatar image to local storage");
    const uploadsDir = path.join(process.cwd(), "uploads", "images");
    imageUrlPath = await saveBase64Image(avatar.imageUrl, uploadsDir);
    await db
      .update(avatarsTable)
      .set({ imageUrl: imageUrlPath, updatedAt: new Date() })
      .where(eq(avatarsTable.id, avatar.id));
  }

  const absoluteImagePath = urlPathToAbsPath(imageUrlPath, process.cwd());

  let localJobId: string | undefined;
  let status: "pending" | "processing" | "ready" | "failed" = "pending";
  let errorMessage: string | undefined;

  try {
    const result = await localGenerateVideo(
      absoluteImagePath,
      script,
      language ?? "en"
    );
    localJobId = result.jobId;
    status = "processing";
  } catch (err) {
    req.log.error({ err }, "Failed to start local video generation");
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: errorMessage });
    return;
  }

  const [video] = await db
    .insert(videosTable)
    .values({
      avatarId,
      script,
      language: language ?? "en",
      emotion: (emotion ?? "neutral") as
        | "neutral"
        | "happy"
        | "sad"
        | "excited"
        | "calm"
        | "confident"
        | "serious",
      backgroundUrl: backgroundUrl ?? null,
      backgroundColorHex: backgroundColorHex ?? null,
      stitch: stitch ?? false,
      didVideoId: localJobId ?? null, // column reused to store the local job ID
      status,
      errorMessage: errorMessage ?? null,
    })
    .returning();

  if (localJobId) {
    pollVideoStatus(video.id, localJobId);
  }

  res.status(202).json(GetVideoResponse.parse(video));
});
```

- [ ] **Step 4: Replace the GET /videos/:id polling block**

In `router.get("/videos/:id", ...)`, replace the two blocks that reference D-ID (the "no didVideoId" check and the polling block) with:

```typescript
  // If no job ID recorded, the video was never submitted to the local service.
  if (!video.didVideoId && (video.status === "pending" || video.status === "processing")) {
    const [updated] = await db
      .update(videosTable)
      .set({
        status: "failed",
        errorMessage: "Video was never submitted to the local video service.",
        updatedAt: new Date(),
      })
      .where(eq(videosTable.id, video.id))
      .returning();
    res.json(GetVideoResponse.parse(updated));
    return;
  }

  if (video.didVideoId && (video.status === "pending" || video.status === "processing")) {
    try {
      const result = await localGetVideoStatus(video.didVideoId);
      if (result.status === "done" && result.videoUrl) {
        const [updated] = await db
          .update(videosTable)
          .set({
            status: "ready",
            videoUrl: result.videoUrl,
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, video.id))
          .returning();
        res.json(GetVideoResponse.parse(updated));
        return;
      } else if (result.status === "failed") {
        const [updated] = await db
          .update(videosTable)
          .set({
            status: "failed",
            errorMessage: "Local video generation failed",
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, video.id))
          .returning();
        res.json(GetVideoResponse.parse(updated));
        return;
      }
    } catch (err) {
      req.log.warn({ err }, "Failed to poll local video status");
    }
  }
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/videos.ts
git commit -m "feat: replace D-ID video generation with local video service"
```

---

## Task 7: Create the Python local video service

**Files:**
- Create: `artifacts/local-video-service/requirements.txt`
- Create: `artifacts/local-video-service/install.sh`
- Create: `artifacts/local-video-service/main.py`

- [ ] **Step 1: Create requirements.txt**

Create `artifacts/local-video-service/requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
edge-tts==7.0.2
```

- [ ] **Step 2: Create install.sh**

Create `artifacts/local-video-service/install.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing Python service dependencies..."
pip install -r requirements.txt

echo "==> Cloning SadTalker..."
if [ ! -d "SadTalker" ]; then
  git clone https://github.com/OpenTalker/SadTalker.git
fi

echo "==> Installing SadTalker Python dependencies..."
pip install -r SadTalker/requirements.txt

echo "==> Downloading SadTalker model checkpoints (~3.5 GB)..."
cd SadTalker
bash scripts/download_models.sh
cd ..

echo ""
echo "Done. Start the service with:"
echo "  cd $SCRIPT_DIR"
echo "  LOCAL_UPLOADS_DIR=\$(pwd)/../api-server/uploads uvicorn main:app --host 0.0.0.0 --port 8001"
```

Make it executable:
```bash
chmod +x artifacts/local-video-service/install.sh
```

- [ ] **Step 3: Create main.py**

Create `artifacts/local-video-service/main.py`:
```python
"""
Local talking-head video generation service.

Replaces the D-ID API with:
  - edge-tts  : text-to-speech (free, uses Microsoft Edge TTS, requires internet)
  - SadTalker : lip-sync + head animation from a single photo + audio

Setup:
  bash install.sh

Start:
  LOCAL_UPLOADS_DIR=/path/to/api-server/uploads uvicorn main:app --host 0.0.0.0 --port 8001
"""
import asyncio
import os
import shutil
import uuid
from pathlib import Path

import edge_tts
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Local Video Service")

SCRIPT_DIR = Path(__file__).parent.resolve()
SADTALKER_DIR = SCRIPT_DIR / "SadTalker"

# Point this at the api-server's uploads directory so Express can serve the files.
UPLOADS_DIR = Path(
    os.environ.get(
        "LOCAL_UPLOADS_DIR",
        str(SCRIPT_DIR.parent / "api-server" / "uploads"),
    )
)

# In-memory job store. Restarts clear jobs but generated video files persist.
JOBS: dict[str, dict] = {}

# Matches the voice map in artifacts/api-server/src/lib/did.ts
LANGUAGE_VOICE: dict[str, str] = {
    "en": "en-US-JennyNeural",
    "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "pt": "pt-BR-FranciscaNeural",
    "ja": "ja-JP-NanamiNeural",
}


class GenerateRequest(BaseModel):
    image_path: str  # absolute filesystem path to the source avatar image
    script: str      # text to synthesize
    language: str = "en"


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "sadtalker_dir": str(SADTALKER_DIR),
        "sadtalker_installed": SADTALKER_DIR.exists(),
        "uploads_dir": str(UPLOADS_DIR),
    }


@app.post("/generate")
async def generate(req: GenerateRequest):
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "processing"}
    asyncio.create_task(run_generation(job_id, req))
    return {"job_id": job_id}


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    return JOBS[job_id]


async def run_generation(job_id: str, req: GenerateRequest) -> None:
    try:
        audio_dir = UPLOADS_DIR / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_path = audio_dir / f"{job_id}.wav"
        await run_tts(req.script, req.language, str(audio_path))

        video_dir = UPLOADS_DIR / "videos"
        video_dir.mkdir(parents=True, exist_ok=True)
        video_path = video_dir / f"{job_id}.mp4"
        await run_sadtalker(req.image_path, str(audio_path), str(video_path))

        JOBS[job_id] = {"status": "ready", "video_path": str(video_path)}
    except Exception as exc:
        JOBS[job_id] = {"status": "failed", "error": str(exc)}


async def run_tts(script: str, language: str, output_path: str) -> None:
    """Convert text to speech with edge-tts and save as WAV."""
    voice = LANGUAGE_VOICE.get(language, "en-US-JennyNeural")
    communicate = edge_tts.Communicate(script, voice)
    await communicate.save(output_path)


async def run_sadtalker(
    image_path: str, audio_path: str, output_path: str
) -> None:
    """Run SadTalker inference in a subprocess and move the result to output_path."""
    if not SADTALKER_DIR.exists():
        raise RuntimeError(
            f"SadTalker not found at {SADTALKER_DIR}. Run install.sh first."
        )

    temp_dir = UPLOADS_DIR / "sadtalker_temp" / str(uuid.uuid4())
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        proc = await asyncio.create_subprocess_exec(
            "python",
            "inference.py",
            "--driven_audio", audio_path,
            "--source_image", image_path,
            "--result_dir", str(temp_dir),
            "--still",
            "--preprocess", "crop",
            cwd=str(SADTALKER_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(
                f"SadTalker exited with code {proc.returncode}: {stderr.decode()}"
            )

        mp4_files = list(temp_dir.rglob("*.mp4"))
        if not mp4_files:
            raise RuntimeError("SadTalker produced no .mp4 output file")

        shutil.move(str(mp4_files[0]), output_path)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
```

- [ ] **Step 4: Install dependencies and SadTalker**

```bash
cd artifacts/local-video-service
bash install.sh
```
Expected: SadTalker repo cloned, model checkpoints downloaded to `SadTalker/checkpoints/`

- [ ] **Step 5: Start service and verify health**

```bash
LOCAL_UPLOADS_DIR=$(pwd)/../api-server/uploads uvicorn main:app --host 0.0.0.0 --port 8001
```

In a second terminal:
```bash
curl -s http://localhost:8001/health | python3 -m json.tool
```
Expected:
```json
{
  "status": "ok",
  "sadtalker_installed": true
}
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/local-video-service/
git commit -m "feat: add local video generation Python service (SadTalker + edge-tts)"
```

---

## Task 8: End-to-end smoke test

- [ ] **Step 1: Start both services**

Terminal 1 — Python service:
```bash
cd artifacts/local-video-service
LOCAL_UPLOADS_DIR=$(pwd)/../api-server/uploads uvicorn main:app --host 0.0.0.0 --port 8001
```

Terminal 2 — Express API:
```bash
cd artifacts/api-server
pnpm dev
```

- [ ] **Step 2: Create an avatar**

```bash
# Use any real JPEG encoded as base64, or take a photo via the frontend at http://localhost:5173
curl -s -X POST http://localhost:3000/api/avatars \
  -H "Content-Type: application/json" \
  -d '{"name":"Local Test","imageBase64":"data:image/jpeg;base64,/9j/..."}' \
  | python3 -m json.tool
```
Expected: `"status": "ready"` and `"imageUrl"` starts with `/uploads/images/`

- [ ] **Step 3: Request a video**

```bash
AVATAR_ID="<id from previous step>"

curl -s -X POST http://localhost:3000/api/videos \
  -H "Content-Type: application/json" \
  -d "{\"avatarId\":\"$AVATAR_ID\",\"script\":\"Hello, I am a local AI avatar.\",\"language\":\"en\"}" \
  | python3 -m json.tool
```
Expected: `"status": "processing"` and a UUID in `"didVideoId"` (the local job ID)

- [ ] **Step 4: Poll for completion**

```bash
VIDEO_ID="<id from previous step>"

# Run every 15 seconds until status changes
watch -n 15 "curl -s http://localhost:3000/api/videos/$VIDEO_ID | python3 -m json.tool"
```
Expected after 1–15 minutes (depending on hardware): `"status": "ready"` and `"videoUrl"` points to `/uploads/videos/<uuid>.mp4`

- [ ] **Step 5: Play the video**

Open `http://localhost:3000/uploads/videos/<uuid>.mp4` in a browser. Confirm the avatar's lips are moving in sync with the spoken script.

- [ ] **Step 6: Run all TypeScript tests**

```bash
cd artifacts/api-server
pnpm test
```
Expected: all 8 tests PASS

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: local video generation pipeline complete — no D-ID required"
```
