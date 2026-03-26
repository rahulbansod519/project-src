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
  error?: string;
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
    error?: string;
  };

  const status =
    data.status === "ready"
      ? "done"
      : (data.status as "processing" | "failed");

  const videoUrl = data.video_path
    ? `/uploads/videos/${path.basename(data.video_path)}`
    : undefined;

  return { status, videoUrl, error: data.error };
}
