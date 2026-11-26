"""Profile update and password change API tests."""

import base64

import pytest
from fastapi.testclient import TestClient

from app.main import app

# H13: no blanket import skip. CI has an explicit import gate; if the app cannot
# be imported here, the test suite must fail loudly.
client = TestClient(app)


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

    png = b"\x89PNG\r\n\x1a\n" + b"fake-image"
    avatar = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
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

    jpeg = b"\xff\xd8\xff" + b"x" * 300_001
    too_large = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
    oversized = client.post("/api/v1/auth/profile", headers=headers, json={"avatar": too_large})
    assert oversized.status_code == 400
    assert "300 KB" in oversized.json()["detail"]

    # H7: a valid prefix with an injected suffix must be rejected outright.
    injected = avatar + '");background:url(javascript:alert(1))'
    assert client.post(
        "/api/v1/auth/profile", headers=headers, json={"avatar": injected}
    ).status_code == 400


def test_public_stats_counts_registered_users(session):
    import app.services.user_store as us

    first = client.get("/api/v1/auth/stats")
    assert first.status_code == 200
    assert first.json()["total_users"] == 1

    us.create_user("second@example.com", "password123")
    second = client.get("/api/v1/auth/stats")
    assert second.json()["total_users"] == 2


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
