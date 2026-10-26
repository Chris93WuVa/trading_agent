"""Passwort-Hashing (scrypt), signierte Sitzungs-Cookies und Login-Drosselung.

Passwort-Hash erzeugen::

    python -m app.auth
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import hmac
import json
import secrets
import threading
import time

COOKIE_NAME = "tb_session"
_N, _R, _P = 2**15, 8, 1


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=64 * 1024 * 1024)
    return f"scrypt:{_N}:{_R}:{_P}:{_b64(salt)}:{_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split(":")
        if algo != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r),
                                   p=int(p), maxmem=64 * 1024 * 1024)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, _unb64(digest))


def create_session(secret: str, days: int) -> str:
    payload = _b64(json.dumps({"exp": int(time.time()) + days * 86400,
                               "nonce": secrets.token_hex(8)}).encode())
    sig = _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_session(token: str | None, secret: str) -> bool:
    if not token or "." not in token:
        return False
    payload, sig = token.rsplit(".", 1)
    expected = _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        return json.loads(_unb64(payload))["exp"] > time.time()
    except (ValueError, KeyError):
        return False


class LoginThrottle:
    """Höchstens ``attempts`` Fehlversuche je IP innerhalb von ``window`` Sekunden."""

    def __init__(self, attempts: int = 5, window: int = 900) -> None:
        self.attempts, self.window = attempts, window
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def blocked(self, ip: str) -> bool:
        now = time.time()
        with self._lock:
            recent = [t for t in self._fails.get(ip, []) if now - t < self.window]
            self._fails[ip] = recent
            return len(recent) >= self.attempts

    def fail(self, ip: str) -> None:
        with self._lock:
            self._fails.setdefault(ip, []).append(time.time())

    def reset(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)


if __name__ == "__main__":
    first = getpass.getpass("Neues Dashboard-Passwort: ")
    if len(first) < 10:
        raise SystemExit("Bitte mindestens 10 Zeichen verwenden.")
    if getpass.getpass("Wiederholen: ") != first:
        raise SystemExit("Passwörter stimmen nicht überein.")
    print(hash_password(first))
