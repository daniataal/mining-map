#!/usr/bin/env bash
# Upsert non-empty GitHub Actions secret env vars into madsan/deploy/.env on the VM.
# Safe to run on every deploy — empty/missing GHA secrets do not overwrite existing VM values.
# Never prints secret values — only key names and SET/MISSING status.
#
# Usage:
#   AISSTREAM_API_KEY=... EIA_API_KEY=... ./madsan/scripts/sync_deploy_secrets_from_gha.sh [path/to/.env]
#   # path defaults to madsan/deploy/.env relative to repo root (MADSAN_DEPLOY_PATH or cwd)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY_ROOT="${MADSAN_DEPLOY_PATH:-${REPO_ROOT}}"
if [ -f "${DEPLOY_ROOT}/madsan/deploy/.env" ]; then
  DEFAULT_ENV="${DEPLOY_ROOT}/madsan/deploy/.env"
elif [ -f "${DEPLOY_ROOT}/deploy/.env" ]; then
  DEFAULT_ENV="${DEPLOY_ROOT}/deploy/.env"
else
  DEFAULT_ENV="${REPO_ROOT}/madsan/deploy/.env"
fi
ENV_FILE="${1:-${DEFAULT_ENV}}"
ENV_EXAMPLE="${ENV_FILE%.env}.env.example"

if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${ENV_EXAMPLE}" ]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from .env.example"
  else
    echo "ERROR: missing ${ENV_FILE} and ${ENV_EXAMPLE}" >&2
    exit 1
  fi
fi

export ENV_FILE ENV_EXAMPLE
python3 <<'PY'
import os
import re
from pathlib import Path

env_file = Path(os.environ["ENV_FILE"])
env_example = Path(os.environ.get("ENV_EXAMPLE", str(env_file.with_suffix(".env.example"))))
key_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
needs_quotes_re = re.compile(r'[\s#"$`\\!&|;\'()<>*?\[\]{}]')


def sanitize_secret(val: str) -> str:
    val = val.strip().replace("\r", "").replace("\n", "")
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
        val = val[1:-1]
    return val


def format_env_line(key: str, val: str) -> str:
    val = sanitize_secret(val)
    if needs_quotes_re.search(val) or not val:
        escaped = val.replace("\\", "\\\\").replace('"', '\\"')
        return f'{key}="{escaped}"'
    return f"{key}={val}"


def upsert_keys(path: Path, updates: dict[str, str]) -> None:
    lines: list[str] = []
    if path.is_file():
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    elif env_example.is_file():
        lines = env_example.read_text(encoding="utf-8", errors="replace").splitlines()
        path.parent.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        m = key_re.match(line.strip())
        if m and m.group(1) in updates:
            key = m.group(1)
            new_lines.append(format_env_line(key, updates[key]))
            seen.add(key)
        else:
            new_lines.append(line)

    for key, val in updates.items():
        if key not in seen:
            new_lines.append(format_env_line(key, val))

    path.write_text("\n".join(new_lines).rstrip() + "\n", encoding="utf-8")


def pick(*names: str) -> str:
    for name in names:
        val = os.environ.get(name, "")
        if val:
            return val
    return ""


updates: dict[str, str] = {}

def set_if(key: str, *sources: str) -> None:
    val = pick(*sources)
    if val:
        updates[key] = val


# --- GitHub secret name → deploy/.env runtime key (see madsan/deploy/.env.example) ---
set_if("AISSTREAM_API_KEY", "AISSTREAM_API_KEY")
set_if("EIA_API_KEY", "EIA_API_KEY")
set_if("OPENSANCTIONS_API_KEY", "OPENSANCTIONS_API_KEY")
set_if("COMTRADE_API_KEY", "COMTRADE_API_KEY")
set_if("COMTRADE_API_KEY_SECONDARY", "COMTRADE_API_KEY_SECONDARY")
set_if("COURTLISTENER_API_KEY", "COURTLISTENER_API_KEY")
set_if("GROQ_API_KEY", "GROQ_API_KEY", "GROQ_AI_API_KEY")
set_if("OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_AI_API_KEY")
set_if("MADSAN_JWT_SECRET", "MADSAN_JWT_SECRET", "SECRET_KEY")
set_if("MADSAN_DB_PASSWORD", "MADSAN_DB_PASSWORD", "DB_PASSWORD")
set_if("SHIPVAULT_REFRESH_TOKEN", "SHIPVAULT_REFRESH_TOKEN")
set_if("SHIPVAULT_BEARER_TOKEN", "SHIPVAULT_BEARER_TOKEN")
set_if("SHIPVAULT_SESSION_JSON", "SHIPVAULT_SESSION_JSON")
set_if("SHIPVAULT_EMAIL", "SHIPVAULT_EMAIL")
set_if("SHIPVAULT_PASSWORD", "SHIPVAULT_PASSWORD")
set_if("SHIPVAULT_FIREBASE_API_KEY", "SHIPVAULT_FIREBASE_API_KEY")

if updates:
    upsert_keys(env_file, updates)
    print("SYNCED_KEYS:" + ",".join(sorted(updates)))
else:
    print("SYNCED_KEYS:")

# Visibility — SET/MISSING only (no values).
check_keys = [
    "AISSTREAM_API_KEY",
    "EIA_API_KEY",
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "COMTRADE_API_KEY",
    "OPENSANCTIONS_API_KEY",
    "SHIPVAULT_REFRESH_TOKEN",
    "SHIPVAULT_BEARER_TOKEN",
]
text = env_file.read_text(encoding="utf-8", errors="replace")
for key in check_keys:
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.MULTILINE)
    val = m.group(1) if m else ""
    if val:
        print(f"  {key}=SET")
    else:
        print(f"  {key}=MISSING")
PY
