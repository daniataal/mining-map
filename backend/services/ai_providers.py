"""AI provider configuration visibility (no secret values exposed)."""

from __future__ import annotations

import logging
import os
from typing import Any, Literal

logger = logging.getLogger(__name__)

ProviderState = Literal["configured", "missing", "invalid_template"]
EnvPresence = Literal["SET", "MISSING"]

# Runtime names (docker / backend.env). GitHub secrets often use *_AI_API_KEY aliases.
AI_ENV_ALIASES: dict[str, tuple[str, ...]] = {
    "GROQ_API_KEY": ("GROQ_API_KEY", "GROQ_AI_API_KEY"),
    "OPENROUTER_API_KEY": ("OPENROUTER_API_KEY", "OPENROUTER_AI_API_KEY"),
}

AI_RUNTIME_ENV_KEYS = (
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "DISABLE_POLLINATIONS_FALLBACK",
    "AI_HTTP_TIMEOUT_SECONDS",
    "AI_HTTP_MAX_RETRIES",
    "AI_ANALYSIS_DEADLINE_SECONDS",
    "AI_ENRICHMENT_DEADLINE_SECONDS",
    "POLLINATIONS_HTTP_TIMEOUT_SECONDS",
    "POLLINATIONS_HTTP_MAX_RETRIES",
)


def _env_raw(name: str) -> str:
    for key in AI_ENV_ALIASES.get(name, (name,)):
        value = (os.getenv(key) or "").strip()
        if value:
            return value
    return ""


def _env_secret(name: str) -> str:
    value = _env_raw(name)
    if not value:
        return ""
    if value.startswith("{{") and value.endswith("}}"):
        return ""
    return value


def _pollinations_fallback_enabled() -> bool:
    return (os.getenv("DISABLE_POLLINATIONS_FALLBACK") or "").strip().lower() not in (
        "1",
        "true",
        "yes",
        "on",
    )


def _provider_config_state(name: str) -> ProviderState:
    raw = _env_raw(name)
    if not raw:
        return "missing"
    if raw.startswith("{{") and raw.endswith("}}"):
        return "invalid_template"
    return "configured"


def env_var_presence() -> dict[str, EnvPresence]:
    return {key: "SET" if (os.getenv(key) or "").strip() else "MISSING" for key in AI_RUNTIME_ENV_KEYS}


def format_env_var_presence(keys: tuple[str, ...] = AI_RUNTIME_ENV_KEYS) -> str:
    presence = env_var_presence()
    return ", ".join(f"{key}={presence.get(key, 'MISSING')}" for key in keys)


def get_ai_provider_status() -> dict[str, Any]:
    groq = _provider_config_state("GROQ_API_KEY")
    openrouter = _provider_config_state("OPENROUTER_API_KEY")
    pollinations_enabled = _pollinations_fallback_enabled()
    ready = groq == "configured" or openrouter == "configured" or pollinations_enabled
    return {
        "groq": groq,
        "openrouter": openrouter,
        "pollinations_enabled": pollinations_enabled,
        "ready": ready,
        "env": env_var_presence(),
    }


def build_ai_unavailable_message(*, pollinations_disabled: bool) -> str:
    env_summary = format_env_var_presence(
        ("GROQ_API_KEY", "OPENROUTER_API_KEY", "DISABLE_POLLINATIONS_FALLBACK")
    )
    if pollinations_disabled:
        return (
            "No configured AI API returned a result and the Pollinations fallback is disabled. "
            f"Backend env: {env_summary}. "
            "Set GROQ_API_KEY or OPENROUTER_API_KEY on the host (GitHub Actions secrets or /opt/mining-map/.env) "
            "and redeploy, or unset DISABLE_POLLINATIONS_FALLBACK to allow the free fallback."
        )
    return (
        "All intelligence providers are offline or timed out. "
        f"Backend env: {env_summary}. "
        "For faster, more reliable analysis, set GROQ_API_KEY or OPENROUTER_API_KEY and redeploy."
    )


def log_ai_provider_status() -> None:
    status = get_ai_provider_status()
    env = status.get("env") if isinstance(status.get("env"), dict) else {}
    summary = format_env_var_presence(
        ("GROQ_API_KEY", "OPENROUTER_API_KEY", "DISABLE_POLLINATIONS_FALLBACK")
    )
    logger.info(
        "AI providers: groq=%s openrouter=%s pollinations_enabled=%s ready=%s env=%s",
        status.get("groq"),
        status.get("openrouter"),
        status.get("pollinations_enabled"),
        status.get("ready"),
        {key: env.get(key) for key in ("GROQ_API_KEY", "OPENROUTER_API_KEY", "DISABLE_POLLINATIONS_FALLBACK")},
    )
    print(f"[startup] AI provider env: {summary} ready={status.get('ready')}")
