import { useState, useRef, useCallback, useEffect } from "react";

export function useCamera() {
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    let cancelled = false;
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      });
      streamRef.current = mediaStream;
      setError(null);

      // Try to attach immediately; if the video element isn't mounted yet
      // (e.g. still animating in), retry each frame until it is.
      const tryAttach = () => {
        if (cancelled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        } else {
          requestAnimationFrame(tryAttach);
        }
      };
      tryAttach();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to access camera";
      setError(message);
    }
    return () => { cancelled = true; };
  }, [stopCamera]);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Mirror to match the -scale-x-100 selfie preview
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  return { videoRef, error, startCamera, stopCamera, captureFrame };
}
