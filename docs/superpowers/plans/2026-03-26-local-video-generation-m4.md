# Local Video Generation (Apple Silicon M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the D-ID cloud API with a fully local talking-head video pipeline using SadTalker + edge-tts, accelerated via Apple Silicon M4's MPS (Metal Performance Shaders) GPU backend.

**Architecture:** A Python FastAPI microservice (`artifacts/local-video-service/`) wraps SadTalker and edge-tts. The Express backend's `routes/videos.ts` calls this service instead of D-ID. Avatar images are saved to the local filesystem and served as Express static files. The existing DB schema and async polling pattern are preserved — the `didVideoId` column stores the local job ID.

**Tech Stack:** Python 3.12 (Homebrew), PyTorch (MPS backend), SadTalker, edge-tts, FastAPI, Node.js/Express, TypeScript, vitest

---

## System Requirements (M4-specific)

| Requirement | Value |
|-------------|-------|
| Chip | Apple M4 (any variant — base, Pro, Max) |
| macOS | Ventura 13.0+ (Sequoia recommended) |
| Python | 3.12 via Homebrew |
| RAM | 16 GB unified memory (M4 base has 16 GB — fine) |
| Disk free | **15 GB minimum** (see breakdown below) |
| Internet | Required for `edge-tts` TTS calls (free, no API key) |
| Time per video | **~1–2 minutes** on M4 base; ~45 sec on M4 Pro/Max |

### Storage Breakdown

| Item | Size |
|------|------|
| SadTalker model checkpoints | ~3.5 GB |
| PyTorch + torchvision (MPS) | ~3.5 GB |
| SadTalker repo + other Python deps | ~500 MB |
| FastAPI service deps (edge-tts, uvicorn) | ~100 MB |
| Generated videos (grows over time) | ~20–50 MB each |
| **Total minimum** | **~8–9 GB** |

### No CUDA needed
M4 uses Apple's Metal GPU via PyTorch's MPS backend. No NVIDIA drivers, no CUDA, no Rosetta.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `artifacts/local-video-service/requirements.txt` | Python dependencies |
| Create | `artifacts/local-video-service/install.sh` | Install Python deps + clone SadTalker + download models |
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

## Task 1: Verify Python 3.12 is installed via Homebrew

**Files:** none

- [ ] **Step 1: Check if Python 3.12 is installed**

```bash
python3.12 --version
```

If it prints `Python 3.12.x` → skip to Task 2.
If command not found → run:

```bash
brew install python@3.12
```

- [ ] **Step 2: Verify pip works**

```bash
python3.12 -m pip --version
```
Expected: `pip 24.x.x from .../python3.12/...`

- [ ] **Step 3: Verify PyTorch MPS will be available**

```bash
python3.12 -c "import platform; print(platform.machine())"
```
Expected: `arm64`

---

## Task 2: Add vitest to api-server

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
Expected: exits 0, prints "No test files found"

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/package.json artifacts/api-server/vitest.config.ts
git commit -m "chore: add vitest to api-server"
```

---

## Task 3: Local image storage utility

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

// 1×1 white JPEG as base64
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
  it("joins a /uploads URL path onto a server root", () => {
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
 * @returns URL path for DB storage, e.g. "/uploads/images/uuid.jpg"
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

## Task 4: TypeScript client for the local video service

**Files:**
- Create: `artifacts/api-server/src/lib/local-video.ts`
- Create: `artifacts/api-server/src/lib/local-video.test.ts`

- [ ] **Step 1: Write the failing tests**

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

    const result = await localGenerateVideo(
      "/uploads/images/test.jpg",
      "Hello world",
      "en"
    );

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
  it("maps 'ready' to 'done' and extracts basename for videoUrl", async () => {
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

  it("returns processing with no videoUrl", async () => {
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
 * Poll the Python service for a job's status.
 * Maps "ready" → "done" to match status strings used in routes/videos.ts.
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

## Task 5: Serve uploads as static files from Express

**Files:**
- Modify: `artifacts/api-server/src/app.ts`

- [ ] **Step 1: Replace app.ts**

Replace the full contents of `artifacts/api-server/src/app.ts`:
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

## Task 6: Update avatar creation to store images locally

**Files:**
- Modify: `artifacts/api-server/src/routes/avatars.ts`

- [ ] **Step 1: Replace the D-ID import with storage import**

In `artifacts/api-server/src/routes/avatars.ts`, replace:
```typescript
import { didUploadImage } from "../lib/did.js";
```
With:
```typescript
import path from "path";
import { saveBase64Image } from "../lib/storage.js";
```

- [ ] **Step 2: Replace the POST /avatars handler**

Replace the entire `router.post("/avatars", ...)` handler body:
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

## Task 7: Replace D-ID video generation with local service

**Files:**
- Modify: `artifacts/api-server/src/routes/videos.ts`

- [ ] **Step 1: Replace imports**

In `artifacts/api-server/src/routes/videos.ts`, replace:
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

- [ ] **Step 2: Replace pollVideoStatus**

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

  // Lazily migrate avatars whose imageUrl is still a base64 data URI.
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
      didVideoId: localJobId ?? null, // reused to store the local job ID
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

In `router.get("/videos/:id", ...)`, replace both the "no didVideoId" check and the D-ID polling block with:

```typescript
  // No job ID means the video was never submitted to the local service.
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

## Task 8: Create the Python local video service (M4-tuned)

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

> Note: PyTorch is installed separately in `install.sh` to ensure the correct MPS-compatible build is used.

- [ ] **Step 2: Create install.sh**

Create `artifacts/local-video-service/install.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Checking Python 3.12..."
if ! command -v python3.12 &>/dev/null; then
  echo "ERROR: python3.12 not found. Install it with: brew install python@3.12"
  exit 1
fi
PYTHON=python3.12

echo "==> Installing PyTorch with MPS support (Apple Silicon)..."
# The standard pip wheel includes MPS support on Apple Silicon — no extra flags needed.
$PYTHON -m pip install torch torchvision torchaudio

echo "==> Installing Python service dependencies..."
$PYTHON -m pip install -r requirements.txt

echo "==> Cloning SadTalker..."
if [ ! -d "SadTalker" ]; then
  git clone https://github.com/OpenTalker/SadTalker.git
fi

echo "==> Installing SadTalker Python dependencies..."
$PYTHON -m pip install -r SadTalker/requirements.txt

echo "==> Downloading SadTalker model checkpoints (~3.5 GB)..."
cd SadTalker
bash scripts/download_models.sh
cd ..

echo ""
echo "Installation complete. (~8-9 GB used)"
echo ""
echo "Start the service with:"
echo "  cd $SCRIPT_DIR"
echo "  LOCAL_UPLOADS_DIR=\$(pwd)/../api-server/uploads python3.12 -m uvicorn main:app --host 0.0.0.0 --port 8001"
```

Make it executable:
```bash
chmod +x artifacts/local-video-service/install.sh
```

- [ ] **Step 3: Create main.py**

Create `artifacts/local-video-service/main.py`:
```python
"""
Local talking-head video generation service — tuned for Apple Silicon M4.

Replaces D-ID API with:
  - edge-tts  : free TTS via Microsoft Edge (requires internet, no API key)
  - SadTalker : lip-sync from a photo + audio, accelerated via MPS (Metal GPU)

Setup:
  bash install.sh

Start:
  LOCAL_UPLOADS_DIR=/path/to/api-server/uploads python3.12 -m uvicorn main:app --host 0.0.0.0 --port 8001

Environment variables:
  LOCAL_UPLOADS_DIR  Path to api-server/uploads directory (default: ../api-server/uploads)
  SADTALKER_DIR      Path to SadTalker repo (default: ./SadTalker)
"""
import asyncio
import os
import shutil
import uuid
from pathlib import Path

import edge_tts
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Local Video Service (M4)")

SCRIPT_DIR = Path(__file__).parent.resolve()
SADTALKER_DIR = Path(
    os.environ.get("SADTALKER_DIR", str(SCRIPT_DIR / "SadTalker"))
)
UPLOADS_DIR = Path(
    os.environ.get(
        "LOCAL_UPLOADS_DIR",
        str(SCRIPT_DIR.parent / "api-server" / "uploads"),
    )
)

# In-memory job store. Restarting the service clears jobs but video files remain on disk.
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
    script: str      # text to synthesize and speak
    language: str = "en"


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "sadtalker_installed": SADTALKER_DIR.exists(),
        "sadtalker_dir": str(SADTALKER_DIR),
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
    """
    Run SadTalker via subprocess with --device mps for M4 GPU acceleration.

    SadTalker writes output to a temp directory. We locate the resulting .mp4
    and move it to the final output_path so Express can serve it.
    """
    if not SADTALKER_DIR.exists():
        raise RuntimeError(
            f"SadTalker not found at {SADTALKER_DIR}. Run install.sh first."
        )

    temp_dir = UPLOADS_DIR / "sadtalker_temp" / str(uuid.uuid4())
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        proc = await asyncio.create_subprocess_exec(
            "python3.12",
            "inference.py",
            "--driven_audio", audio_path,
            "--source_image", image_path,
            "--result_dir", str(temp_dir),
            "--still",           # reduces jitter; good for portrait-style avatars
            "--preprocess", "crop",
            "--device", "mps",   # M4 GPU via Metal Performance Shaders
            cwd=str(SADTALKER_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(
                f"SadTalker exited {proc.returncode}: {stderr.decode()}"
            )

        mp4_files = list(temp_dir.rglob("*.mp4"))
        if not mp4_files:
            raise RuntimeError("SadTalker produced no .mp4 output file")

        shutil.move(str(mp4_files[0]), output_path)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
```

- [ ] **Step 4: Run install.sh**

```bash
cd artifacts/local-video-service
bash install.sh
```

This will take 10–20 minutes (model download is ~3.5 GB). Watch for:
- `Successfully installed torch` in the output
- `Done` at the end of `download_models.sh`

- [ ] **Step 5: Verify MPS is working**

```bash
python3.12 -c "
import torch
print('PyTorch version:', torch.__version__)
print('MPS available:', torch.backends.mps.is_available())
print('MPS built:', torch.backends.mps.is_built())
"
```
Expected:
```
PyTorch version: 2.x.x
MPS available: True
MPS built: True
```

If `MPS available: False` — update macOS to Ventura 13.0+ and retry.

- [ ] **Step 6: Start the service and check health**

```bash
LOCAL_UPLOADS_DIR=$(pwd)/../api-server/uploads \
  python3.12 -m uvicorn main:app --host 0.0.0.0 --port 8001
```

In a second terminal:
```bash
curl -s http://localhost:8001/health | python3.12 -m json.tool
```
Expected:
```json
{
  "status": "ok",
  "sadtalker_installed": true
}
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/local-video-service/
git commit -m "feat: add local video generation service tuned for Apple M4 (MPS)"
```

---

## Task 9: End-to-end smoke test

- [ ] **Step 1: Start both services**

Terminal 1 — Python service:
```bash
cd artifacts/local-video-service
LOCAL_UPLOADS_DIR=$(pwd)/../api-server/uploads \
  python3.12 -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Terminal 2 — Express API:
```bash
cd artifacts/api-server
pnpm dev
```

- [ ] **Step 2: Open the frontend and create an avatar**

Open `http://localhost:5173` in Safari or Chrome, go to the capture page, take a photo, skip voice. The avatar card should show `status: ready` and the thumbnail image.

Alternatively via curl (replace the base64 with any real JPEG):
```bash
curl -s -X POST http://localhost:3000/api/avatars \
  -H "Content-Type: application/json" \
  -d '{"name":"M4 Test","imageBase64":"data:image/jpeg;base64,/9j/..."}' \
  | python3.12 -m json.tool
```
Expected: `"status": "ready"`, `"imageUrl"` starts with `/uploads/images/`

- [ ] **Step 3: Generate a video**

```bash
AVATAR_ID="<id from step 2>"

curl -s -X POST http://localhost:3000/api/videos \
  -H "Content-Type: application/json" \
  -d "{\"avatarId\":\"$AVATAR_ID\",\"script\":\"Hello, I am running locally on Apple M4.\",\"language\":\"en\"}" \
  | python3.12 -m json.tool
```
Expected: `"status": "processing"`, a UUID in `"didVideoId"` (the local job ID)

- [ ] **Step 4: Poll until ready (~1–2 minutes)**

```bash
VIDEO_ID="<id from step 3>"

watch -n 10 "curl -s http://localhost:3000/api/videos/$VIDEO_ID | python3.12 -m json.tool"
```
Expected after ~1–2 minutes: `"status": "ready"`, `"videoUrl"` starts with `/uploads/videos/`

- [ ] **Step 5: Play the video**

Open `http://localhost:3000/uploads/videos/<filename>.mp4` in a browser. Confirm lips are moving in sync with "Hello, I am running locally on Apple M4."

- [ ] **Step 6: Run all TypeScript unit tests**

```bash
cd artifacts/api-server
pnpm test
```
Expected: 8 tests PASS

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: local video generation complete — fully offline on Apple M4"
```
