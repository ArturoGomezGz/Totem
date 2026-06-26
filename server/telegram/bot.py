import threading
from datetime import datetime, timezone

from db import SessionLocal
from models import TelegramLinkToken, TelegramUser
from .api import get_updates, send

_stop_event = threading.Event()
_POLL_INTERVAL = 3  # segundos


# ============================================================
# Handlers de comandos
# ============================================================

def _handle_vincular(chat_id: str, text: str) -> None:
    parts = text.split()
    if len(parts) < 2:
        send(chat_id, "Uso: <code>/vincular TOKEN</code>\nObtén tu token desde el dashboard.")
        return

    token = parts[1].upper().strip()
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        link_token = (
            db.query(TelegramLinkToken)
            .filter(
                TelegramLinkToken.token == token,
                TelegramLinkToken.expires_at > now,
                TelegramLinkToken.used_at.is_(None),
            )
            .first()
        )

        if not link_token:
            send(chat_id, "❌ Token inválido o expirado. Genera uno nuevo desde el dashboard.")
            return

        existing = db.query(TelegramUser).filter(TelegramUser.user_id == link_token.user_id).first()
        if existing:
            existing.chat_id = chat_id
            existing.linked_at = now
        else:
            db.add(TelegramUser(user_id=link_token.user_id, chat_id=chat_id, linked_at=now))

        link_token.used_at = now
        db.commit()
        send(chat_id, "✅ <b>Cuenta vinculada correctamente.</b>\nRecibirás alertas de tus organizaciones en este chat.")

    except Exception as e:
        db.rollback()
        print(f"[telegram/bot] error en /vincular: {e}")
        send(chat_id, "❌ Error interno. Intenta de nuevo.")
    finally:
        db.close()


def _handle_desvincular(chat_id: str) -> None:
    db = SessionLocal()
    try:
        tg_user = db.query(TelegramUser).filter(TelegramUser.chat_id == chat_id).first()
        if not tg_user:
            send(chat_id, "No tienes ninguna cuenta vinculada a este chat.")
            return
        db.delete(tg_user)
        db.commit()
        send(chat_id, "✅ Cuenta desvinculada. Ya no recibirás alertas en este chat.")
    except Exception as e:
        db.rollback()
        print(f"[telegram/bot] error en /desvincular: {e}")
        send(chat_id, "❌ Error interno. Intenta de nuevo.")
    finally:
        db.close()


def _handle_update(update: dict) -> None:
    message = update.get("message", {})
    text = message.get("text", "").strip()
    chat_id = str(message.get("chat", {}).get("id", ""))

    if not text or not chat_id:
        return

    if text.lower().startswith("/vincular"):
        _handle_vincular(chat_id, text)
    elif text.lower().startswith("/desvincular"):
        _handle_desvincular(chat_id)


# ============================================================
# Polling loop
# ============================================================

def _poll_loop() -> None:
    offset = 0
    while not _stop_event.is_set():
        updates = get_updates(offset)
        for update in updates:
            offset = update["update_id"] + 1
            try:
                _handle_update(update)
            except Exception as e:
                print(f"[telegram/bot] error procesando update: {e}")
        _stop_event.wait(_POLL_INTERVAL)


def start_polling() -> None:
    _stop_event.clear()
    t = threading.Thread(target=_poll_loop, daemon=True, name="telegram-polling")
    t.start()
    print(f"[telegram/bot] polling iniciado (cada {_POLL_INTERVAL}s)")


def stop_polling() -> None:
    _stop_event.set()
    print("[telegram/bot] polling detenido")
