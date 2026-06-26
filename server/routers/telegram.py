import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from config import TELEGRAM_BOT_USERNAME
from db import get_db
from models import TelegramLinkToken, TelegramUser, User

router = APIRouter(tags=["telegram"])

_TOKEN_TTL_MINUTES = 5


def _generate_token() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(6))


class LinkTokenOut(BaseModel):
    token: str
    expires_in_seconds: int
    bot_username: str
    instructions: str


class TelegramStatusOut(BaseModel):
    linked: bool
    chat_id: Optional[str] = None
    linked_at: Optional[datetime] = None


@router.post(
    "/telegram/link-token",
    summary="Generar token de vinculación con Telegram",
    description="""
**¿Qué hace?**
Genera un token de un solo uso (6 caracteres, válido 5 minutos) para vincular
la cuenta del usuario con el bot de Telegram.

**¿Para qué?**
Permite al usuario recibir alertas de sus organizaciones directamente en Telegram,
sin compartir contraseñas ni tokens de sesión.

**¿Dónde se usa?**
Botón "Vincular Telegram" en el perfil de usuario del dashboard.
El usuario copia el token y escribe `/vincular TOKEN` al bot.
""",
    response_model=LinkTokenOut,
    responses={
        401: {"description": "Token de sesión ausente o expirado"},
    },
)
def create_link_token(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LinkTokenOut:
    token = _generate_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_TOKEN_TTL_MINUTES)

    db.add(TelegramLinkToken(
        token=token,
        user_id=current_user.id,
        expires_at=expires_at,
    ))
    db.commit()

    bot = f"@{TELEGRAM_BOT_USERNAME}" if TELEGRAM_BOT_USERNAME else "el bot"
    return LinkTokenOut(
        token=token,
        expires_in_seconds=_TOKEN_TTL_MINUTES * 60,
        bot_username=TELEGRAM_BOT_USERNAME,
        instructions=f"Abre {bot} en Telegram y escribe: /vincular {token}",
    )


@router.get(
    "/telegram/status",
    summary="Estado de vinculación Telegram del usuario",
    description="""
**¿Qué hace?**
Indica si el usuario tiene una cuenta de Telegram vinculada.

**¿Para qué?**
El dashboard muestra el botón "Vincular" o "Desvincular" según el estado.

**¿Dónde se usa?**
Sección de Telegram en el perfil de usuario.
""",
    response_model=TelegramStatusOut,
    responses={
        401: {"description": "Token de sesión ausente o expirado"},
    },
)
def get_telegram_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TelegramStatusOut:
    tg = db.query(TelegramUser).filter(TelegramUser.user_id == current_user.id).first()
    if not tg:
        return TelegramStatusOut(linked=False)
    return TelegramStatusOut(linked=True, chat_id=tg.chat_id, linked_at=tg.linked_at)


@router.delete(
    "/telegram/link",
    summary="Desvincular cuenta de Telegram",
    description="""
**¿Qué hace?**
Elimina la vinculación entre la cuenta del usuario y su chat de Telegram.

**¿Para qué?**
Alternativa al comando `/desvincular` del bot, accesible desde el dashboard.

**¿Dónde se usa?**
Sección de Telegram en el perfil de usuario.
""",
    status_code=204,
    responses={
        401: {"description": "Token de sesión ausente o expirado"},
        404: {"description": "No hay vinculación activa para este usuario"},
    },
)
def delete_telegram_link(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    tg = db.query(TelegramUser).filter(TelegramUser.user_id == current_user.id).first()
    if not tg:
        raise HTTPException(status_code=404, detail="No hay vinculación activa")
    db.delete(tg)
    db.commit()
