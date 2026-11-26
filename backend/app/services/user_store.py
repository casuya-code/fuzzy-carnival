from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

from app.config import APP_DB_PATH, AUTH_SECRET, AUTH_TOKEN_TTL_HOURS


RESET_TOKEN_TTL_SEC = 3600
MAX_FAILED_LOGINS = 10
LOCKOUT_SEC = 15 * 60
MAX_AVATAR_BYTES = 1_000_000


def _db_path() -> Path:
    p = Path(APP_DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        _ensure_column(conn, "users", "role", "role TEXT NOT NULL DEFAULT 'user'")
        _ensure_column(conn, "users", "token_version", "token_version INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "users", "failed_logins", "failed_logins INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "users", "locked_until", "locked_until INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "users", "name", "name TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "users", "phone", "phone TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "users", "avatar", "avatar TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id)")
        conn.commit()


def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return f"pbkdf2_sha256${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$", 2)
        if scheme != "pbkdf2_sha256":
            return False
        candidate = _hash_password(password, salt)
        return hmac.compare_digest(candidate, stored)
    except Exception:
        return False


def _field(row: sqlite3.Row | dict[str, Any], key: str, default: Any = "") -> Any:
    if isinstance(row, dict):
        return row.get(key, default)
    try:
        return row[key]
    except (IndexError, KeyError):
        return default


def _public_user(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "email": str(row["email"]),
        "role": str(_field(row, "role", "user") or "user"),
        "created_at": int(row["created_at"]),
        "name": str(_field(row, "name", "") or ""),
        "phone": str(_field(row, "phone", "") or ""),
        "avatar": str(_field(row, "avatar", "") or ""),
    }


def create_user(email: str, password: str) -> dict[str, Any]:
    init_db()
    email_n = email.strip().lower()
    if not email_n or "@" not in email_n:
        raise ValueError("Valid email is required")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    pw_hash = _hash_password(password)
    now = int(time.time())
    try:
        with _connect() as conn:
            cur = conn.execute(
                "INSERT INTO users (email, password_hash, created_at, role, token_version, failed_logins, locked_until) VALUES (?, ?, ?, 'user', 0, 0, 0)",
                (email_n, pw_hash, now),
            )
            conn.commit()
            uid = int(cur.lastrowid)
            row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    except sqlite3.IntegrityError as e:
        raise ValueError("Email already registered") from e
    return _public_user(row)


def _is_locked(row: sqlite3.Row) -> bool:
    return int(row["locked_until"] or 0) > int(time.time())


def authenticate_user(email: str, password: str) -> dict[str, Any] | None:
    init_db()
    email_n = email.strip().lower()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email_n,)).fetchone()
        if not row:
            return None
        if _is_locked(row):
            raise ValueError("Account temporarily locked. Try again later.")
        if not verify_password(password, row["password_hash"]):
            failed = int(row["failed_logins"] or 0) + 1
            locked_until = int(time.time()) + LOCKOUT_SEC if failed >= MAX_FAILED_LOGINS else int(row["locked_until"] or 0)
            conn.execute("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?", (failed, locked_until, int(row["id"])))
            conn.commit()
            return None
        conn.execute("UPDATE users SET failed_logins=0, locked_until=0 WHERE id=?", (int(row["id"]),))
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id = ?", (int(row["id"]),)).fetchone()
    return _public_user(row)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def create_access_token(user: dict[str, Any]) -> str:
    init_db()
    now = int(time.time())
    with _connect() as conn:
        row = conn.execute("SELECT token_version, role FROM users WHERE id = ?", (int(user["id"]),)).fetchone()
    tv = int(row["token_version"]) if row else 0
    role = str(row["role"]) if row else str(user.get("role", "user"))
    payload = {
        "uid": int(user["id"]),
        "email": user["email"],
        "role": role,
        "tv": tv,
        "iat": now,
        "exp": now + AUTH_TOKEN_TTL_HOURS * 3600,
        "jti": secrets.token_hex(8),
    }
    body = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = hmac.new(AUTH_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(sig)}"


def verify_access_token(token: str) -> dict[str, Any] | None:
    try:
        body, sig = token.split(".", 1)
        expected = hmac.new(AUTH_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_encode(expected), sig):
            return None
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        uid = int(payload["uid"])
        email = str(payload["email"]).lower()
        init_db()
        with _connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not row or str(row["email"]).lower() != email:
            return None
        if int(payload.get("tv", -1)) != int(row["token_version"]):
            return None
        return _public_user(row)
    except Exception:
        return None


def bump_token_version(user_id: int) -> None:
    init_db()
    with _connect() as conn:
        conn.execute("UPDATE users SET token_version = token_version + 1 WHERE id = ?", (int(user_id),))
        conn.commit()


def create_password_reset(email: str) -> dict[str, Any] | None:
    init_db()
    email_n = email.strip().lower()
    with _connect() as conn:
        row = conn.execute("SELECT id, email FROM users WHERE email = ?", (email_n,)).fetchone()
        if not row:
            return None
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = int(time.time())
        conn.execute(
            "INSERT INTO password_resets (user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, 0, ?)",
            (int(row["id"]), token_hash, now + RESET_TOKEN_TTL_SEC, now),
        )
        conn.commit()
    return {"email": str(row["email"]), "reset_token": token, "expires_in_sec": RESET_TOKEN_TTL_SEC}


def reset_password(token: str, new_password: str) -> bool:
    init_db()
    if len(new_password) < 8:
        raise ValueError("Password must be at least 8 characters")
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = int(time.time())
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at = 0 AND expires_at >= ? ORDER BY id DESC LIMIT 1",
            (token_hash, now),
        ).fetchone()
        if not row:
            return False
        pw_hash = _hash_password(new_password)
        conn.execute("UPDATE users SET password_hash=?, failed_logins=0, locked_until=0, token_version=token_version+1 WHERE id=?", (pw_hash, int(row["user_id"])))
        conn.execute("UPDATE password_resets SET used_at=? WHERE id=?", (now, int(row["id"])))
        conn.commit()
    return True


def count_users() -> int:
    """Public aggregate count of registered accounts (no personal data)."""
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()
    return int(row["n"])


def get_user(user_id: int) -> dict[str, Any] | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
    return _public_user(row) if row else None


def _validated_avatar(avatar: str | None) -> str:
    if not avatar:
        return ""
    value = avatar.strip()
    if not value.startswith("data:image/") or ";base64," not in value:
        raise ValueError("Profile image must be a base64 image data URL")
    encoded = value.split(";base64,", 1)[1]
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as e:
        raise ValueError("Invalid profile image data") from e
    if not raw or len(raw) > MAX_AVATAR_BYTES:
        raise ValueError("Profile image is too large")
    return value


def update_profile(
    user_id: int,
    name: str | None = None,
    phone: str | None = None,
    avatar: str | None = None,
) -> dict[str, Any]:
    init_db()
    if name is None and phone is None and avatar is None:
        raise ValueError("No profile fields provided")
    if name is not None and len(name.strip()) > 80:
        raise ValueError("Name must be at most 80 characters")
    if phone is not None and len(phone.strip()) > 32:
        raise ValueError("Phone number must be at most 32 characters")
    avatar_value = _validated_avatar(avatar) if avatar is not None else None
    with _connect() as conn:
        updates: list[str] = []
        values: list[Any] = []
        if name is not None:
            updates.append("name = ?")
            values.append(name.strip())
        if phone is not None:
            updates.append("phone = ?")
            values.append(phone.strip())
        if avatar_value is not None:
            updates.append("avatar = ?")
            values.append(avatar_value)
        values.append(int(user_id))
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
    return _public_user(row)


def change_password(user_id: int, current_password: str, new_password: str) -> dict[str, Any]:
    init_db()
    if len(new_password) < 8:
        raise ValueError("Password must be at least 8 characters")
    if hmac.compare_digest(current_password, new_password):
        raise ValueError("New password must be different from the current password")
    with _connect() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (int(user_id),)).fetchone()
        if not row or not verify_password(current_password, row["password_hash"]):
            raise ValueError("Current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash=?, failed_logins=0, locked_until=0, token_version=token_version+1 WHERE id=?",
            (_hash_password(new_password), int(user_id)),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
    return _public_user(updated)
