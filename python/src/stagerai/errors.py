from typing import Any, Optional


class StagerError(Exception):
    """Base class for every error raised by the SDK."""


class StagerApiError(StagerError):
    """The API answered with a non-2xx status."""

    def __init__(self, message: str, status: int, body: Any = None, code_key: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.body = body
        self.code_key = code_key


class StagerProcessingError(StagerError):
    """An HDR group, AI edit or video render finished with an error."""

    def __init__(self, message: str, result: Any = None, code: Optional[int] = None):
        super().__init__(message)
        self.result = result
        self.code = code


class StagerTimeoutError(StagerError):
    """A wait_* helper ran out of time."""
