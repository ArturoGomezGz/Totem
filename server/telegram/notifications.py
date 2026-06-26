from datetime import datetime, timedelta, timezone

from db import SessionLocal
from models import Alert, Membership, TelegramUser, Unit
from .api import send


def _linked_chat_ids_for_org(org_id: str, db) -> list[str]:
    rows = (
        db.query(TelegramUser.chat_id)
        .join(Membership, TelegramUser.user_id == Membership.user_id)
        .filter(Membership.organization_id == org_id)
        .all()
    )
    return [r.chat_id for r in rows]


def _all_linked_chat_ids(db) -> list[str]:
    return [r.chat_id for r in db.query(TelegramUser.chat_id).all()]


def _unit_status_line(unit: Unit) -> str:
    if unit.last_seen and unit.last_seen > datetime.now(timezone.utc) - timedelta(minutes=5):
        minutes_ago = int((datetime.now(timezone.utc) - unit.last_seen).total_seconds() / 60)
        return f"🟢 {unit.name} — hace {minutes_ago} min"
    elif unit.last_seen:
        return f"🔴 {unit.name} — última conexión {unit.last_seen.strftime('%d/%m %H:%M')} UTC"
    else:
        return f"⚫ {unit.name} — sin datos"


# ============================================================
# Notificaciones públicas
# ============================================================

def notify_startup() -> None:
    db = SessionLocal()
    try:
        chat_ids = _all_linked_chat_ids(db)
        if not chat_ids:
            return
        msg = "🟢 <b>Totem Server iniciado</b>"
        for chat_id in chat_ids:
            send(chat_id, msg)
    finally:
        db.close()


def notify_org_status() -> None:
    db = SessionLocal()
    try:
        # Obtener orgs que tienen al menos un usuario con Telegram vinculado
        org_ids = (
            db.query(Membership.organization_id)
            .join(TelegramUser, Membership.user_id == TelegramUser.user_id)
            .distinct()
            .all()
        )

        for (org_id,) in org_ids:
            chat_ids = _linked_chat_ids_for_org(str(org_id), db)
            if not chat_ids:
                continue

            units = db.query(Unit).filter(Unit.organization_id == org_id).all()
            if not units:
                continue

            lines = ["📊 <b>Estado de unidades</b>\n"]
            for unit in units:
                lines.append(_unit_status_line(unit))

            msg = "\n".join(lines)
            for chat_id in chat_ids:
                send(chat_id, msg)
    finally:
        db.close()


def notify_alert(unit_id: str, unit_name: str, alert_type: str, severity: str, message: str | None, org_id: str) -> bool:
    db = SessionLocal()
    try:
        chat_ids = _linked_chat_ids_for_org(org_id, db)
        if not chat_ids:
            return False

        icon = "🔴" if severity == "critical" else "🟡"
        lines = [
            f"{icon} <b>Alerta {severity.upper()}</b>",
            f"<b>Unidad:</b> {unit_name}",
            f"<b>Tipo:</b> {alert_type}",
        ]
        if message:
            lines.append(f"<b>Detalle:</b> {message}")
        lines.append(f"<i>{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</i>")
        msg = "\n".join(lines)

        sent_any = False
        for chat_id in chat_ids:
            if send(chat_id, msg):
                sent_any = True
        return sent_any
    finally:
        db.close()


def notify_message_to_all(text: str) -> None:
    db = SessionLocal()
    try:
        chat_ids = _all_linked_chat_ids(db)
        for chat_id in chat_ids:
            send(chat_id, text)
    finally:
        db.close()
