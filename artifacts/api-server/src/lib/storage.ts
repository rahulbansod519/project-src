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
