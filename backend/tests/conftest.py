import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    from app.auth import hash_password

    os.environ.update({
        "DATA_PROVIDER": "demo",
        "DATA_DIR": str(tmp_path_factory.mktemp("data")),
        "COOKIE_SECURE": "0",
        "SECRET_KEY": "test-secret",
        "DASHBOARD_PASSWORD_HASH": hash_password("richtiges-passwort"),
        "ENV_FILE": "/nonexistent",
    })
    from fastapi.testclient import TestClient
    from app.main import app

    return TestClient(app)


@pytest.fixture(scope="session")
def authed(client):
    r = client.post("/api/login", json={"password": "richtiges-passwort"})
    assert r.status_code == 200
    return client
