from __future__ import annotations

import os
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
from whitebook.attempts import AttemptEngine, AttemptError
from whitebook.authoring import AuthoringError, PackageAuthoring
from whitebook.backups import BackupError, BackupManager
from whitebook.diagnostics import DiagnosticLog


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


class AttemptSetupInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    package_id: str = Field(alias="packageId")
    kind: str
    selection: dict[str, object]


class ResponseInput(BaseModel):
    response: str | None


class ReviewStateInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    marked: bool = False
    eliminated_choices: list[str] = Field(
        default_factory=list, alias="eliminatedChoices"
    )


class CurrentQuestionInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    question_id: str = Field(alias="questionId")


class CalculatorReadinessInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    script_loaded: bool = Field(alias="scriptLoaded")
    constructor_available: bool = Field(alias="constructorAvailable")
    instance_created: bool = Field(alias="instanceCreated")
    state_readable: bool = Field(alias="stateReadable")
    usable_size: bool = Field(alias="usableSize")


class CalculatorStateInput(BaseModel):
    state: dict[str, object]


class PermanentDeleteInput(BaseModel):
    confirmation: str


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
    attempts = AttemptEngine(storage_root)
    backups = BackupManager(storage_root)
    diagnostics = DiagnosticLog(storage_root)
    diagnostics.record("startup", stage="application_ready", resource_id=instance_id)

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
            diagnostics.record(
                "import_stage",
                stage="draft_created",
                error_code=(
                    draft.diagnostics[0]["code"] if draft.diagnostics else None
                ),
                resource_id=draft.id,
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

    @app.get("/api/test-packages/{package_id}/practice-options")
    async def get_practice_options(package_id: str) -> dict[str, object]:
        try:
            return attempts.practice_options(package_id)
        except AttemptError as error:
            raise HTTPException(status_code=404, detail=error.message) from error

    @app.post("/api/test-packages/{package_id}/archive")
    async def archive_test_package(package_id: str) -> dict[str, object]:
        try:
            return authoring.set_archived(package_id, archived=True)
        except AuthoringError as error:
            raise HTTPException(status_code=404, detail=error.message) from error

    @app.post("/api/test-packages/{package_id}/restore")
    async def restore_test_package(package_id: str) -> dict[str, object]:
        try:
            return authoring.set_archived(package_id, archived=False)
        except AuthoringError as error:
            raise HTTPException(status_code=404, detail=error.message) from error

    @app.delete("/api/test-packages/{package_id}")
    async def permanently_delete_test_package(
        package_id: str, payload: PermanentDeleteInput
    ) -> dict[str, int]:
        try:
            return authoring.permanently_delete(package_id, payload.confirmation)
        except AuthoringError as error:
            status_code = 404 if error.code == "package_not_found" else 409
            raise HTTPException(
                status_code=status_code, detail=error.message
            ) from error

    @app.post("/api/attempt-setups", status_code=201)
    async def create_attempt_setup(payload: AttemptSetupInput) -> dict[str, object]:
        try:
            return attempts.prepare(
                package_id=payload.package_id,
                kind=payload.kind,
                selection=payload.selection,
            )
        except AttemptError as error:
            raise HTTPException(status_code=422, detail=error.message) from error

    @app.post("/api/attempt-setups/{setup_id}/begin", status_code=201)
    async def begin_attempt(setup_id: str) -> dict[str, object]:
        try:
            return attempts.begin(setup_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempt-setups/{setup_id}/use-scientific")
    async def use_scientific_calculator(setup_id: str) -> dict[str, object]:
        try:
            return attempts.use_scientific(setup_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempt-setups/{setup_id}/confirm-calculator")
    async def confirm_calculator(
        setup_id: str, payload: CalculatorReadinessInput
    ) -> dict[str, object]:
        try:
            return attempts.confirm_calculator(
                setup_id,
                {
                    "scriptLoaded": payload.script_loaded,
                    "constructorAvailable": payload.constructor_available,
                    "instanceCreated": payload.instance_created,
                    "stateReadable": payload.state_readable,
                    "usableSize": payload.usable_size,
                },
            )
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.get("/api/attempts")
    async def list_attempts() -> list[dict[str, object]]:
        return attempts.list_attempts()

    @app.get("/api/attempts/{attempt_id}")
    async def get_attempt(attempt_id: str) -> dict[str, object]:
        attempt = attempts.get_attempt(attempt_id)
        if attempt is None:
            raise HTTPException(status_code=404, detail="Attempt not found.")
        return attempt

    @app.delete("/api/attempts/{attempt_id}")
    async def delete_unfinished_attempt(
        attempt_id: str, confirmed: bool = False
    ) -> dict[str, bool]:
        try:
            return attempts.delete_unfinished(attempt_id, confirmed=confirmed)
        except AttemptError as error:
            status_code = 404 if error.code == "attempt_not_found" else 409
            raise HTTPException(
                status_code=status_code, detail=error.message
            ) from error

    @app.put("/api/attempts/{attempt_id}/questions/{question_id}/response")
    async def save_response(
        attempt_id: str, question_id: str, payload: ResponseInput
    ) -> dict[str, object]:
        try:
            return attempts.save_response(attempt_id, question_id, payload.response)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.put("/api/attempts/{attempt_id}/questions/{question_id}/review-state")
    async def save_review_state(
        attempt_id: str, question_id: str, payload: ReviewStateInput
    ) -> dict[str, object]:
        try:
            return attempts.save_review_state(
                attempt_id,
                question_id,
                marked=payload.marked,
                eliminated_choices=payload.eliminated_choices,
            )
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.put("/api/attempts/{attempt_id}/current-question")
    async def set_current_question(
        attempt_id: str, payload: CurrentQuestionInput
    ) -> dict[str, object]:
        try:
            return attempts.navigate(attempt_id, payload.question_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.put("/api/attempts/{attempt_id}/calculator-state")
    async def save_calculator_state(
        attempt_id: str, payload: CalculatorStateInput
    ) -> dict[str, object]:
        try:
            return attempts.save_calculator_state(attempt_id, payload.state)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/pause")
    async def pause_attempt(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.pause(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/prepare-resume")
    async def prepare_attempt_resume(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.prepare_resume(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/resume")
    async def resume_attempt(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.resume(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/submit")
    async def submit_attempt(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.submit(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/tick")
    async def tick_attempt(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.tick(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/continue")
    async def continue_attempt(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.continue_after_transition(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/end-break")
    async def end_attempt_break(
        attempt_id: str, confirmed: bool = False
    ) -> dict[str, object]:
        try:
            return attempts.end_break(attempt_id, confirmed=confirmed)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/retake", status_code=201)
    async def retake_attempt(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.retake(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.post("/api/attempts/{attempt_id}/practice-mistakes", status_code=201)
    async def practice_mistakes(attempt_id: str) -> dict[str, object]:
        try:
            return attempts.practice_mistakes(attempt_id)
        except AttemptError as error:
            raise HTTPException(status_code=409, detail=error.message) from error

    @app.get("/api/math/reference-sheet.png")
    async def get_reference_sheet() -> FileResponse:
        reference = (storage_root / "assets" / "reference-sheet.png").resolve()
        assets_root = (storage_root / "assets").resolve()
        if (
            not reference.is_relative_to(assets_root)
            or not reference.is_file()
            or reference.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n"
        ):
            raise HTTPException(status_code=404, detail="Reference Sheet not found.")
        return FileResponse(reference, media_type="image/png")

    @app.post("/api/backups/export", status_code=201)
    async def export_backup() -> dict[str, object]:
        try:
            return backups.export()
        except (BackupError, OSError) as error:
            message = (
                error.message
                if isinstance(error, BackupError)
                else "Backup export failed."
            )
            raise HTTPException(status_code=500, detail=message) from error

    @app.get("/api/backups/{archive_name}")
    async def download_backup(archive_name: str) -> FileResponse:
        archive = backups.archive_path(archive_name)
        if archive is None:
            raise HTTPException(status_code=404, detail="Backup not found.")
        return FileResponse(
            archive,
            media_type="application/zip",
            filename=f"whitebook-backup-{archive.stem[:8]}.zip",
        )

    @app.post("/api/backups/restore")
    async def restore_backup(
        backup: Annotated[UploadFile, File()],
    ) -> dict[str, int]:
        temporary = storage_root / "runtime" / f"restore-upload-{uuid.uuid4().hex}.zip"
        try:
            with temporary.open("xb") as output:
                while chunk := await backup.read(1024 * 1024):
                    output.write(chunk)
            return backups.restore(temporary)
        except BackupError as error:
            raise HTTPException(status_code=422, detail=error.message) from error
        finally:
            temporary.unlink(missing_ok=True)
            await backup.close()

    @app.post("/api/diagnostics/open-logs")
    async def open_logs_folder() -> dict[str, bool]:
        opener = getattr(os, "startfile", None)
        if opener is None:
            raise HTTPException(
                status_code=501,
                detail="Open Logs Folder is available from the Windows launcher.",
            )
        opener(str(diagnostics.folder))
        return {"opened": True}

    if static_root.is_dir():
        assets_root = static_root / "assets"
        if assets_root.is_dir():
            app.mount("/app/assets", StaticFiles(directory=assets_root), name="assets")

        @app.get("/app/")
        async def shell() -> FileResponse:
            return FileResponse(static_root / "index.html")

    return app
