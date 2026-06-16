#!/usr/bin/env python3
"""Validate madsan/deploy/.env for docker compose and bash source safety.

Never prints secret values — only key names, line numbers, and error classes.
Exit 0 when valid; exit 1 with a short diagnostic on stderr.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def _strip_surrounding_quotes(val: str) -> str:
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
        return val[1:-1]
    return val


def _parse_value(raw: str) -> tuple[str | None, str | None]:
    """Return (value, error_message) for a dotenv value fragment."""
    raw = raw.strip()
    if not raw:
        return "", None
    if raw[0] == '"':
        i = 1
        escaped = False
        while i < len(raw):
            ch = raw[i]
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                if i + 1 < len(raw) and not raw[i + 1:].isspace():
                    return None, "trailing characters after closing double quote"
                return _strip_surrounding_quotes(raw), None
            i += 1
        return None, "unclosed double quote"
    if raw[0] == "'":
        end = raw.find("'", 1)
        if end == -1:
            return None, "unclosed single quote"
        if end + 1 < len(raw) and not raw[end + 1 :].isspace():
            return None, "trailing characters after closing single quote"
        return raw[1:end], None
    if any(ch.isspace() for ch in raw):
        return None, "unquoted whitespace in value"
    if '"' in raw or "'" in raw:
        return None, "bare quote in unquoted value"
    return raw, None


def validate_lines(lines: list[str]) -> list[str]:
    errors: list[str] = []
    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = KEY_RE.match(stripped)
        if not m:
            errors.append(f"line {lineno}: not a KEY=VALUE assignment")
            continue
        key, raw_val = m.group(1), m.group(2)
        val, err = _parse_value(raw_val)
        if err:
            errors.append(f"line {lineno}: {key}: {err}")
            continue
        if val is not None and ("\n" in val or "\r" in val):
            errors.append(f"line {lineno}: {key}: embedded newline")
    return errors


def validate_bash_source(path: Path) -> str | None:
    cmd = f"set -a; source {path}; set +a"
    proc = subprocess.run(
        ["bash", "-c", cmd],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        return None
    msg = (proc.stderr or proc.stdout or "bash source failed").strip().splitlines()[-1]
    # Redact anything after ": " that looks like a secret payload in "command not found".
    msg = re.sub(
        r"(: line \d+: ).+(: command not found)$",
        r"\1<redacted>\2",
        msg,
    )
    return msg


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "madsan/deploy/.env")
    if not path.is_file():
        print(f"ERROR: missing {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    errors = validate_lines(lines)
    if errors:
        for err in errors:
            print(f"ENV_INVALID: {err}", file=sys.stderr)
        return 1
    bash_err = validate_bash_source(path.resolve())
    if bash_err:
        print(f"ENV_INVALID: bash source: {bash_err}", file=sys.stderr)
        return 1
    print(f"ENV_VALID: {path} lines={len(lines)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
