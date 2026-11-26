"""Profile update and password change API tests."""

import base64

import pytest

try:
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    _IMPORT_OK = True
except Exception as e:  # pragma: no cover - environment-dependent
    client = None
    _IMPORT_OK = False
    _IMPORT_ERR = e


@pytest.fixture(autouse=True)
def _require_import():
    if not _IMPORT_OK:
        pytest.skip(f"App import unavailable in this environment: {_IMPORT_ERR}")


@pytest.fixture()
def session(tmp_path, monkeypatch):
    import app.services.user_store as us

    monkeypatch.setattr(us, "APP_DB_PATH", str(tmp_path / "auth.db"))
    us.init_db()
    user = us.create_user("profile@example.com", "password123")
    token = us.create_access_token(user)
    return {"Authorization": f"Bearer {token}"}, token


def test_profile_endpoints_require_auth():
    assert client.post("/api/v1/auth/profile", json={"name": "Amina"}).status_code == 401
    assert client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "password123", "new_password": "newpassword123"},
    ).status_code == 401


def test_profile_update_persists_and_rejects_bad_avatar(session):
    headers, _ = session
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["name"] == ""
    assert me.json()["user"]["phone"] == ""

    avatar = "data:image/png;base64," + base64.b64encode(b"fake-image").decode("ascii")
    r = client.post(
        "/api/v1/auth/profile",
        headers=headers,
        json={"name": "Amina", "phone": "+255700000000", "avatar": avatar},
    )
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["name"] == "Amina"
    assert user["phone"] == "+255700000000"
    assert user["avatar"] == avatar

    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.json()["user"]["name"] == "Amina"

    bad = client.post("/api/v1/auth/profile", headers=headers, json={"avatar": "not-an-image"})
    assert bad.status_code == 400


def test_change_password_revokes_old_token(session):
    headers, old_token = session

    wrong = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": "wrongpass", "new_password": "newpassword123"},
    )
    assert wrong.status_code == 400

    ok = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": "password123", "new_password": "newpassword123"},
    )
    assert ok.status_code == 200
    new_token = ok.json()["access_token"]
    assert new_token != old_token

    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old_token}"}).status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200
