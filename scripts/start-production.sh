#!/bin/sh
set -eu

# Free Render services have no pre-deploy command. This single-instance beta
# checks/applies migrations before accepting requests, including after cold starts.
python -m litestar --app storytool.app:app database upgrade --no-prompt
# Story text at rest: encrypt any rows still stored plain (a no-op without STORYTOOL_DATA_KEYS).
python -m storytool.db.encrypt_existing
exec uvicorn storytool.app:app --host 0.0.0.0 --port "${PORT:-8000}"
