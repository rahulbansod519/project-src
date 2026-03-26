import { useEffect, useRef, useCallback } from "react";

export interface FaceAlignment {
  detected: boolean;
  centered: boolean;
  score: number;
  message: string;
}

/** Safe rounded rect — works in all browsers (no ctx.roundRect needed) */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

// Lightweight canvas-only face guide — no external SDK, no GPU graph.
// Draws an animated alignment oval directly onto the canvas using rAF.
export function useFaceMesh(
  _videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean
) {
  const animFrameRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  const draw = useCallback(() => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const w = canvas.offsetWidth || 640;
      const h = canvas.offsetHeight || 480;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, w, h);

      phaseRef.current += 0.025;
      const pulse = 0.5 + 0.5 * Math.sin(phaseRef.current);

      const ovalX = w / 2;
      const ovalY = h * 0.46;
      const ovalW = w * 0.27;
      const ovalH = h * 0.41;

      // Outer glow
      const gradient = ctx.createRadialGradient(ovalX, ovalY, ovalW * 0.6, ovalX, ovalY, ovalW * 1.4);
      gradient.addColorStop(0, `rgba(99,102,241,${(0.06 + 0.04 * pulse).toFixed(3)})`);
      gradient.addColorStop(1, "rgba(99,102,241,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(ovalX, ovalY, ovalW * 1.4, ovalH * 1.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Dashed oval ring
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(ovalX, ovalY, ovalW, ovalH, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(99,102,241,${(0.7 + 0.3 * pulse).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([14, 7]);
      ctx.stroke();
      ctx.restore();

      // Corner bracket marks
      const corners = [
        { x: ovalX - ovalW * 0.7, y: ovalY - ovalH * 0.85 },
        { x: ovalX + ovalW * 0.7, y: ovalY - ovalH * 0.85 },
        { x: ovalX - ovalW * 0.7, y: ovalY + ovalH * 0.85 },
        { x: ovalX + ovalW * 0.7, y: ovalY + ovalH * 0.85 },
      ];
      const bLen = 14;
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      corners.forEach((c, i) => {
        const sx = i % 2 === 0 ? 1 : -1;
        const sy = i < 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(c.x + sx * bLen, c.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(c.x, c.y + sy * bLen);
        ctx.stroke();
      });

      // Center dot
      ctx.beginPath();
      ctx.arc(ovalX, ovalY - ovalH * 0.05, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99,102,241,${(0.5 + 0.5 * pulse).toFixed(3)})`;
      ctx.fill();

      // Label pill at bottom — using safe arcTo-based rounded rect
      const label = "Center your face in the oval";
      ctx.font = "bold 13px system-ui, sans-serif";
      const textW = ctx.measureText(label).width;
      const textX = w / 2;
      const textY = h * 0.91;
      const pillX = textX - textW / 2 - 12;
      const pillY = textY - 16;
      ctx.fillStyle = "rgba(99,102,241,0.82)";
      roundedRect(ctx, pillX, pillY, textW + 24, 26, 5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, textX, textY - 3);
    } catch {
      // Silently skip a bad frame — loop continues on next rAF
    }
  }, [canvasRef]);

  useEffect(() => {
    if (!enabled) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    let running = true;

    const loop = () => {
      if (!running) return;
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [enabled, draw, canvasRef]);

  return {
    alignment: {
      detected: false,
      centered: false,
      score: 0,
      message: "Center your face in the oval",
    } satisfies FaceAlignment,
  };
}
