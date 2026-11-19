"""Official Python SDK for the Stager AI real estate photo editing API.

HDR bracket merging, virtual staging, virtual renovation, sky and lawn
replacement, decluttering and listing videos. Docs: https://stagerai.com/api-docs
"""

from .client import (
    DEFAULT_BASE_URL,
    CameraMotion,
    EditingStyle,
    FileInput,
    HdrErrorCode,
    StagerAI,
    VideoEffect,
    content_type_for,
)
from .errors import StagerApiError, StagerError, StagerProcessingError, StagerTimeoutError
from .webhooks import construct_webhook_event, is_valid_webhook_signature, sign_webhook

__version__ = "1.0.0"

__all__ = [
    "StagerAI",
    "DEFAULT_BASE_URL",
    "FileInput",
    "EditingStyle",
    "HdrErrorCode",
    "VideoEffect",
    "CameraMotion",
    "content_type_for",
    "StagerError",
    "StagerApiError",
    "StagerProcessingError",
    "StagerTimeoutError",
    "is_valid_webhook_signature",
    "construct_webhook_event",
    "sign_webhook",
]
