from __future__ import annotations

import secrets
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from whitebook.answer_csv import blank_answer_csv, example_answer_csv
from whitebook.authoring import AuthoringError, PackageAuthoring


class QuestionRegionInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    page_number: int = Field(alias="pageNumber")
    x: float
    y: float
    width: float
    height: float
    confirmed: bool


class QuestionRegionsInput(BaseModel):
    regions: list[QuestionRegionInput]


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
    authoring = PackageAuthoring(storage_root)

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

    @app.get("/api/answer-csv-template")
    async def answer_csv_template(variant: str = "blank") -> Response:
        if variant == "blank":
            content = blank_answer_csv()
            filename = "whitebook-answer-key.csv"
        elif variant == "example":
            content = example_answer_csv()
            filename = "whitebook-answer-key-example.csv"
        else:
            raise HTTPException(status_code=404, detail="Template variant not found.")
        return Response(
            content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.post("/api/import-drafts", status_code=201)
    async def create_import_draft(
        source_pdf: Annotated[UploadFile, File()],
        answer_csv: Annotated[UploadFile, File()],
        title: Annotated[str | None, Form()] = None,
    ) -> dict[str, object]:
        filename = Path(source_pdf.filename or "Source PDF.pdf").name
        upload_path = (
            storage_root / "runtime" / f"{uuid.uuid4().hex}{Path(filename).suffix}"
        )
        try:
            with upload_path.open("xb") as output:
                while chunk := await source_pdf.read(1024 * 1024):
                    output.write(chunk)
            csv_bytes = await answer_csv.read(10 * 1024 * 1024 + 1)
            draft = authoring.create_import_draft(
                title=title,
                original_filename=filename,
                temporary_pdf=upload_path,
                answer_csv=csv_bytes,
            )
            return draft.as_payload()
        finally:
            upload_path.unlink(missing_ok=True)
            await source_pdf.close()
            await answer_csv.close()

    @app.get("/api/import-drafts/{draft_id}")
    async def get_import_draft(draft_id: str) -> dict[str, object]:
        draft = authoring.get_import_draft(draft_id)
        if draft is None:
            raise HTTPException(status_code=404, detail="Import Draft not found.")
        return draft.as_payload()

    @app.get("/api/import-drafts/{draft_id}/source.pdf")
    async def get_import_draft_source(draft_id: str) -> FileResponse:
        source = authoring.source_pdf(draft_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Source PDF not found.")
        return FileResponse(source, media_type="application/pdf")

    @app.put("/api/import-drafts/{draft_id}/questions/{question_index}/regions")
    async def set_question_regions(
        draft_id: str,
        question_index: int,
        payload: QuestionRegionsInput,
    ) -> dict[str, object]:
        try:
            draft = authoring.set_question_regions(
                draft_id,
                question_index,
                [item.model_dump() for item in payload.regions],
            )
        except AuthoringError as error:
            status_code = 404 if error.code.endswith("not_found") else 409
            if error.code in {"invalid_region", "missing_regions"}:
                status_code = 422
            raise HTTPException(
                status_code=status_code, detail=error.message
            ) from error
        return draft.as_payload()

    @app.post("/api/import-drafts/{draft_id}/publish", status_code=201)
    async def publish_import_draft(draft_id: str) -> dict[str, object]:
        try:
            return authoring.publish(draft_id)
        except AuthoringError as error:
            status_code = 404 if error.code == "draft_not_found" else 409
            raise HTTPException(
                status_code=status_code, detail=error.message
            ) from error

    @app.get("/api/test-packages")
    async def list_test_packages(
        include_archived: bool = False,
    ) -> list[dict[str, object]]:
        return authoring.list_packages(include_archived=include_archived)

    @app.get("/api/test-packages/{package_id}")
    async def get_test_package(package_id: str) -> dict[str, object]:
        package = authoring.get_package(package_id)
        if package is None:
            raise HTTPException(status_code=404, detail="Test Package not found.")
        return package

    @app.get("/api/test-packages/{package_id}/source.pdf")
    async def get_test_package_source(package_id: str) -> FileResponse:
        source = authoring.package_source_pdf(package_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Source PDF not found.")
        return FileResponse(source, media_type="application/pdf")

    if static_root.is_dir():
        assets_root = static_root / "assets"
        if assets_root.is_dir():
            app.mount("/app/assets", StaticFiles(directory=assets_root), name="assets")

        @app.get("/app/")
        async def shell() -> FileResponse:
            return FileResponse(static_root / "index.html")

    return app
