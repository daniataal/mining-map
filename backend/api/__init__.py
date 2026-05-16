"""HTTP routers exposing schemas defined in ``backend/schemas``.

Each router is mounted from ``backend/main.py`` and is feature-flag gated so
in-progress contracts (e.g. routing) do not affect the running platform.
"""
