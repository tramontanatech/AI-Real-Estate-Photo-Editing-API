"""Verify webhooks sent by Stager AI (X-Stager-Signature / X-Stager-Timestamp)."""

import hashlib
import hmac
import json
import time
from typing import Any, Dict, Mapping, Optional, Union

from .errors import StagerError

RawBody = Union[str, bytes]


def _to_bytes(raw_body: RawBody) -> bytes:
    return raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body


def _header(headers: Mapping[str, str], name: str) -> Optional[str]:
    getter = getattr(headers, "get", None)
    value = getter(name) if getter else None
    if value is None:
        for key, v in headers.items():
            if key.lower() == name.lower():
                return v
    return value


def sign_webhook(raw_body: RawBody, timestamp: str, secret: str) -> str:
    """Returns the ``sha256=<hex>`` signature for a raw body and timestamp."""
    message = timestamp.encode("utf-8") + b"." + _to_bytes(raw_body)
    return "sha256=" + hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def is_valid_webhook_signature(
    raw_body: RawBody,
    headers: Mapping[str, str],
    secret: str,
    tolerance_ms: int = 5 * 60 * 1000,
    now_ms: Optional[int] = None,
) -> bool:
    """Checks the signature. Pass the raw request body, before JSON parsing.

    Events older than ``tolerance_ms`` are rejected; pass 0 to skip that check.
    """
    signature = _header(headers, "X-Stager-Signature")
    timestamp = _header(headers, "X-Stager-Timestamp")
    if not signature or not timestamp:
        return False
    if tolerance_ms > 0:
        try:
            sent_at = int(timestamp)
        except ValueError:
            return False
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        if abs(now - sent_at) > tolerance_ms:
            return False
    return hmac.compare_digest(sign_webhook(raw_body, timestamp, secret), signature)


def construct_webhook_event(
    raw_body: RawBody,
    headers: Mapping[str, str],
    secret: str,
    tolerance_ms: int = 5 * 60 * 1000,
    now_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """Verifies the signature and returns the parsed event, or raises StagerError."""
    if not is_valid_webhook_signature(raw_body, headers, secret, tolerance_ms, now_ms):
        raise StagerError("Invalid Stager AI webhook signature")
    return json.loads(_to_bytes(raw_body))
