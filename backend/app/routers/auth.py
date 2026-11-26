from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.rate_limit import rate_limit
from app.services.user_store import authenticate_user, create_access_token, create_user, verify_access_token

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
    return AuthResponse(access_token=token, user={"id": user["id"], "email": user["email"]})


@router.post("/login", response_model=AuthResponse)
def login(req: AuthRequest):
    user = authenticate_user(str(req.email), req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user)
    return AuthResponse(access_token=token, user={"id": user["id"], "email": user["email"]})


@router.get("/me", response_model=MeResponse)
def me(user: dict = Depends(_current_user)):
    return MeResponse(user={"id": user["id"], "email": user["email"]})
