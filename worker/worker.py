"""Background worker process entrypoint.

Phase 1: placeholder that just confirms it can reach the DB/Redis config.
Phase 3 will add the APScheduler-driven bot loop here (see architecture notes
in the project README - one scheduled job per active bot, guarded by a Redis
lock so multiple worker replicas never evaluate the same bot concurrently).
"""
import logging
import time

from app.config import get_settings
from app.core.logging import configure_logging

configure_logging()
logger = logging.getLogger("worker")


def main() -> None:
    settings = get_settings()
    logger.info("Worker starting up (environment=%s)", settings.environment)
    logger.info("No bots to run yet - bot execution loop arrives in Phase 3.")
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
