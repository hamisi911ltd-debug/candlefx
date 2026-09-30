import logging
import sys

from app.config import get_settings

_SENSITIVE_KEYS = {"password", "api_key", "api_secret", "secret", "token", "encrypted_api_key", "encrypted_api_secret"}


class RedactSensitiveFilter(logging.Filter):
    """Best-effort guard: drop log records whose message text contains obvious secret markers.

    This does not replace disciplined logging (never pass secrets into log calls) -
    it's a last-resort net.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        msg = str(record.getMessage()).lower()
        if any(key in msg for key in _SENSITIVE_KEYS):
            record.msg = "[redacted log message containing sensitive-looking content]"
            record.args = ()
        return True


def configure_logging() -> None:
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactSensitiveFilter())
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)s %(name)s :: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())
