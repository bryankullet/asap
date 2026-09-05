import pytest

from asap_extractor.config import ConfigError, Settings


def test_settings_require_shared_secret_outside_local():
    with pytest.raises(ConfigError, match="EXTRACTOR_SHARED_SECRET"):
        Settings.from_env({"APP_ENV": "staging"})


def test_settings_local_defaults():
    s = Settings.from_env({})
    assert s.app_env == "local"
    assert s.port == 8000


def test_health_endpoint():
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from asap_extractor.main import create_app

    app = create_app(Settings.from_env({}))
    with TestClient(app) as client:
        res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
