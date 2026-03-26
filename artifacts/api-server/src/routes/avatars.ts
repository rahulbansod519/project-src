import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import path from "path";
import { db, avatarsTable } from "@workspace/db";
import {
  CreateAvatarBody,
  GetAvatarParams,
  DeleteAvatarParams,
  UploadVoiceSampleParams,
  UploadVoiceSampleBody,
  ListAvatarsResponse,
  GetAvatarResponse,
  UploadVoiceSampleResponse,
} from "@workspace/api-zod";
import { saveBase64Image, saveBase64Audio } from "../lib/storage.js";

const router: IRouter = Router();

router.get("/avatars", async (req, res): Promise<void> => {
  const avatars = await db.select().from(avatarsTable).orderBy(avatarsTable.createdAt);
  res.json(ListAvatarsResponse.parse(avatars));
});

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

router.get("/avatars/:id", async (req, res): Promise<void> => {
  const params = GetAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  res.json(GetAvatarResponse.parse(avatar));
});

router.delete("/avatars/:id", async (req, res): Promise<void> => {
  const params = DeleteAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [avatar] = await db
    .delete(avatarsTable)
    .where(eq(avatarsTable.id, params.data.id))
    .returning();

  if (!avatar) {
    res.status(404).json({ error: "Avatar not found" });
    return;
  }

  res.sendStatus(204);
});

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

export default router;
