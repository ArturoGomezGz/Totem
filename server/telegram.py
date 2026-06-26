import logging
from datetime import datetime, timezone

import requests

from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

logger = logging.getLogger(__name__)


def send_message(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("Telegram no configurado — TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID ausente")
        return False

    try:
        res = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        if res.ok:
            print(f"[telegram] mensaje enviado ok")
            return True
        print(f"[telegram] error API: {res.status_code} {res.text}")
        return False
    except Exception as e:
        print(f"[telegram] excepcion: {e}")
        return False


def notify_alert(unit_name: str, alert_type: str, severity: str, message: str | None) -> bool:
    icon = "🔴" if severity == "critical" else "🟡"
    lines = [
        f"{icon} <b>Alerta {severity.upper()}</b>",
        f"<b>Unidad:</b> {unit_name}",
        f"<b>Tipo:</b> {alert_type}",
    ]
    if message:
        lines.append(f"<b>Detalle:</b> {message}")
    lines.append(f"<i>{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</i>")

    return send_message("\n".join(lines))
