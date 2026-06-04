"""Resolve repo ``data/`` directory for local dev (repo root) and Docker (/app + volume)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

_ANCHOR_FILE = "storage_terminals_seed.json"


def repo_data_dir() -> Path:
    """Directory containing ``storage_terminals_seed.json`` and related seed JSON."""
    env = (os.getenv("MERIDIAN_DATA_DIR") or "").strip()
    if env:
        return Path(env)

    here = Path(__file__).resolve()
    # backend/services/repo_data_paths.py -> parents[2] = repo root
    # app/services/repo_data_paths.py (Docker) -> parents[1] = /app
    for root in (here.parents[2], here.parents[1]):
        candidate = root / "data"
        if (candidate / _ANCHOR_FILE).is_file():
            return candidate
    return here.parents[2] / "data"


def repo_data_file(name: str) -> Path:
    return repo_data_dir() / name
