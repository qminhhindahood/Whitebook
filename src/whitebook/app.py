from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response


def create_app(
    *,
    capability_token: str,
    instance_id: str,
    port: int,
    storage_root: Path,
) -> FastAPI:
    app = FastAPI(
        title="Whitebook",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    expected_host = f"127.0.0.1:{port}"
    expected_origin = f"http://{expected_host}"

    @app.middleware("http")
    async def protect_local_interface(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        client_host = request.client.host if request.client else ""
        if client_host != "127.0.0.1":
            return JSONResponse({"detail": "Loopback access required."}, status_code=403)

        if request.headers.get("host") != expected_host:
            return JSONResponse({"detail": "Invalid local host."}, status_code=400)

        origin = request.headers.get("origin")
        if origin is not None and origin != expected_origin:
            return JSONResponse({"detail": "Cross-origin access denied."}, status_code=403)

        supplied_token = request.headers.get("x-whitebook-token") or request.cookies.get(
            "whitebook_capability"
        )
        if supplied_token != capability_token:
            return JSONResponse({"detail": "Capability required."}, status_code=401)

        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {
            "instanceId": instance_id,
            "product": "Whitebook",
            "status": "ready",
            "storage": "ready" if (storage_root / "whitebook.sqlite3").exists() else "missing",
        }

    return app

