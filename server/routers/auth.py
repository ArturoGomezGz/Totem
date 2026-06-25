import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

import auth as auth_utils
from db import get_db
from models import RefreshToken, User

router = APIRouter(tags=["auth"])


# ---------- Schemas ----------

class RegisterIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str
    refresh_token: str


class AccessTokenOut(BaseModel):
    access_token: str
    token_type: str


class RefreshIn(BaseModel):
    refresh_token: str


# ---------- Endpoints ----------

@router.post(
    "/auth/register",
    summary="Registrar un usuario nuevo",
    description="""
**¿Qué hace?**
Crea una cuenta de usuario con email y contraseña. El email debe ser único en el sistema.

**¿Para qué?**
Es el primer paso para acceder al sistema. Tras el registro, el usuario debe hacer login
para obtener un token y luego crear o unirse a una organización.

**¿Dónde se usa?**
Pantalla de registro (onboarding).
""",
    response_model=UserOut,
    status_code=201,
    responses={
        409: {"description": "El email ya está registrado"},
    },
)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="El email ya está registrado")

    user = User(
        email=body.email,
        password_hash=auth_utils.hash_password(body.password),
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post(
    "/auth/login",
    summary="Iniciar sesión y obtener tokens",
    description="""
**¿Qué hace?**
Verifica las credenciales del usuario y devuelve un access token JWT (duración: 1 h)
y un refresh token de larga duración (30 días) para renovarlo sin re-autenticarse.

**¿Para qué?**
Autentica al usuario para que pueda acceder a todos los endpoints protegidos.

**¿Dónde se usa?**
Pantalla de login.
""",
    response_model=TokenOut,
    responses={
        401: {"description": "Email o contraseña incorrectos"},
    },
)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not auth_utils.verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

    access_token = auth_utils.create_access_token(str(user.id))
    refresh_token = auth_utils.create_refresh_token(str(user.id), db)

    return TokenOut(
        access_token=access_token,
        token_type="bearer",
        refresh_token=refresh_token,
    )


@router.post(
    "/auth/refresh",
    summary="Renovar el access token",
    description="""
**¿Qué hace?**
Valida el refresh token enviado y emite un nuevo access token JWT sin requerir
las credenciales del usuario.

**¿Para qué?**
Permite mantener la sesión activa sin que el usuario tenga que volver a loguearse
cada hora cuando el access token expira.

**¿Dónde se usa?**
Llamado automáticamente por el cliente cuando detecta un 401 por token expirado.
""",
    response_model=AccessTokenOut,
    responses={
        401: {"description": "Refresh token inválido, expirado o revocado"},
    },
)
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    token_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()
    stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()

    if not stored:
        raise HTTPException(status_code=401, detail="Refresh token inválido")
    if stored.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Refresh token revocado")
    if stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expirado")

    access_token = auth_utils.create_access_token(str(stored.user_id))
    return AccessTokenOut(access_token=access_token, token_type="bearer")
