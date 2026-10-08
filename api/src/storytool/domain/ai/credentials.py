from cryptography.fernet import Fernet, InvalidToken
from litestar.exceptions import ServiceUnavailableException

from storytool.config import get_settings


def cipher() -> Fernet:
    key = get_settings().ai_encryption_key
    if not key:
        raise ServiceUnavailableException(detail="AI credential encryption is not configured")
    try:
        return Fernet(key.encode())
    except ValueError as exc:
        raise ServiceUnavailableException(
            detail="AI credential encryption is misconfigured"
        ) from exc


def encrypt_key(value: str) -> str:
    return cipher().encrypt(value.encode()).decode()


def decrypt_key(value: str) -> str:
    try:
        return cipher().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise ServiceUnavailableException(
            detail="Reconnect this provider: its saved key cannot be read"
        ) from exc
