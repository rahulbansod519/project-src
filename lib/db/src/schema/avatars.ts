import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const avatarsTable = pgTable("avatars", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  didAvatarId: text("did_avatar_id"),
  elevenlabsVoiceId: text("elevenlabs_voice_id"),
  hasVoice: boolean("has_voice").notNull().default(false),
  voiceStatus: text("voice_status", { enum: ["pending", "ready", "failed"] }),
  status: text("status", { enum: ["creating", "ready", "failed"] }).notNull().default("creating"),
  pose: text("pose", { enum: ["bust", "half-body", "sitting", "standing"] }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAvatarSchema = createInsertSchema(avatarsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAvatar = z.infer<typeof insertAvatarSchema>;
export type Avatar = typeof avatarsTable.$inferSelect;
