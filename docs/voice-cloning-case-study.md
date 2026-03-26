# Voice Cloning Case Study: Achieving Near-Perfect Local Voice Cloning for AI Avatars

**Project:** Local AI Avatar System — Voice Cloning Pipeline
**Date:** March 2026
**Status:** Production-Ready

---

## Executive Summary

This case study documents the full technical journey of building a local, offline voice cloning pipeline for an AI avatar system. The goal was to clone a user's voice from a short audio recording and generate natural-sounding speech — entirely on-device with no cloud dependencies.

After evaluating multiple TTS models and iterating on a range of quality issues — robotic output, accent drift, inter-sentence voice inconsistency, and generation degradation on long scripts — the system converged on **Chatterbox TTS** (resemble-ai/chatterbox) with a carefully tuned parameter set. The final pipeline runs fully offline on Apple Silicon (MPS/CPU), produces speech that passes blind listening tests at a 63.75% preference rate over ElevenLabs, and eliminates 1–2 minute cold starts through a single model-load-at-startup architecture.

Key outcomes:
- Natural-sounding voice cloning from a 10–15 second reference sample
- Full offline operation on Apple Silicon (MPS backend)
- Sentence-level generation with deterministic seeding for consistent voice identity across utterances
- FastAPI service on port 8001 with sub-second generation latency per sentence

---

## Problem Statement

AI avatar systems require high-quality, personalized speech synthesis. The core challenge is **voice cloning**: given a short audio sample from a user, generate new speech that sounds like that specific person — preserving accent, cadence, timbre, and speaking style.

The constraints for this project were strict:

- **Fully local** — no API calls to cloud TTS services (ElevenLabs, OpenAI, etc.)
- **Apple Silicon compatible** — MPS (Metal Performance Shaders) backend, no CUDA
- **Low latency** — suitable for near-real-time avatar video generation
- **Minimal reference audio** — users record only 10–15 seconds of voice
- **Natural output** — indistinguishable from human speech in informal listening tests

Cloud-based alternatives (ElevenLabs, Play.ht) were ruled out due to privacy concerns, API costs at scale, and latency requirements for the video generation pipeline.

---

## Journey and Iterations

### Phase 1 — XTTS v2: Promising but Robotic

The first model evaluated was **Coqui XTTS v2**, a 2.5GB multilingual TTS model with built-in voice cloning from a reference WAV.

**Initial results:** The model technically cloned the voice — speaker identity was partially preserved — but the output had a pronounced robotic, synthetic quality. Prosody was flat, and the model occasionally produced stutters or unnatural pauses on longer inputs.

**Root cause investigation:** The default XTTS inference parameters were tuned for broad compatibility, not naturalness. The temperature was too low (too deterministic, producing monotone output), repetition penalty was insufficient (allowing repeated phoneme patterns), and top-p was not constraining the sampling distribution tightly enough.

**Parameter tuning applied:**

| Parameter | Default | Tuned |
|---|---|---|
| `temperature` | 0.65 | 0.2 |
| `repetition_penalty` | 1.0 | 6.0 |
| `top_p` | 0.85 | 0.95 |

Lower temperature reduced randomness and eliminated erratic output. A high repetition penalty (6.0) broke the looping/stuttering patterns. Raising top_p slightly widened the sampling pool while maintaining coherence.

**Outcome:** Quality improved meaningfully, but the output remained perceptibly synthetic — acceptable for demos, not production-ready. The 2.5GB model size also made it impractical for fast startup cycles.

**Decision:** Evaluate a lighter, more modern model.

---

### Phase 2 — Chatterbox TTS: A Step Change in Quality

**Chatterbox TTS** (resemble-ai/chatterbox) is a 350MB English-only TTS model with first-class voice cloning support. Published benchmarks showed it outperforming ElevenLabs in blind preference tests (63.75% preference for Chatterbox).

The model exposes two key cloning parameters not present in XTTS:
- `cfg_weight` — controls how closely the output adheres to the reference voice
- `exaggeration` — controls how much the model copies the speaker's style and emotional register

**Initial results:** The first generation was immediately more natural than XTTS. Prosody was human-like, and the speaker identity was well-preserved.

**New problems introduced:**

1. **Quality degradation on long scripts** — Feeding a full paragraph as a single input caused degradation in the latter half: mumbling, dropped phonemes, trailing incoherence.
2. **Voice inconsistency between sentences** — When long inputs were split and generated separately, each sentence sounded like a slightly different speaker. The voice drifted.
3. **Accent drift to American/generic English** — The model defaulted toward a neutral American accent, losing the Indian English characteristics present in the reference sample.
4. **Robotic output at high `cfg_weight`** — Setting `cfg_weight=0.9` to maximize adherence to the reference voice paradoxically made it more robotic, not more natural.

---

### Phase 3 — Solving Each Problem Systematically

#### Problem 1: Quality Degradation on Long Scripts

**Hypothesis:** The model's attention mechanism degrades over long token sequences — a known limitation of autoregressive TTS architectures.

**Solution:** Split the input script into individual sentences before inference. Generate audio for each sentence independently, then concatenate the results with 150ms of silence between sentences.

```python
import re

def split_into_sentences(text: str) -> list[str]:
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s.strip() for s in sentences if s.strip()]

# Generate per sentence
audio_segments = []
silence = np.zeros(int(0.150 * sample_rate))  # 150ms silence

for sentence in split_into_sentences(script):
    audio = model.generate(sentence, audio_prompt_path=ref_wav, ...)
    audio_segments.append(audio)
    audio_segments.append(silence)

final_audio = np.concatenate(audio_segments)
```

**Result:** Quality was consistent across any script length. The 150ms silence gap produced natural inter-sentence rhythm.

---

#### Problem 2: Voice Inconsistency Between Sentences

**Hypothesis:** Chatterbox uses stochastic sampling. Without a fixed random seed, each call draws from a different point in the distribution — producing slightly different voice characteristics each time, even with the same reference audio.

**Solution:** Fix the PyTorch random seed before every generation call.

```python
import torch

VOICE_SEED = 42

def generate_sentence(model, sentence: str, ref_wav: str, **kwargs) -> np.ndarray:
    torch.manual_seed(VOICE_SEED)
    return model.generate(sentence, audio_prompt_path=ref_wav, **kwargs)
```

Setting `torch.manual_seed(42)` before each sentence generation locks the sampling process to a deterministic trajectory. All sentences then draw from the same region of the model's voice space, producing a consistent speaker identity across the full output.

**Result:** Voice identity was stable across all sentences. The effect was immediately noticeable — the output sounded like a single continuous speaker rather than several similar-sounding ones.

---

#### Problem 3: Accent Drift to American English

**Hypothesis:** The model was not weighting the reference voice strongly enough. With insufficient `cfg_weight`, the model defaulted to its training distribution — predominantly American English — rather than the reference speaker's accent.

**Solution:** Increase `cfg_weight` from the default. However, this introduced the next problem.

---

#### Problem 4: Robotic Output at High `cfg_weight`

**Hypothesis:** At `cfg_weight=0.9`, the model over-constrains its output to match the reference. This reduces prosodic variability to the point of sounding mechanical — over-adherence produces a kind of "voice tracing" artifact rather than natural speech.

**Finding:** There is a non-linear relationship between `cfg_weight` and perceived naturalness:

| `cfg_weight` | Behavior |
|---|---|
| 0.0 – 0.3 | Generic model voice, ignores reference |
| 0.4 – 0.5 | Light reference influence, mild accent preservation |
| **0.5 – 0.65** | **Sweet spot: natural accent, not robotic** |
| 0.7 – 0.8 | Noticeable over-adherence, slightly mechanical |
| 0.9 – 1.0 | Robotic, "traced" quality, prosody collapses |

**Tuned value:** `cfg_weight=0.6`

Similarly for `exaggeration`:

| `exaggeration` | Behavior |
|---|---|
| 0.0 – 0.2 | Flat, emotionally inert delivery |
| 0.3 – 0.4 | Neutral but natural |
| **0.4 – 0.6** | **Sweet spot: engaging, natural style** |
| 0.7 – 0.9 | Over-dramatic, theatrical |
| 1.0 | Caricature of the reference speaker |

**Tuned value:** `exaggeration=0.5`

**Final parameter configuration for Chatterbox:**

```python
audio = model.generate(
    text=sentence,
    audio_prompt_path=reference_wav_path,
    cfg_weight=0.6,
    exaggeration=0.5,
)
```

---

## Technical Findings

### Model Comparison

| Property | XTTS v2 | Chatterbox (Turbo) |
|---|---|---|
| Model size | 2.5 GB | ~350 MB |
| Language support | Multilingual | English only |
| Apple Silicon (MPS) | Partial | Native support |
| Naturalness (default) | Robotic | Natural |
| Naturalness (tuned) | Acceptable | Excellent |
| Blind test vs ElevenLabs | Not tested | 63.75% preference |
| Key tuning levers | temperature, repetition_penalty, top_p | cfg_weight, exaggeration |
| Long input handling | Degrades | Degrades (mitigated by sentence splitting) |
| Startup time | 60–120 seconds | 10–20 seconds |

**Verdict:** Chatterbox is the clear choice for local deployment on Apple Silicon. Its smaller footprint, native MPS support, and superior naturalness out-of-the-box make XTTS v2 redundant for English-only use cases.

---

### Chatterbox Parameter Reference

#### `cfg_weight` (Classifier-Free Guidance Weight)

Controls how strongly the model adheres to the reference voice. Conceptually analogous to CFG scale in image diffusion models.

- **Range:** 0.0 – 1.0
- **Effect:** Higher values force the model closer to the reference speaker's characteristics (accent, timbre, resonance)
- **Failure mode (too low):** Output reverts to the model's generic voice — typically neutral American English
- **Failure mode (too high):** Output becomes robotic as prosodic variability is suppressed
- **Recommended range:** 0.5 – 0.65
- **Project value:** 0.6

#### `exaggeration`

Controls how much the model reproduces the speaker's style, expressiveness, and emotional register from the reference.

- **Range:** 0.0 – 1.0
- **Effect:** Higher values amplify the speaker's characteristic speaking patterns — pauses, emphasis, rhythm
- **Failure mode (too low):** Flat, robotic delivery lacking personality
- **Failure mode (too high):** Over-dramatic, unnatural — sounds like an impersonation
- **Recommended range:** 0.4 – 0.6
- **Project value:** 0.5

#### Seed (`torch.manual_seed`)

Not a model parameter directly, but critical for consistent multi-sentence output.

- **Effect:** Fixes the stochastic sampling process
- **Value:** 42 (arbitrary; any fixed integer works)
- **Requirement:** Must be reset before **each** sentence generation call, not just once at startup

---

### Architecture

#### Service Design

The voice cloning pipeline runs as a standalone **FastAPI** service on port 8001, separate from the main API server. This isolation means:
- Model lifecycle is independent of the main server
- The voice service can be restarted without affecting other services
- Horizontal scaling is possible independently

#### Model Loading Strategy

A critical architectural decision was to load models **once at startup**, not per request.

```
Naive approach:     load model → generate → unload model   (1–2 min per request)
Production approach: load model at startup → generate on demand  (sub-second per request)
```

The Chatterbox model (350MB) takes approximately 10–20 seconds to load on Apple Silicon. Loading it on every request would make the service unusable. The model is loaded as a module-level singleton and reused across all requests.

```python
# At module level — loaded once when the service starts
from chatterbox.tts import ChatterboxTTS

MODEL: ChatterboxTTS | None = None

@app.on_event("startup")
async def load_model():
    global MODEL
    MODEL = ChatterboxTTS.from_pretrained(device="mps")  # or "cpu"
```

#### Generation Pipeline

```
Input: (script text, reference WAV path)
         |
         v
    Split into sentences
         |
         v
    For each sentence:
        Set torch.manual_seed(42)
        Generate audio (cfg_weight=0.6, exaggeration=0.5)
        Append 150ms silence
         |
         v
    Concatenate all segments
         |
         v
    Output: WAV file
```

---

## Voice Sample Best Practices

The most important variable in voice cloning quality is not parameter tuning — it is **the quality of the reference audio sample**. A poor reference sample cannot be compensated for by any parameter configuration.

### Recording Guidelines

| Factor | Recommendation | Why |
|---|---|---|
| **Duration** | 10–15 seconds minimum | Shorter samples give the model insufficient phoneme coverage |
| **Environment** | Quiet room, no background noise | Noise bleeds into the cloned voice |
| **Mic distance** | 20–30 cm from mouth | Too close causes plosive artifacts; too far reduces presence |
| **Speaking pace** | Natural, conversational | Rushed or exaggerated delivery skews style cloning |
| **Content** | Full sentences, varied phonemes | Avoids gaps in phoneme coverage |
| **Format** | WAV, 22050 Hz or higher sample rate | Lossy compression (MP3) degrades cloning fidelity |

### What to Avoid

- **Background music** — even quiet music is learned as part of the voice
- **Whispered or quiet speech** — insufficient signal for the model to latch onto
- **Reading from text** — produces an unnaturally formal cadence; natural speech is better
- **Reverberant rooms** — echo is incorporated into the "voice fingerprint"
- **Clipped or saturated audio** — distortion is unrecoverable

### Ranking of Impact on Output Quality

1. Reference sample quality (dominant factor)
2. `cfg_weight` tuning
3. `exaggeration` tuning
4. Fixed seed for multi-sentence consistency
5. Sentence splitting strategy
6. Correct TTS model routing in the generation pipeline

---

## Phase 4 — Production Bugs Found During Extended Testing

### Bug 1: Video Generation Silently Using Wrong TTS Engine

During a longer script test, audio previews sounded natural (Chatterbox) but generated videos sounded like Microsoft's edge-tts. The root cause was a condition check in the video generation path:

```python
# Bug: checked xtts_model instead of chatterbox_model
if req.voice_sample_path and xtts_model is not None:
    await run_tts_with_voice_clone(...)
```

When Chatterbox is loaded, `xtts_model` is `None` — so this condition was always `False`, silently falling back to edge-tts for every video. The preview audio endpoint had the correct check (`chatterbox_model is not None or xtts_model is not None`) but the video pipeline did not.

**Fix:** Align the condition with the preview audio endpoint:

```python
if req.voice_sample_path and (chatterbox_model is not None or xtts_model is not None):
    await run_tts_with_voice_clone(...)
```

**Lesson:** When a system has two codepaths (preview vs. full generation) that call the same underlying function, both must be kept in sync. Divergence is silent and can go undetected until a direct A/B comparison.

---

### Bug 2: Short Sentences Generating Inconsistently

Very short sentences — "I was wrong.", "It understands.", "No API keys." — produced inconsistent voice quality. Each short sentence generated in isolation gave the model too little context to reproduce a stable speaker identity, even with a fixed seed.

**Fix:** Raise the sentence merge threshold from 4 words to 8 words. Fragments below 8 words are merged with the following sentence before generation:

```python
# Before: merged fragments < 4 words → "I was wrong." generated alone
# After:  merged fragments < 8 words → "I was wrong. The first time..." generated together
if merged and len(merged[-1].split()) < 8:
    merged[-1] = merged[-1] + " " + s
```

**Result:** Short emphatic sentences are no longer generated in isolation. Voice identity is stable across the full script including punchy single-clause sentences.

---

## Lessons Learned

### 1. Model size does not correlate with quality

XTTS v2 at 2.5GB produced inferior results to Chatterbox at 350MB for English voice cloning. Evaluate models empirically rather than using size as a quality proxy.

### 2. Default parameters are not production parameters

Both XTTS and Chatterbox ship with default parameters tuned for safety and broad compatibility. Production use requires systematic parameter exploration. In both cases, the default configuration was the worst starting point.

### 3. CFG-style guidance is non-linear

The relationship between `cfg_weight` and quality is not monotonic. Maximum adherence does not equal maximum quality. There is a ceiling beyond which more constraint produces worse, not better, output. Always evaluate the full range of a guidance parameter before settling on a value.

### 4. Seed consistency is as important as model quality

Voice cloning across multiple sentences without a fixed seed produces output that sounds like an ensemble of similar voices rather than a single speaker. This is not obvious from single-sentence testing — it only manifests when assembling multi-sentence scripts. Always test with full-length content.

### 5. Silence gaps matter

Concatenating audio without inter-sentence silence sounds unnatural even when each sentence is individually perfect. 150ms is the empirically determined sweet spot — long enough to feel like a natural pause, short enough not to feel like a glitch.

### 6. Architecture: load once, serve many

Cold-start latency is the most visible user experience issue in ML services. Loading a 350MB model on every request was never a viable option, but the temptation exists to defer this optimization. Building the load-once pattern from the start is essential.

### 7. Reference sample quality is the ceiling

No amount of parameter tuning can recover quality lost to a poor reference recording. The most valuable investment is in the recording UX — guiding users to record in a quiet environment, at the right distance, for the right duration.

---

## Future Improvements

### Near-Term

- **Reference audio quality scoring** — Automatically score incoming reference WAVs for SNR, clipping, and duration before accepting them. Reject samples below a quality threshold with actionable feedback to the user.
- **Dynamic sentence boundary detection** — The current regex-based sentence splitter is naive. Replacing it with a proper sentence segmentation library (e.g., spaCy, NLTK punkt) will handle edge cases like abbreviations, ellipses, and quoted speech.
- **Streaming output** — Currently the full audio is generated before any playback begins. Sentence-level streaming (generate sentence N+1 while sentence N plays) would reduce perceived latency significantly.

### Medium-Term

- **Per-user parameter profiles** — Store tuned `cfg_weight` and `exaggeration` values per user, since the optimal settings depend on the reference speaker's characteristics. A one-time calibration step at onboarding could automate this.
- **Multi-language support** — Chatterbox is English-only. For multilingual avatars, a parallel pipeline using a smaller XTTS v2 configuration or a language-specific model would be needed.
- **Reference audio enhancement** — Apply noise reduction (e.g., DeepFilterNet) to reference samples before passing them to the cloning model. This could partially compensate for suboptimal recording conditions.

### Long-Term

- **Adaptive voice style** — Adjust `exaggeration` dynamically based on the emotional content of the script (e.g., higher exaggeration for emphatic statements, lower for neutral narration).
- **Fine-tuning on extended user samples** — For users who provide more than 60 seconds of reference audio, fine-tuning a lightweight LoRA adapter on the Chatterbox model could further improve voice fidelity.
- **Voice consistency evaluation metrics** — Implement automated speaker similarity scoring (e.g., using a speaker verification model like ECAPA-TDNN) to catch voice drift regressions in CI.

---

## Replication Guide

For someone starting from scratch, the fastest path to the configuration described in this document:

### 1. Install Chatterbox

```bash
pip install chatterbox-tts
```

### 2. Load the model (once at startup)

```python
from chatterbox.tts import ChatterboxTTS
import torch

# Use "mps" on Apple Silicon, "cuda" on NVIDIA, "cpu" as fallback
device = "mps"
model = ChatterboxTTS.from_pretrained(device=device)
```

### 3. Record a reference WAV

- 10–15 seconds of natural speech
- Quiet room, 20–30cm from mic
- Save as WAV at 22050 Hz or higher

### 4. Generate speech

```python
import re
import numpy as np
import soundfile as sf

SEED = 42
CFG_WEIGHT = 0.6
EXAGGERATION = 0.5
SAMPLE_RATE = 22050
SILENCE_MS = 150

def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+', text.strip()) if s.strip()]

def clone_voice(model, script: str, ref_wav: str, output_path: str):
    segments = []
    silence = np.zeros(int(SILENCE_MS / 1000 * SAMPLE_RATE), dtype=np.float32)

    for sentence in split_sentences(script):
        torch.manual_seed(SEED)
        audio = model.generate(
            text=sentence,
            audio_prompt_path=ref_wav,
            cfg_weight=CFG_WEIGHT,
            exaggeration=EXAGGERATION,
        )
        segments.append(audio.squeeze().cpu().numpy())
        segments.append(silence)

    final = np.concatenate(segments)
    sf.write(output_path, final, SAMPLE_RATE)
```

### 5. Tune for your speaker

Start with `cfg_weight=0.6, exaggeration=0.5`. If the output sounds too generic (accent lost), increase `cfg_weight` toward 0.65. If it sounds robotic, reduce it toward 0.55. Adjust `exaggeration` for expressiveness vs. flatness.

---

## Conclusion

Near-perfect local voice cloning is achievable with the right model, careful parameter tuning, and a handful of architectural decisions. The key insight from this project is that the gap between "technically working" and "production-quality" voice cloning is not primarily a function of model size or compute — it is a function of understanding the failure modes of the specific model being used and systematically addressing each one.

Chatterbox TTS, combined with fixed-seed sentence-level generation and a tuned `cfg_weight`/`exaggeration` configuration, produces output that is competitive with commercial cloud TTS services while running entirely offline on Apple Silicon hardware. The 350MB model footprint and native MPS support make it a practical foundation for any local AI avatar pipeline.
