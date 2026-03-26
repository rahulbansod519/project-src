import { pgTable, text, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videosTable = pgTable("videos", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  avatarId: text("avatar_id").notNull(),
  script: text("script").notNull(),
  status: text("status", { enum: ["pending", "processing", "ready", "failed"] }).notNull().default("pending"),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  duration: real("duration"),
  language: text("language").notNull().default("en"),
  emotion: text("emotion", { enum: ["neutral", "happy", "sad", "excited", "calm", "confident", "serious"] }).notNull().default("neutral"),
  backgroundUrl: text("background_url"),
  backgroundColorHex: text("background_color_hex"),
  stitch: boolean("stitch").notNull().default(false),
  didVideoId: text("did_video_id"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
