from backend.services.ai_providers import (
    _env_secret,
    build_ai_unavailable_message,
    env_var_presence,
    get_ai_provider_status,
)


def test_env_secret_ignores_unresolved_template_placeholders(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "{{Secrets.GROQ_AI_API_KEY}}")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-realish")
    assert _env_secret("GROQ_API_KEY") == ""
    assert _env_secret("OPENROUTER_API_KEY") == "sk-or-realish"


def test_get_ai_provider_status_reports_configured_and_env(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("DISABLE_POLLINATIONS_FALLBACK", "1")

    status = get_ai_provider_status()

    assert status["groq"] == "configured"
    assert status["openrouter"] == "missing"
    assert status["pollinations_enabled"] is False
    assert status["ready"] is True
    assert status["env"]["GROQ_API_KEY"] == "SET"
    assert status["env"]["OPENROUTER_API_KEY"] == "MISSING"
    assert status["env"]["DISABLE_POLLINATIONS_FALLBACK"] == "SET"


def test_get_ai_provider_status_invalid_template(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "{{Secrets.GROQ_AI_API_KEY}}")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("DISABLE_POLLINATIONS_FALLBACK", "1")

    status = get_ai_provider_status()

    assert status["groq"] == "invalid_template"
    assert status["ready"] is False


def test_build_ai_unavailable_message_includes_env_summary(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("DISABLE_POLLINATIONS_FALLBACK", "1")

    message = build_ai_unavailable_message(pollinations_disabled=True)

    assert "GROQ_API_KEY=MISSING" in message
    assert "OPENROUTER_API_KEY=MISSING" in message
    assert "DISABLE_POLLINATIONS_FALLBACK=SET" in message
    assert "Pollinations fallback is disabled" in message


def test_env_var_presence_never_includes_secret_values(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "super-secret-value")
    presence = env_var_presence()
    assert presence["GROQ_API_KEY"] == "SET"
    assert "super-secret" not in str(presence)
