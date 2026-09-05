"""Configuration for the extractor. Mirrors the rule in packages/schema/src/env.ts:
parse once at startup, fail loudly naming the variable, never read os.environ elsewhere."""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    app_env: str
    log_level: str
    port: int
    # Service-to-service auth with apps/api. Required from Phase 3; optional in the Phase 1 stub.
    shared_secret: str | None

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> Settings:
        source = env if env is not None else dict(os.environ)
        app_env = source.get("APP_ENV", "local")
        if app_env not in {"local", "staging", "production"}:
            raise ConfigError("APP_ENV must be one of local, staging, production")
        secret = source.get("EXTRACTOR_SHARED_SECRET") or None
        if app_env != "local" and secret is None:
            raise ConfigError("EXTRACTOR_SHARED_SECRET is required when APP_ENV is not local")
        try:
            port = int(source.get("EXTRACTOR_PORT", "8000"))
        except ValueError as exc:
            raise ConfigError("EXTRACTOR_PORT must be an integer") from exc
        return Settings(
            app_env=app_env,
            log_level=source.get("LOG_LEVEL", "info"),
            port=port,
            shared_secret=secret,
        )
