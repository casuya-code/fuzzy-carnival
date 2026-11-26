from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.config import EXPOSE_RESET_TOKENS
from app.rate_limit import rate_limit
from app.services.mailer import send_password_reset_email
from app.services.user_store import (
    authenticate_user,
    bump_token_version,
    create_access_token,
    create_password_reset,
    create_user,
    reset_password,
    verify_access_token,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"], dependencies=[Depends(rate_limit)])


class AuthRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Valid email is required")
        return v


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Valid email is required")
        return v


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=16, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class MeResponse(BaseModel):
    user: dict


def _current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization[7:].strip()
    user = verify_access_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


@router.post("/signup", response_model=AuthResponse)
def signup(req: AuthRequest):
    try:
        user = create_user(str(req.email), req.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    token = create_access_token(user)
    return AuthResponse(access_token=token, user=user)


@router.post("/login", response_model=AuthResponse)
def login(req: AuthRequest):
    try:
        user = authenticate_user(str(req.email), req.password)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user)
    return AuthResponse(access_token=token, user=user)


@router.get("/me", response_model=MeResponse)
def me(user: dict = Depends(_current_user)):
    return MeResponse(user=user)


@router.post("/logout-all")
def logout_all(user: dict = Depends(_current_user)):
    bump_token_version(int(user["id"]))
    return {"ok": True}


@router.post("/password-reset/request")
def password_reset_request(req: PasswordResetRequest):
    result = create_password_reset(str(req.email))
    # Avoid account enumeration. Return token only in explicitly enabled dev mode.
    resp = {"ok": True, "message": "If the account exists, a password reset token was created."}
    if result:
        send_password_reset_email(result["email"], result["reset_token"])
        if EXPOSE_RESET_TOKENS:
            resp["reset_token"] = result["reset_token"]
            resp["expires_in_sec"] = result["expires_in_sec"]
    return resp


@router.post("/password-reset/confirm")
def password_reset_confirm(req: PasswordResetConfirm):
    try:
        ok = reset_password(req.token, req.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    return {"ok": True}
