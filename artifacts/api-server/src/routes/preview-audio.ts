import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, avatarsTable } from "@workspace/db";
import { urlPathToAbsPath } from "../lib/storage.js";

const router: IRouter = Router();

const LOCAL_VIDEO_SERVICE_URL =
  process.env.LOCAL_VIDEO_SERVICE_URL ?? "http://localhost:8001";

router.post("/preview-audio", async (req, res): Promise<void> => {
  const { avatarId, script, language = "en" } = req.body as {
    avatarId?: string;
    script?: string;
    language?: string;
  };

  if (!script?.trim()) {
    res.status(400).json({ error: "script is required" });
    return;
  }

  if (!avatarId) {
    res.status(400).json({ error: "avatarId is required for voice preview" });
    return;
  }

  const [avatar] = await db
    .select()
    .from(avatarsTable)
    .where(eq(avatarsTable.id, avatarId));

  if (!avatar) {
    res.status(404).json({ error: "Avatar not found" });
    return;
  }

  if (!avatar.elevenlabsVoiceId?.startsWith("/uploads/voices/")) {
    res.status(400).json({ error: "This avatar has no voice sample recorded. Go to Capture Studio and record a voice first." });
    return;
  }

  const voiceSamplePath = urlPathToAbsPath(avatar.elevenlabsVoiceId, process.cwd());

  const response = await fetch(`${LOCAL_VIDEO_SERVICE_URL}/preview-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, language, voice_sample_path: voiceSamplePath ?? null }),
  });

  if (!response.ok) {
    const err = await response.text();
    res.status(502).json({ error: `Audio service error: ${err}` });
    return;
  }

  const data = (await response.json()) as { audio_url: string };
  res.json({ audioUrl: data.audio_url });
});

export default router;
