from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles


def create_app(
    *,
    capability_token: str,
    instance_id: str,
    port: int,
    static_root: Path,
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

    def secured(response: Response) -> Response:
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'; img-src 'self' data:; object-src 'none'; "
            "script-src 'self'; style-src 'self'"
        )
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.middleware("http")
    async def protect_local_interface(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        client_host = request.client.host if request.client else ""
        if client_host != "127.0.0.1":
            return secured(
                JSONResponse({"detail": "Loopback access required."}, status_code=403)
            )

        if request.headers.get("host") != expected_host:
            return secured(
                JSONResponse({"detail": "Invalid local host."}, status_code=400)
            )

        origin = request.headers.get("origin")
        if origin is not None and origin != expected_origin:
            return secured(
                JSONResponse({"detail": "Cross-origin access denied."}, status_code=403)
            )

        is_bootstrap = request.url.path.startswith("/bootstrap/")
        if not is_bootstrap:
            supplied_token = request.headers.get(
                "x-whitebook-token"
            ) or request.cookies.get("whitebook_capability")
            if supplied_token is None or not secrets.compare_digest(
                supplied_token, capability_token
            ):
                return secured(
                    JSONResponse({"detail": "Capability required."}, status_code=401)
                )

        response = await call_next(request)
        return secured(response)

    @app.get("/bootstrap/{presented_token}")
    async def bootstrap(presented_token: str) -> Response:
        if not secrets.compare_digest(presented_token, capability_token):
            return JSONResponse({"detail": "Capability required."}, status_code=401)
        response = RedirectResponse("/app/", status_code=303)
        response.set_cookie(
            "whitebook_capability",
            capability_token,
            httponly=True,
            samesite="strict",
        )
        return response

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {
            "instanceId": instance_id,
            "product": "Whitebook",
            "status": "ready",
            "storage": "ready"
            if (storage_root / "whitebook.sqlite3").exists()
            else "missing",
        }

    if static_root.is_dir():
        assets_root = static_root / "assets"
        if assets_root.is_dir():
            app.mount("/app/assets", StaticFiles(directory=assets_root), name="assets")

        @app.get("/app/")
        async def shell() -> FileResponse:
            return FileResponse(static_root / "index.html")

    return app
