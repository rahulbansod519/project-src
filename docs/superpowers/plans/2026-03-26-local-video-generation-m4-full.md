# Full Local Avatar Pipeline (Apple M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all external APIs (D-ID + ElevenLabs) with a fully local pipeline on Apple M4 — photo capture, voice cloning, and talking-head video generation all run offline with no API keys.

**Architecture:** A Python FastAPI microservice wraps three models: SadTalker (lip-sync face animation), Coqui XTTS v2 (voice cloning TTS), and edge-tts (fallback TTS when no voice sample exists). The Express backend saves avatar images and voice recordings to the local filesystem instead of uploading to D-ID/ElevenLabs. The `elevenlabsVoiceId` DB column is repurposed to store the local voice file path; `didVideoId` stores the local job ID. No DB schema changes required.

**Tech Stack:** Python 3.12 (Homebrew), PyTorch MPS, SadTalker, Coqui XTTS v2, edge-tts, ffmpeg, FastAPI, Node.js/Express, TypeScript, vitest

---

## System Requirements (M4)

| Requirement | Value |
|-------------|-------|
| Chip | Apple M4 (any variant) |
| macOS | Ventura 13.0+ |
| Python | 3.12 via Homebrew |
| RAM | 16 GB unified memory (M4 base is fine) |
| Disk free | **15 GB minimum** |
| Internet | `edge-tts` only — needed if no voice sample recorded |
| Time per video | **~1.5–2 min** (XTTS ~15s + SadTalker ~90s) |

### Storage Breakdown

| Item | Size |
|------|------|
| SadTalker checkpoints | ~3.5 GB |
| PyTorch + torchvision (MPS) | ~3.5 GB |
| Coqui TTS library + XTTS v2 model | ~2.5 GB |
| SadTalker repo + all Python deps | ~600 MB |
| Generated videos + voice samples | ~20–50 MB each |
| **Total minimum** | **~10–11 GB** |

---

## Complete Pipeline (what this plan builds)

```
1. Capture photo    → saved to uploads/images/{uuid}.jpg
2. Record voice     → saved to uploads/voices/{avatarId}.webm
3. Enter script     →
      ↓ ffmpeg converts WebM → WAV
      ↓ Coqui XTTS v2 clones voice → speech.wav
      ↓ SadTalker (MPS) animates face → video.mp4
4. Video served at  → /uploads/videos/{jobId}.mp4
```

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `artifacts/local-video-service/requirements.txt` | Python dependencies |
| Create | `artifacts/local-video-service/install.sh` | One-time setup script |
| Create | `artifacts/local-video-service/main.py` | FastAPI service |
| Create | `artifacts/api-server/vitest.config.ts` | vitest config |
| Create | `artifacts/api-server/src/lib/storage.ts` | Save images + audio to filesystem |
| Create | `artifacts/api-server/src/lib/storage.test.ts` | Tests for storage.ts |
| Create | `artifacts/api-server/src/lib/local-video.ts` | TypeScript HTTP client for Python service |
| Create | `artifacts/api-server/src/lib/local-video.test.ts` | Tests for local-video.ts |
| Modify | `artifacts/api-server/package.json` | Add vitest + test scripts |
| Modify | `artifacts/api-server/src/app.ts` | Serve `uploads/` as static files |
| Modify | `artifacts/api-server/src/routes/avatars.ts` | Save image + voice locally |
| Modify | `artifacts/api-server/src/routes/videos.ts` | Use local service, pass voice path |

---

## Task 1: Verify prerequisites

**Files:** none

- [ ] **Step 1: Check Python 3.12**

```bash
python3.12 --version
```

If not found:
```bash
brew install python@3.12
```
Expected: `Python 3.12.x`

- [ ] **Step 2: Check ffmpeg**

```bash
ffmpeg -version
```

If not found:
```bash
brew install ffmpeg
```
Expected: `ffmpeg version 7.x ...`

- [ ] **Step 3: Verify MPS support**

```bash
python3.12 -c "
import torch
print('PyTorch:', torch.__version__)
print('MPS available:', torch.backends.mps.is_available())
"
```

If PyTorch is not installed yet, skip — it will be installed in Task 9. If it is installed:
Expected:
```
MPS available: True
```

If `False` — update macOS to Ventura 13+ and retry.

---

## Task 2: Add vitest to api-server

**Files:**
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/vitest.config.ts`

- [ ] **Step 1: Install vitest**

From `artifacts/api-server/`:
```bash
pnpm add -D vitest
```

- [ ] **Step 2: Create vitest.config.ts**

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

- [ ] **Step 3: Add test scripts**

In `artifacts/api-server/package.json` add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Confirm vitest runs**

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

## Task 3: Local filesystem storage utility

**Files:**
- Create: `artifacts/api-server/src/lib/storage.ts`
- Create: `artifacts/api-server/src/lib/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/storage.test.ts`:
```typescript
import { describe, it, expect, afterEach } from "vitest";
import { saveBase64Image, saveBase64Audio, urlPathToAbsPath } from "./storage.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

// 1×1 white JPEG as base64
const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDB" +
  "kSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEB" +
  "AxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAA" +
  "AAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ACWAB//Z";

// Minimal valid WebM header bytes as base64
const TINY_WEBM = "data:audio/webm;base64,GkXfo0AgQoaBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

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

  it("creates the directory if it does not exist", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));
    const subDir = path.join(tmpDir, "deep", "nested");

    const urlPath = await saveBase64Image(TINY_JPEG, subDir);

    expect(urlPath).toMatch(/^\/uploads\/images\/.+\.jpg$/);
  });
});

describe("saveBase64Audio", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves a WebM data URI to disk with the given filename and returns a /uploads/voices URL path", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));

    const urlPath = await saveBase64Audio(TINY_WEBM, tmpDir, "avatar-abc.webm");

    expect(urlPath).toBe("/uploads/voices/avatar-abc.webm");
    const bytes = await fs.readFile(path.join(tmpDir, "avatar-abc.webm"));
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe("urlPathToAbsPath", () => {
  it("joins a /uploads URL path onto a server root", () => {
    const result = urlPathToAbsPath("/uploads/images/abc.jpg", "/app");
    expect(result).toBe("/app/uploads/images/abc.jpg");
  });
});
```

- [ ] **Step 2: Run — confirm fail**

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
 * Saves a base64 image data URI to disk.
 * @param imageBase64 - e.g. "data:image/jpeg;base64,..."
 * @param uploadsDir  - absolute path to destination directory
 * @returns URL path for DB, e.g. "/uploads/images/uuid.jpg"
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
 * Saves a base64 audio data URI to disk with a specific filename.
 * @param audioBase64 - e.g. "data:audio/webm;base64,..."
 * @param uploadsDir  - absolute path to destination directory
 * @param filename    - exact filename to use, e.g. "avatar-uuid.webm"
 * @returns URL path for DB, e.g. "/uploads/voices/avatar-uuid.webm"
 */
export async function saveBase64Audio(
  audioBase64: string,
  uploadsDir: string,
  filename: string
): Promise<string> {
  const base64Data = audioBase64.replace(/^data:audio\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, filename), buffer);
  return `/uploads/voices/${filename}`;
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

- [ ] **Step 4: Run — confirm pass**

```bash
pnpm test
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/storage.ts artifacts/api-server/src/lib/storage.test.ts
git commit -m "feat: add local filesystem storage for images and audio"
```

---

## Task 4: TypeScript client for the Python video service

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
  it("POSTs image path, script, language and returns jobId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job_id: "abc-123" }),
    });

    const result = await localGenerateVideo(
      "/uploads/images/face.jpg",
      "Hello world",
      "en"
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8001/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          image_path: "/uploads/images/face.jpg",
          script: "Hello world",
          language: "en",
          voice_sample_path: null,
        }),
      })
    );
    expect(result.jobId).toBe("abc-123");
    expect(result.status).toBe("processing");
  });

  it("includes voice_sample_path when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job_id: "xyz-789" }),
    });

    await localGenerateVideo(
      "/uploads/images/face.jpg",
      "Hello",
      "en",
      "/uploads/voices/avatar-123.webm"
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.voice_sample_path).toBe("/uploads/voices/avatar-123.webm");
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
  it("maps 'ready' to 'done' and extracts video filename for URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ready",
        video_path: "/deep/path/uploads/videos/abc-123.mp4",
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

- [ ] **Step 2: Run — confirm fail**

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
 * @param imagePath       - absolute filesystem path to avatar image
 * @param script          - text to synthesize and speak
 * @param language        - BCP-47 language code, e.g. "en", "es"
 * @param voiceSamplePath - absolute filesystem path to a .webm voice recording.
 *                          If provided, Coqui XTTS v2 clones the voice.
 *                          If null, falls back to generic edge-tts voice.
 */
export async function localGenerateVideo(
  imagePath: string,
  script: string,
  language: string = "en",
  voiceSamplePath: string | null = null
): Promise<LocalVideoResult> {
  const res = await fetch(`${LOCAL_VIDEO_SERVICE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_path: imagePath,
      script,
      language,
      voice_sample_path: voiceSamplePath,
    }),
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
 * Maps "ready" → "done" to match status strings in routes/videos.ts.
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

- [ ] **Step 4: Run — confirm pass**

```bash
pnpm test
```
Expected: 6 tests PASS

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
git commit -m "feat: serve uploads/ as static files"
```

---

## Task 6: Update avatar creation — save image locally

**Files:**
- Modify: `artifacts/api-server/src/routes/avatars.ts`

- [ ] **Step 1: Replace the D-ID import**

In `artifacts/api-server/src/routes/avatars.ts`, replace:
```typescript
import { didUploadImage } from "../lib/did.js";
```
With:
```typescript
import path from "path";
import { saveBase64Image, saveBase64Audio, urlPathToAbsPath } from "../lib/storage.js";
```

- [ ] **Step 2: Replace the POST /avatars handler**

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
git commit -m "feat: save avatar photo to local filesystem"
```

---

## Task 7: Update voice upload — save recording locally instead of ElevenLabs

**Files:**
- Modify: `artifacts/api-server/src/routes/avatars.ts`

The `POST /avatars/:id/voice` handler currently calls ElevenLabs to clone the voice. Replace it with saving the raw WebM recording to disk. The local video service will use it directly via Coqui XTTS v2.

The `elevenlabsVoiceId` column is repurposed to store the local voice file URL path (e.g. `/uploads/voices/avatar-uuid.webm`). No DB schema change needed.

- [ ] **Step 1: Replace the POST /avatars/:id/voice handler**

Replace the entire `router.post("/avatars/:id/voice", ...)` handler in `artifacts/api-server/src/routes/avatars.ts`:
```typescript
router.post("/avatars/:id/voice", async (req, res): Promise<void> => {
  const params = UploadVoiceSampleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UploadVoiceSampleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [avatar] = await db
    .select()
    .from(avatarsTable)
    .where(eq(avatarsTable.id, params.data.id));

  if (!avatar) {
    res.status(404).json({ error: "Avatar not found" });
    return;
  }

  // Save the raw WebM recording to disk.
  // elevenlabsVoiceId is repurposed to store the local voice file URL path.
  const voicesDir = path.join(process.cwd(), "uploads", "voices");
  const voiceFilename = `${avatar.id}.webm`;
  const voiceUrlPath = await saveBase64Audio(
    body.data.audioBase64,
    voicesDir,
    voiceFilename
  );
  req.log.info({ voiceUrlPath }, "Voice sample saved locally");

  const [updated] = await db
    .update(avatarsTable)
    .set({
      elevenlabsVoiceId: voiceUrlPath, // stores "/uploads/voices/{id}.webm"
      hasVoice: true,
      voiceStatus: "ready",
      updatedAt: new Date(),
    })
    .where(eq(avatarsTable.id, params.data.id))
    .returning();

  res.json(UploadVoiceSampleResponse.parse(updated));
});
```

Also remove the now-unused ElevenLabs import at the top of avatars.ts:
```typescript
// Remove this line:
import { elevenlabsCloneVoice } from "../lib/elevenlabs.js";
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/avatars.ts
git commit -m "feat: save voice recording locally instead of cloning via ElevenLabs"
```

---

## Task 8: Update video generation — pass voice sample to local service

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

  // Lazily migrate any avatar whose imageUrl is still a raw base64 data URI.
  let imageUrlPath = avatar.imageUrl;
  if (avatar.imageUrl.startsWith("data:")) {
    req.log.info({ avatarId: avatar.id }, "Migrating base64 image to local storage");
    const uploadsDir = path.join(process.cwd(), "uploads", "images");
    imageUrlPath = await saveBase64Image(avatar.imageUrl, uploadsDir);
    await db
      .update(avatarsTable)
      .set({ imageUrl: imageUrlPath, updatedAt: new Date() })
      .where(eq(avatarsTable.id, avatar.id));
  }

  const absoluteImagePath = urlPathToAbsPath(imageUrlPath, process.cwd());

  // If the avatar has a local voice recording, pass its absolute path to the
  // Python service so Coqui XTTS v2 can clone the voice.
  // elevenlabsVoiceId stores "/uploads/voices/{id}.webm" for locally saved voices.
  let voiceSamplePath: string | null = null;
  if (avatar.elevenlabsVoiceId?.startsWith("/uploads/voices/")) {
    voiceSamplePath = urlPathToAbsPath(avatar.elevenlabsVoiceId, process.cwd());
  }

  let localJobId: string | undefined;
  let status: "pending" | "processing" | "ready" | "failed" = "pending";
  let errorMessage: string | undefined;

  try {
    const result = await localGenerateVideo(
      absoluteImagePath,
      script,
      language ?? "en",
      voiceSamplePath
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

In `router.get("/videos/:id", ...)`, replace the two blocks that check `video.didVideoId` and poll D-ID:
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
git commit -m "feat: pass local voice sample to video service for XTTS voice cloning"
```

---

## Task 9: Create the Python local video service

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
TTS==0.22.0
```

> `TTS` is the Coqui TTS package. PyTorch and SadTalker are installed separately in `install.sh`.

- [ ] **Step 2: Create install.sh**

Create `artifacts/local-video-service/install.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Checking prerequisites..."
if ! command -v python3.12 &>/dev/null; then
  echo "ERROR: python3.12 not found. Run: brew install python@3.12"
  exit 1
fi
if ! command -v ffmpeg &>/dev/null; then
  echo "ERROR: ffmpeg not found. Run: brew install ffmpeg"
  exit 1
fi

PYTHON=python3.12

echo "==> Installing PyTorch with MPS support (Apple Silicon)..."
$PYTHON -m pip install torch torchvision torchaudio

echo "==> Installing Python service dependencies..."
$PYTHON -m pip install -r requirements.txt

echo "==> Cloning SadTalker..."
if [ ! -d "SadTalker" ]; then
  git clone https://github.com/OpenTalker/SadTalker.git
fi

echo "==> Installing SadTalker dependencies..."
$PYTHON -m pip install -r SadTalker/requirements.txt

echo "==> Downloading SadTalker model checkpoints (~3.5 GB)..."
cd SadTalker
bash scripts/download_models.sh
cd ..

echo ""
echo "NOTE: Coqui XTTS v2 model (~2.5 GB) will be downloaded automatically"
echo "on the first video generation request."
echo ""
echo "Installation complete (~8.5 GB used so far)."
echo ""
echo "Start the service with:"
echo "  cd $SCRIPT_DIR"
echo "  LOCAL_UPLOADS_DIR=\$(pwd)/../api-server/uploads python3.12 -m uvicorn main:app --host 0.0.0.0 --port 8001"
```

Make executable:
```bash
chmod +x artifacts/local-video-service/install.sh
```

- [ ] **Step 3: Create main.py**

Create `artifacts/local-video-service/main.py`:
```python
"""
Local talking-head video generation service — Apple M4 / MPS edition.

Pipeline:
  1. edge-tts (fallback)  : text → speech, free Microsoft TTS, needs internet
  2. Coqui XTTS v2        : text → speech cloned from a voice sample, fully offline
  3. SadTalker            : image + audio → lip-synced talking-head video

Setup  : bash install.sh
Start  : LOCAL_UPLOADS_DIR=/path/to/api-server/uploads
         python3.12 -m uvicorn main:app --host 0.0.0.0 --port 8001

Environment variables:
  LOCAL_UPLOADS_DIR   Path to api-server's uploads directory
  SADTALKER_DIR       Path to SadTalker repo (default: ./SadTalker)
"""
import asyncio
import os
import shutil
import subprocess
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import edge_tts
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
SADTALKER_DIR = Path(os.environ.get("SADTALKER_DIR", str(SCRIPT_DIR / "SadTalker")))
UPLOADS_DIR = Path(
    os.environ.get("LOCAL_UPLOADS_DIR", str(SCRIPT_DIR.parent / "api-server" / "uploads"))
)
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# ── voice map (matches did.ts LANGUAGE_MICROSOFT_VOICE) ───────────────────────
LANGUAGE_VOICE: dict[str, str] = {
    "en": "en-US-JennyNeural",
    "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "pt": "pt-BR-FranciscaNeural",
    "ja": "ja-JP-NanamiNeural",
}

# ── global TTS model (loaded once at startup) ──────────────────────────────────
xtts_model = None


def _load_xtts():
    """Load Coqui XTTS v2 model. Downloads ~2.5 GB on first call."""
    from TTS.api import TTS  # imported here so startup doesn't fail if TTS is missing
    print(f"Loading Coqui XTTS v2 model on device: {DEVICE} ...")
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)
    print("XTTS v2 model loaded.")
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    global xtts_model
    loop = asyncio.get_event_loop()
    xtts_model = await loop.run_in_executor(None, _load_xtts)
    yield


app = FastAPI(title="Local Video Service (M4)", lifespan=lifespan)

# ── in-memory job store ────────────────────────────────────────────────────────
JOBS: dict[str, dict] = {}


# ── API models ─────────────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    image_path: str                    # absolute filesystem path to avatar image
    script: str                        # text to speak
    language: str = "en"
    voice_sample_path: Optional[str] = None  # absolute path to .webm voice recording


# ── endpoints ──────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "sadtalker_installed": SADTALKER_DIR.exists(),
        "xtts_loaded": xtts_model is not None,
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


# ── generation pipeline ────────────────────────────────────────────────────────
async def run_generation(job_id: str, req: GenerateRequest) -> None:
    try:
        audio_dir = UPLOADS_DIR / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_path = audio_dir / f"{job_id}.wav"

        if req.voice_sample_path and xtts_model is not None:
            # Convert the WebM voice recording to WAV, then clone the voice with XTTS.
            wav_sample_path = audio_dir / f"{job_id}_sample.wav"
            await convert_webm_to_wav(req.voice_sample_path, str(wav_sample_path))
            await run_xtts(req.script, req.language, str(wav_sample_path), str(audio_path))
        else:
            # No voice sample — fall back to generic edge-tts voice.
            await run_edge_tts(req.script, req.language, str(audio_path))

        video_dir = UPLOADS_DIR / "videos"
        video_dir.mkdir(parents=True, exist_ok=True)
        video_path = video_dir / f"{job_id}.mp4"

        await run_sadtalker(req.image_path, str(audio_path), str(video_path))

        JOBS[job_id] = {"status": "ready", "video_path": str(video_path)}
    except Exception as exc:
        JOBS[job_id] = {"status": "failed", "error": str(exc)}


async def convert_webm_to_wav(webm_path: str, wav_path: str) -> None:
    """Convert a WebM/Opus audio file to 22050 Hz mono WAV using ffmpeg."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i", webm_path,
        "-ar", "22050",   # XTTS works best at 22050 Hz
        "-ac", "1",       # mono
        "-y",             # overwrite output if exists
        wav_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed: {stderr.decode()}")


async def run_edge_tts(script: str, language: str, output_path: str) -> None:
    """Fallback TTS using Microsoft Edge (requires internet, no API key)."""
    voice = LANGUAGE_VOICE.get(language, "en-US-JennyNeural")
    communicate = edge_tts.Communicate(script, voice)
    await communicate.save(output_path)


async def run_xtts(
    script: str, language: str, speaker_wav: str, output_path: str
) -> None:
    """Clone voice from speaker_wav and synthesize script using Coqui XTTS v2."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: xtts_model.tts_to_file(
            text=script,
            speaker_wav=speaker_wav,
            language=language,
            file_path=output_path,
        ),
    )


async def run_sadtalker(
    image_path: str, audio_path: str, output_path: str
) -> None:
    """
    Run SadTalker with --device mps for M4 GPU acceleration.
    SadTalker writes to a temp dir; we find the .mp4 and move it to output_path.
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
            "--still",
            "--preprocess", "crop",
            "--device", "mps",
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

Takes 15–25 minutes (SadTalker models ~3.5 GB). Watch for:
- `Successfully installed torch` in output
- `Done` printed at end of `download_models.sh`

- [ ] **Step 5: Start the service**

```bash
LOCAL_UPLOADS_DIR=$(pwd)/../api-server/uploads \
  python3.12 -m uvicorn main:app --host 0.0.0.0 --port 8001
```

The terminal will show "Loading Coqui XTTS v2 model..." — wait until it prints "XTTS v2 model loaded." (~15–20 seconds, and ~2.5 GB is downloaded on first run).

- [ ] **Step 6: Verify health endpoint**

```bash
curl -s http://localhost:8001/health | python3.12 -m json.tool
```
Expected:
```json
{
  "status": "ok",
  "device": "mps",
  "sadtalker_installed": true,
  "xtts_loaded": true
}
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/local-video-service/
git commit -m "feat: add local video service with SadTalker + Coqui XTTS v2 for M4"
```

---

## Task 10: End-to-end smoke test — full pipeline

- [ ] **Step 1: Start both services**

Terminal 1 — Python service (keep it running):
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

- [ ] **Step 2: Use the frontend to create a full avatar**

Open `http://localhost:5173` in a browser.

1. Go to the Capture page
2. Select a pose
3. Take a photo with your webcam
4. Record your voice saying the prompt ("Hi, I am creating my digital clone...")
5. Enter your name and submit

Check the avatar card shows `status: ready` and `hasVoice: true`.

- [ ] **Step 3: Confirm files were saved**

```bash
ls artifacts/api-server/uploads/images/   # should contain one .jpg
ls artifacts/api-server/uploads/voices/   # should contain one .webm
```
Expected: one file in each directory

- [ ] **Step 4: Generate a video**

```bash
# Get the avatar ID from the frontend, or:
AVATAR_ID=$(curl -s http://localhost:3000/api/avatars | python3.12 -c "
import sys, json
avatars = json.load(sys.stdin)
print(avatars[-1]['id'])
")

curl -s -X POST http://localhost:3000/api/videos \
  -H "Content-Type: application/json" \
  -d "{\"avatarId\":\"$AVATAR_ID\",\"script\":\"Hello! I am a fully local AI avatar running on Apple M4. No cloud APIs needed.\",\"language\":\"en\"}" \
  | python3.12 -m json.tool
```
Expected: `"status": "processing"`, a UUID in `"didVideoId"`

In the Python service terminal you should see: "Loading..." logs from SadTalker and XTTS.

- [ ] **Step 5: Poll until ready**

```bash
VIDEO_ID="<id from step 4>"

watch -n 10 "curl -s http://localhost:3000/api/videos/$VIDEO_ID | python3.12 -m json.tool"
```
Expected after ~1.5–2 minutes:
```json
{
  "status": "ready",
  "videoUrl": "/uploads/videos/<uuid>.mp4"
}
```

- [ ] **Step 6: Watch the video**

Open `http://localhost:3000/uploads/videos/<uuid>.mp4` in Safari or Chrome.

Confirm:
- The face in the video is **your face** from the webcam capture
- The voice is **your voice** cloned from the recording
- The lips move in sync with the spoken script

- [ ] **Step 7: Run all unit tests**

```bash
cd artifacts/api-server
pnpm test
```
Expected: 10 tests PASS

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: full local avatar pipeline complete — your face, your voice, zero cloud APIs"
```
