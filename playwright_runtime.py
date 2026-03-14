from __future__ import annotations

import os
import sys
from typing import Any


def bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def has_display() -> bool:
    return bool(os.environ.get("DISPLAY") or sys.platform == "darwin")


def launch_browser(
    playwright: Any,
    *,
    headless_env: str,
    default_headless: bool | None = None,
    proxy_env: str = "TRF1_PROXY_URL",
    ws_env: str = "TRF1_PLAYWRIGHT_WS_ENDPOINT",
    cdp_env: str = "TRF1_PLAYWRIGHT_CDP_URL",
) -> Any:
    ws_endpoint = os.environ.get(ws_env, "").strip()
    if ws_endpoint:
        return playwright.chromium.connect(ws_endpoint)

    cdp_endpoint = os.environ.get(cdp_env, "").strip()
    if cdp_endpoint:
        return playwright.chromium.connect_over_cdp(cdp_endpoint)

    if default_headless is None:
        default_headless = not has_display()

    launch_args: dict[str, Any] = {
        "headless": bool_env(headless_env, default_headless),
    }
    proxy_url = os.environ.get(proxy_env, "").strip()
    if proxy_url:
        launch_args["proxy"] = {"server": proxy_url}
    return playwright.chromium.launch(**launch_args)
