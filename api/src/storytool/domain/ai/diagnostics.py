"""Bounded assistant-response logs without credentials or request payloads."""

import json
import logging
import re
from typing import Any

logger = logging.getLogger("storytool.ai")


def response_log(event: str, **fields: Any) -> None:
    # Single-line JSON also escapes control characters from model-generated text.
    payload = json.dumps(fields, default=str, ensure_ascii=True)
    payload = re.sub(r"sk-[A-Za-z0-9_-]+", "[REDACTED_API_KEY]", payload)
    payload = re.sub(r"Bearer\s+[A-Za-z0-9._-]+", "Bearer [REDACTED]", payload)
    logger.info("%s %s", event, payload)
