import requests

from config import TELEGRAM_BOT_TOKEN

_BASE = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


def send(chat_id: str, text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN:
        return False
    try:
        res = requests.post(
            f"{_BASE}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        if res.ok:
            print(f"[telegram/api] mensaje enviado a {chat_id}")
            return True
        print(f"[telegram/api] error {res.status_code}: {res.text}")
        return False
    except Exception as e:
        print(f"[telegram/api] excepcion: {e}")
        return False


def get_updates(offset: int = 0) -> list[dict]:
    if not TELEGRAM_BOT_TOKEN:
        return []
    try:
        res = requests.get(
            f"{_BASE}/getUpdates",
            params={"offset": offset, "timeout": 1},
            timeout=10,
        )
        if res.ok:
            return res.json().get("result", [])
        return []
    except Exception:
        return []
