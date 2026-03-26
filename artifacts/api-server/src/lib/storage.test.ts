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
