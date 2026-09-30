"""Cloudflare D1 client.

D1 has no TCP wire protocol / DBAPI driver - it's reached over HTTPS via Cloudflare's
REST API. Authentication reuses the developer's existing `wrangler login` session
(its OAuth access token, stored in the wrangler config file) rather than a separately
provisioned API token, so local dev needs no extra setup beyond `wrangler login`.

That access token is short-lived (~1 hour) and wrangler refreshes it transparently
whenever the CLI runs. This client mirrors that: it reads the token straight from the
config file, and if the token is expired (or the file is stale), it shells out to a
lightweight wrangler command once to force a refresh, then re-reads. In between
refreshes, every query is a single plain HTTPS call - no subprocess - which is what
keeps request latency low.
"""
import logging
import subprocess
import time
import tomllib
from pathlib import Path
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_WRANGLER_CONFIG_CANDIDATES = [
    Path.home() / "AppData/Roaming/xdg.config/.wrangler/config/default.toml",
    Path.home() / ".wrangler/config/default.toml",
    Path.home() / ".config/.wrangler/config/default.toml",
]


class D1Error(Exception):
    pass


def _find_wrangler_config() -> Path:
    for candidate in _WRANGLER_CONFIG_CANDIDATES:
        if candidate.exists():
            return candidate
    raise D1Error(
        "Could not find a wrangler config file - run `npx wrangler login` in the project root."
    )


class D1Client:
    def __init__(self, account_id: str, database_id: str):
        self.account_id = account_id
        self.database_id = database_id
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._http = httpx.Client(timeout=15.0)

    def _read_token_from_config(self) -> tuple[str, float]:
        config_path = _find_wrangler_config()
        with config_path.open("rb") as f:
            data = tomllib.load(f)
        token = data.get("oauth_token")
        expiration = data.get("expiration_time")
        if not token:
            raise D1Error("wrangler config has no oauth_token - run `npx wrangler login`.")

        expires_at = time.time() + 3600  # conservative fallback
        if expiration:
            from datetime import datetime, timezone

            try:
                expires_at = datetime.fromisoformat(expiration.replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
        return token, expires_at

    def _refresh_via_wrangler(self) -> None:
        """Forces wrangler to refresh its stored OAuth token by running a cheap command."""
        try:
            subprocess.run(
                ["npx", "wrangler", "whoami"],
                capture_output=True, text=True, shell=True, timeout=60,
            )
        except subprocess.TimeoutExpired as exc:
            raise D1Error("Timed out refreshing Cloudflare credentials via wrangler.") from exc

    def _get_token(self) -> str:
        now = time.time()
        # Refresh a bit before actual expiry to avoid racing a request against it.
        if self._token is None or now > self._token_expires_at - 60:
            token, expires_at = self._read_token_from_config()
            if now > expires_at - 60:
                self._refresh_via_wrangler()
                token, expires_at = self._read_token_from_config()
            self._token = token
            self._token_expires_at = expires_at
        return self._token

    def execute(self, sql: str) -> list[dict[str, Any]]:
        """Runs one fully-formed SQL statement (values already escaped via `sql_quote`,
        since parameter binding isn't wired up here) and returns its result rows."""
        token = self._get_token()
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}"
            f"/d1/database/{self.database_id}/query"
        )
        try:
            response = self._http.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json={"sql": sql},
            )
        except httpx.HTTPError as exc:
            raise D1Error(f"D1 request failed: {exc}") from exc

        if response.status_code == 401:
            # Token might have just been invalidated - refresh once and retry.
            self._token = None
            token = self._get_token()
            response = self._http.post(
                url, headers={"Authorization": f"Bearer {token}"}, json={"sql": sql}
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise D1Error(f"Could not parse D1 response: {response.text[:500]}") from exc

        if not payload.get("success", False):
            logger.error("D1 query failed (query text suppressed - may contain sensitive data)")
            raise D1Error(f"D1 query did not succeed: {payload.get('errors')}")

        result = payload.get("result") or []
        if not result:
            return []
        return result[0].get("results", [])


_client: D1Client | None = None


def get_d1_client() -> D1Client:
    global _client
    if _client is None:
        settings = get_settings()
        _client = D1Client(settings.cloudflare_account_id, settings.cloudflare_d1_database_id)
    return _client
