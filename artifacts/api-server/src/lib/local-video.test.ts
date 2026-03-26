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
