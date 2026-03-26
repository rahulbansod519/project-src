"""
Local talking-head video generation service — Apple M4 / MPS edition.

Pipeline:
  1. edge-tts (fallback)  : text → speech, free Microsoft TTS, needs internet
  2. Coqui XTTS v2        : text → speech cloned from a voice sample, fully offline
  3. SadTalker            : image + audio → lip-synced talking-head video

Optimizations vs naive subprocess approach:
  - SadTalker models loaded ONCE at startup (eliminates ~1-2 min cold start per video)
  - 3DMM coefficients cached per source image (same avatar = free preprocessing)
  - batch_size=10 for face rendering (5x default throughput)

Setup  : bash install.sh
Start  : LOCAL_UPLOADS_DIR=/path/to/api-server/uploads bash start-service.sh
DEV    : DEV_MODE=true bash start-service.sh  (instant stub videos, no model load)

Environment variables:
  LOCAL_UPLOADS_DIR   Path to api-server's uploads directory
  SADTALKER_DIR       Path to SadTalker repo (default: ./SadTalker)
  XDG_DATA_HOME       Where Coqui stores model weights (default: ~/.local/share)
  DEV_MODE            Set to true for instant stub videos (no SadTalker/XTTS)
"""
import asyncio
import hashlib
import os
import shutil
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import edge_tts
import torch

# ── PyTorch 2.6+ compat: TTS 0.22.0 checkpoints need weights_only=False ──────
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    if "weights_only" not in kwargs:
        kwargs["weights_only"] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
SADTALKER_DIR = Path(os.environ.get("SADTALKER_DIR", str(SCRIPT_DIR / "SadTalker")))
UPLOADS_DIR = Path(
    os.environ.get("LOCAL_UPLOADS_DIR", str(SCRIPT_DIR.parent / "api-server" / "uploads"))
)
DEVICE = "cpu"  # MPS hangs on face rendering; CPU is reliable

# ── voice map ──────────────────────────────────────────────────────────────────
LANGUAGE_VOICE: dict[str, str] = {
    "en": "en-US-JennyNeural",
    "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "pt": "pt-BR-FranciscaNeural",
    "ja": "ja-JP-NanamiNeural",
}

# ── dev mode ───────────────────────────────────────────────────────────────────
DEV_MODE = os.environ.get("DEV_MODE", "").lower() in ("1", "true", "yes")

# ── global models (loaded once at startup) ─────────────────────────────────────
xtts_model = None
chatterbox_model = None
sadtalker_models: dict = {}          # keys: preprocess_model, audio_to_coeff, animate_from_coeff, paths
coeff_cache: dict[str, tuple] = {}   # image_hash → (first_coeff_path, crop_pic_path, crop_info)
coeff_cache_dir = UPLOADS_DIR / "coeff_cache"


def _image_hash(image_path: str) -> str:
    """Stable hash of image file contents for cache key."""
    h = hashlib.sha256()
    with open(image_path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()[:16]


def _load_chatterbox():
    try:
        from chatterbox.tts import ChatterboxTTS
        print(f"Loading Chatterbox TTS on {DEVICE} ...")
        model = ChatterboxTTS.from_pretrained(device=DEVICE)
        print("Chatterbox TTS loaded.")
        return model
    except ImportError:
        print("Chatterbox not installed — falling back to XTTS v2.")
        return None
    except Exception as e:
        print(f"Chatterbox load failed ({e}) — falling back to XTTS v2.")
        return None


def _load_xtts():
    from TTS.api import TTS
    print(f"Loading Coqui XTTS v2 on {DEVICE} ...")
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)
    print("XTTS v2 loaded.")
    return model


def _load_sadtalker():
    """Import SadTalker modules and load all models into memory once."""
    if not SADTALKER_DIR.exists():
        print(f"[SadTalker] WARNING: {SADTALKER_DIR} not found — video generation will fail.")
        return {}

    # Add SadTalker to path so its imports work
    sadtalker_str = str(SADTALKER_DIR)
    if sadtalker_str not in sys.path:
        sys.path.insert(0, sadtalker_str)

    print(f"[SadTalker] Loading models on {DEVICE} ...")
    from src.utils.preprocess import CropAndExtract
    from src.test_audio2coeff import Audio2Coeff
    from src.facerender.animate import AnimateFromCoeff
    from src.utils.init_path import init_path

    checkpoint_dir = str(SADTALKER_DIR / "checkpoints")
    config_dir = str(SADTALKER_DIR / "src" / "config")
    sadtalker_paths = init_path(checkpoint_dir, config_dir, 256, False, "crop")

    preprocess_model = CropAndExtract(sadtalker_paths, DEVICE)
    audio_to_coeff = Audio2Coeff(sadtalker_paths, DEVICE)
    animate_from_coeff = AnimateFromCoeff(sadtalker_paths, DEVICE)

    print("[SadTalker] All models loaded and warm.")
    return {
        "preprocess_model": preprocess_model,
        "audio_to_coeff": audio_to_coeff,
        "animate_from_coeff": animate_from_coeff,
        "paths": sadtalker_paths,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global xtts_model, chatterbox_model, sadtalker_models
    coeff_cache_dir.mkdir(parents=True, exist_ok=True)

    if DEV_MODE:
        print("DEV_MODE=true — skipping all model loads. Videos will be instant stubs.")
        yield
        return

    loop = asyncio.get_event_loop()
    chatterbox_model = await loop.run_in_executor(None, _load_chatterbox)
    if chatterbox_model is None:
        xtts_model = await loop.run_in_executor(None, _load_xtts)
    sadtalker_models = await loop.run_in_executor(None, _load_sadtalker)
    yield


app = FastAPI(title="Local Video Service (M4)", lifespan=lifespan)

# ── in-memory job store ────────────────────────────────────────────────────────
JOBS: dict[str, dict] = {}


# ── API models ─────────────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    image_path: str
    script: str
    language: str = "en"
    voice_sample_path: Optional[str] = None


# ── endpoints ──────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "dev_mode": DEV_MODE,
        "sadtalker_loaded": bool(sadtalker_models),
        "xtts_loaded": xtts_model is not None,
        "coeff_cache_size": len(coeff_cache),
        "uploads_dir": str(UPLOADS_DIR),
    }


class PreviewAudioRequest(BaseModel):
    script: str
    language: str = "en"
    voice_sample_path: Optional[str] = None


@app.post("/preview-audio")
async def preview_audio(req: PreviewAudioRequest):
    """Generate TTS audio only — fast, no SadTalker involved."""
    job_id = str(uuid.uuid4())
    audio_dir = UPLOADS_DIR / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / f"{job_id}.wav"

    try:
        if req.voice_sample_path and (chatterbox_model is not None or xtts_model is not None):
            wav_sample_path = audio_dir / f"{job_id}_sample.wav"
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-i", req.voice_sample_path, "-ar", "22050", "-ac", "1", "-y", str(wav_sample_path),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()
            await run_tts_with_voice_clone(req.script, req.language, str(wav_sample_path), str(audio_path))
        else:
            voice = LANGUAGE_VOICE.get(req.language, "en-US-JennyNeural")
            mp3_path = audio_dir / f"{job_id}_tts.mp3"
            communicate = edge_tts.Communicate(req.script, voice)
            await communicate.save(str(mp3_path))
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-i", str(mp3_path), "-ar", "22050", "-ac", "1", "-y", str(audio_path),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

        return {"audio_path": str(audio_path), "audio_url": f"/uploads/audio/{job_id}.wav"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/generate")
async def generate(req: GenerateRequest):
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "processing"}
    asyncio.create_task(run_generation(job_id, req))
    return {"job_id": job_id}


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    return JOBS[job_id]


# ── generation pipeline ────────────────────────────────────────────────────────
async def run_generation(job_id: str, req: GenerateRequest) -> None:
    if DEV_MODE:
        await asyncio.sleep(2)
        video_dir = UPLOADS_DIR / "videos"
        video_dir.mkdir(parents=True, exist_ok=True)
        video_path = video_dir / f"{job_id}.mp4"
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-loop", "1", "-i", req.image_path,
            "-t", "3", "-vf", "scale=512:512",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(video_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        JOBS[job_id] = {"status": "ready", "video_path": str(video_path)} if proc.returncode == 0 \
            else {"status": "failed", "error": "ffmpeg stub failed"}
        return

    try:
        audio_dir = UPLOADS_DIR / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_path = audio_dir / f"{job_id}.wav"

        if req.voice_sample_path and xtts_model is not None:
            wav_sample_path = audio_dir / f"{job_id}_sample.wav"
            await convert_audio_to_wav(req.voice_sample_path, str(wav_sample_path))
            await run_tts_with_voice_clone(req.script, req.language, str(wav_sample_path), str(audio_path))
        else:
            mp3_path = audio_dir / f"{job_id}_tts.mp3"
            await run_edge_tts(req.script, req.language, str(mp3_path))
            await convert_audio_to_wav(str(mp3_path), str(audio_path))

        video_dir = UPLOADS_DIR / "videos"
        video_dir.mkdir(parents=True, exist_ok=True)
        video_path = video_dir / f"{job_id}.mp4"

        await run_sadtalker_inprocess(req.image_path, str(audio_path), str(video_path))
        JOBS[job_id] = {"status": "ready", "video_path": str(video_path)}
    except Exception as exc:
        JOBS[job_id] = {"status": "failed", "error": str(exc)}


async def convert_audio_to_wav(input_path: str, wav_path: str) -> None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-i", input_path, "-ar", "22050", "-ac", "1", "-y", wav_path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg audio conversion failed: {stderr.decode()}")


async def run_edge_tts(script: str, language: str, output_path: str) -> None:
    voice = LANGUAGE_VOICE.get(language, "en-US-JennyNeural")
    communicate = edge_tts.Communicate(script, voice)
    await communicate.save(output_path)


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences for per-sentence TTS generation."""
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    # Merge very short fragments (< 4 words) with the next sentence
    merged = []
    for s in sentences:
        if merged and len(merged[-1].split()) < 4:
            merged[-1] = merged[-1] + " " + s
        else:
            merged.append(s)
    return [s.strip() for s in merged if s.strip()]


async def run_tts_with_voice_clone(script: str, language: str, speaker_wav: str, output_path: str) -> None:
    """Run voice cloning TTS — uses Chatterbox if available, falls back to XTTS v2."""
    loop = asyncio.get_event_loop()
    if chatterbox_model is not None:
        import torchaudio as ta
        import torch

        def _infer():
            sentences = _split_sentences(script)
            print(f"[TTS] Generating {len(sentences)} sentence(s) with Chatterbox ...")
            chunks = []
            silence = torch.zeros(1, int(chatterbox_model.sr * 0.15))
            seed = 42
            for i, sentence in enumerate(sentences):
                print(f"[TTS] Sentence {i+1}/{len(sentences)}: {sentence[:60]}")
                torch.manual_seed(seed)  # same seed = consistent voice across sentences
                wav = chatterbox_model.generate(
                    sentence,
                    audio_prompt_path=speaker_wav,
                    exaggeration=0.5,   # natural expressiveness
                    cfg_weight=0.6,     # balanced — natural flow + accent preserved
                )
                chunks.append(wav)
                if i < len(sentences) - 1:
                    chunks.append(silence)
            combined = torch.cat(chunks, dim=1)
            ta.save(output_path, combined, chatterbox_model.sr)
            print(f"[TTS] Done → {output_path}")

        await loop.run_in_executor(None, _infer)
    else:
        await loop.run_in_executor(
            None,
            lambda: xtts_model.tts_to_file(
                text=script,
                speaker_wav=speaker_wav,
                language=language,
                file_path=output_path,
                temperature=0.2,
                repetition_penalty=6.0,
                top_p=0.95,
            ),
        )


async def run_sadtalker_inprocess(image_path: str, audio_path: str, output_path: str) -> None:
    """Run SadTalker using pre-loaded in-process models with 3DMM coefficient caching."""
    if not sadtalker_models:
        raise RuntimeError("SadTalker models not loaded. Check startup logs.")

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sadtalker_infer, image_path, audio_path, output_path)


def _sadtalker_infer(image_path: str, audio_path: str, output_path: str) -> None:
    """Blocking SadTalker inference — runs in thread pool to avoid blocking event loop."""
    from src.generate_batch import get_data
    from src.generate_facerender_batch import get_facerender_data
    import tempfile

    preprocess_model = sadtalker_models["preprocess_model"]
    audio_to_coeff = sadtalker_models["audio_to_coeff"]
    animate_from_coeff = sadtalker_models["animate_from_coeff"]

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        first_frame_dir = tmp_path / "first_frame"
        first_frame_dir.mkdir()

        # ── 3DMM extraction (cached per avatar image) ──────────────────────────
        img_hash = _image_hash(image_path)
        if img_hash in coeff_cache:
            print(f"[SadTalker] Cache hit for image {img_hash} — skipping 3DMM extraction")
            first_coeff_path, crop_pic_path, crop_info = coeff_cache[img_hash]
        else:
            print(f"[SadTalker] Extracting 3DMM coefficients for image {img_hash} ...")
            first_coeff_path, crop_pic_path, crop_info = preprocess_model.generate(
                image_path, str(first_frame_dir), "crop", source_image_flag=True, pic_size=256
            )
            if first_coeff_path is None:
                raise RuntimeError("SadTalker: could not extract face coefficients from image.")
            coeff_cache[img_hash] = (first_coeff_path, crop_pic_path, crop_info)
            print(f"[SadTalker] 3DMM cached for {img_hash}")

        # ── audio → expression coefficients ────────────────────────────────────
        batch = get_data(first_coeff_path, audio_path, DEVICE, ref_eyeblink_coeff_path=None, still=True)
        coeff_path = audio_to_coeff.generate(batch, tmp, 0, None)

        # ── face rendering ─────────────────────────────────────────────────────
        data = get_facerender_data(
            coeff_path, crop_pic_path, first_coeff_path, audio_path,
            batch_size=10,  # 5x default — major speed boost
            input_yaw_list=None, input_pitch_list=None, input_roll_list=None,
            expression_scale=1.0, still_mode=True, preprocess="crop", size=256,
        )
        result = animate_from_coeff.generate(
            data, tmp, image_path, crop_info,
            enhancer=None, background_enhancer=None, preprocess="crop", img_size=256,
        )

        shutil.move(result, output_path)
        print(f"[SadTalker] Done → {output_path}")
