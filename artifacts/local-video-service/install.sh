#!/usr/bin/env bash
set -euo pipefail

# ── Usage ──────────────────────────────────────────────────────────────────────
# Run from the project root or pass an install prefix as the first argument:
#   bash artifacts/local-video-service/install.sh
#   bash artifacts/local-video-service/install.sh /path/to/install
#
# This will create:
#   <prefix>/avatar-venv/   Python virtual environment (~5 GB)
#   <prefix>/SadTalker/     SadTalker repo + model checkpoints (~3.5 GB)
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="${1:-$SCRIPT_DIR}"

VENV_DIR="$INSTALL_ROOT/avatar-venv"
SADTALKER_DIR="$INSTALL_ROOT/SadTalker"

echo "==> Install target: $INSTALL_ROOT"
echo "    Virtual env:     $VENV_DIR"
echo "    SadTalker:       $SADTALKER_DIR"
echo ""

# ── Prerequisites ──────────────────────────────────────────────────────────────
if ! command -v python3.11 &>/dev/null; then
  echo "ERROR: python3.11 not found. Run: brew install python@3.11"
  exit 1
fi
if ! command -v ffmpeg &>/dev/null; then
  echo "ERROR: ffmpeg not found. Run: brew install ffmpeg"
  exit 1
fi

# ── Virtual environment ────────────────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating Python 3.11 virtual environment at $VENV_DIR ..."
  python3.11 -m venv "$VENV_DIR"
else
  echo "==> Virtual environment already exists — skipping creation."
fi

PIP="$VENV_DIR/bin/pip"
PYTHON="$VENV_DIR/bin/python"

# ── PyTorch ────────────────────────────────────────────────────────────────────
echo "==> Installing PyTorch (~3.5 GB) ..."
"$PIP" install torch torchaudio

# ── Service dependencies (Chatterbox TTS + FastAPI) ───────────────────────────
echo "==> Installing service dependencies ..."
"$PIP" install -r "$SCRIPT_DIR/requirements.txt"

# ── SadTalker ─────────────────────────────────────────────────────────────────
if [ ! -d "$SADTALKER_DIR" ]; then
  echo "==> Cloning SadTalker to $SADTALKER_DIR ..."
  git clone https://github.com/OpenTalker/SadTalker.git "$SADTALKER_DIR"
else
  echo "==> SadTalker already cloned — skipping."
fi

echo "==> Installing SadTalker dependencies ..."
"$PIP" install -r "$SADTALKER_DIR/requirements.txt"

echo "==> Downloading SadTalker model checkpoints (~3.5 GB) ..."
cd "$SADTALKER_DIR"
bash scripts/download_models.sh
cd "$SCRIPT_DIR"

# ── Write start-service.sh ─────────────────────────────────────────────────────
cat > "$SCRIPT_DIR/start-service.sh" << EOF
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

SADTALKER_DIR="$SADTALKER_DIR" \\
LOCAL_UPLOADS_DIR="\$SCRIPT_DIR/../api-server/uploads" \\
"$PYTHON" -m uvicorn main:app --host 0.0.0.0 --port 8001
EOF
chmod +x "$SCRIPT_DIR/start-service.sh"

echo ""
echo "Installation complete."
echo ""
echo "Chatterbox TTS model (~350 MB) downloads automatically on first audio request."
echo ""
echo "Start the service:"
echo "  cd artifacts/local-video-service"
echo "  bash start-service.sh"
echo ""
echo "Dev mode (no models, instant stub videos):"
echo "  DEV_MODE=true bash start-service.sh"
