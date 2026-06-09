#!/usr/bin/env bash
# Sync selected secrets from repo-root .env into madsan/deploy/.env (and optional frontend).
# Never prints secret values — only key names on success.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_ENV="$REPO_ROOT/.env"
DEPLOY_ENV="$REPO_ROOT/madsan/deploy/.env"
DEPLOY_EXAMPLE="$REPO_ROOT/madsan/deploy/.env.example"
FRONTEND_ENV="$REPO_ROOT/madsan/frontend/.env.local"

if [[ ! -f "$ROOT_ENV" ]]; then
  echo "error: missing $ROOT_ENV" >&2
  exit 1
fi

export REPO_ROOT ROOT_ENV DEPLOY_ENV DEPLOY_EXAMPLE FRONTEND_ENV
python3 <<'PY'
import os
import re
from pathlib import Path

repo = Path(os.environ["REPO_ROOT"])
root_env = Path(os.environ["ROOT_ENV"])
deploy_env = Path(os.environ["DEPLOY_ENV"])
deploy_example = Path(os.environ["DEPLOY_EXAMPLE"])
frontend_env = Path(os.environ["FRONTEND_ENV"])

KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def parse_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = KEY_RE.match(s)
        if m:
            key, val = m.group(1), m.group(2)
            if (val.startswith('"') and val.endswith('"')) or (
                val.startswith("'") and val.endswith("'")
            ):
                val = val[1:-1]
            out[key] = val
    return out


def upsert_keys(path: Path, updates: dict[str, str]) -> None:
    lines: list[str] = []
    if path.is_file():
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    else:
        if deploy_example.is_file():
            lines = deploy_example.read_text(encoding="utf-8", errors="replace").splitlines()
        path.parent.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        m = KEY_RE.match(line.strip())
        if m and m.group(1) in updates:
            key = m.group(1)
            new_lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            new_lines.append(line)

    for key, val in updates.items():
        if key not in seen:
            new_lines.append(f"{key}={val}")

    path.write_text("\n".join(new_lines).rstrip() + "\n", encoding="utf-8")


root = parse_dotenv(root_env)
copied: list[str] = []

def set_if(key: str, value: str | None) -> None:
    if value is not None and value != "":
        copied.append(key)


deploy_updates: dict[str, str] = {}

if v := root.get("EIA_API_KEY"):
    deploy_updates["EIA_API_KEY"] = v
    set_if("EIA_API_KEY", v)

if v := root.get("OPENSANCTIONS_API_KEY"):
    deploy_updates["OPENSANCTIONS_API_KEY"] = v
    set_if("OPENSANCTIONS_API_KEY", v)

jwt = root.get("MADSAN_JWT_SECRET") or root.get("SECRET_KEY")
if jwt:
    deploy_updates["MADSAN_JWT_SECRET"] = jwt
    set_if("MADSAN_JWT_SECRET", jwt)

db_pass = root.get("MADSAN_DB_PASSWORD") or root.get("DB_PASSWORD")
if db_pass:
    deploy_updates["MADSAN_DB_PASSWORD"] = db_pass
    set_if("MADSAN_DB_PASSWORD", db_pass)

legacy = root.get("LEGACY_DATABASE_URL")
if not legacy:
    user = root.get("DB_USER")
    password = root.get("DB_PASSWORD")
    host = root.get("DB_HOST")
    dbname = root.get("DB_NAME") or "mining_db"
    port = root.get("LEGACY_DB_PORT") or root.get("DB_PORT") or "5434"
    if user and password and host:
        if host in ("localhost", "127.0.0.1", "::1"):
            host = "host.docker.internal"
        legacy = (
            f"postgresql://{user}:{password}@{host}:{port}/{dbname}?sslmode=disable"
        )
if legacy:
    deploy_updates["LEGACY_DATABASE_URL"] = legacy
    set_if("LEGACY_DATABASE_URL", legacy)

if v := root.get("DATABASE_URL"):
    deploy_updates["DATABASE_URL"] = v
    set_if("DATABASE_URL", v)

if deploy_updates:
    upsert_keys(deploy_env, deploy_updates)

# Frontend: only literal NEXT_PUBLIC_* keys from root (no value echo)
frontend_updates = {
    k: v for k, v in root.items() if k.startswith("NEXT_PUBLIC_") and v
}
if frontend_updates:
    upsert_keys(frontend_env, frontend_updates)
    for k in sorted(frontend_updates):
        if k not in copied:
            copied.append(k)

# Keys in root with no MadSan deploy mapping (informational)
mapped_sources = {
    "EIA_API_KEY",
    "OPENSANCTIONS_API_KEY",
    "MADSAN_JWT_SECRET",
    "SECRET_KEY",
    "MADSAN_DB_PASSWORD",
    "DB_PASSWORD",
    "LEGACY_DATABASE_URL",
    "DATABASE_URL",
    "DB_USER",
    "DB_HOST",
    "DB_NAME",
    "DB_PORT",
    "LEGACY_DB_PORT",
}
unmapped = sorted(k for k in root if k not in mapped_sources and not k.startswith("NEXT_PUBLIC_"))

print("COPIED_KEYS:" + ",".join(sorted(set(copied))))
print("UNMAPPED_ROOT_KEYS:" + ",".join(unmapped))
print("DEPLOY_ENV:" + str(deploy_env.relative_to(repo)))
if frontend_updates:
    print("FRONTEND_ENV:" + str(frontend_env.relative_to(repo)))
PY

