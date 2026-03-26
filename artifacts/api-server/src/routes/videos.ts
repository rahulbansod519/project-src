import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, avatarsTable, videosTable } from "@workspace/db";
import {
  GenerateVideoBody,
  GetVideoParams,
  DeleteVideoParams,
  ListAvatarVideosParams,
  ListVideosResponse,
  ListAvatarVideosResponse,
  GetVideoResponse,
} from "@workspace/api-zod";
import path from "path";
import { localGenerateVideo, localGetVideoStatus } from "../lib/local-video.js";
import { saveBase64Image, urlPathToAbsPath } from "../lib/storage.js";

const router: IRouter = Router();

async function pollVideoStatus(
  videoId: string,
  localJobId: string
): Promise<void> {
  let attempts = 0;
  const maxAttempts = 120;

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
            errorMessage: result.error ?? "Local video generation failed",
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

router.get("/videos", async (_req, res): Promise<void> => {
  const videos = await db
    .select()
    .from(videosTable)
    .orderBy(videosTable.createdAt);
  res.json(ListVideosResponse.parse(videos));
});

router.get("/avatars/:id/videos", async (req, res): Promise<void> => {
  const params = ListAvatarVideosParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const videos = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.avatarId, params.data.id))
    .orderBy(videosTable.createdAt);

  res.json(ListAvatarVideosResponse.parse(videos));
});

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

  // If the avatar has a local voice recording, pass its absolute path so
  // Coqui XTTS v2 can clone the voice. elevenlabsVoiceId stores
  // "/uploads/voices/{id}.webm" for locally saved voices.
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
      didVideoId: localJobId ?? null,
      status,
      errorMessage: errorMessage ?? null,
    })
    .returning();

  if (localJobId) {
    pollVideoStatus(video.id, localJobId);
  }

  res.status(202).json(GetVideoResponse.parse(video));
});

router.get("/videos/:id", async (req, res): Promise<void> => {
  const params = GetVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [video] = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.id, params.data.id));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // No job ID means video was never submitted to the local service.
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

  res.json(GetVideoResponse.parse(video));
});

router.delete("/videos/:id", async (req, res): Promise<void> => {
  const params = DeleteVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [video] = await db
    .delete(videosTable)
    .where(eq(videosTable.id, params.data.id))
    .returning();

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
