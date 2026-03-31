#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "▶  Creating virtual environment…"
uv venv .venv --quiet

echo "▶  Installing Python dependencies…"
uv pip install -r backend/requirements.txt --quiet

echo "▶  Starting Sales Dashboard on http://localhost:8000"
cd backend
../.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
