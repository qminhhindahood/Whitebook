from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfWriter
from starlette.testclient import TestClient

from whitebook.app import create_app
from whitebook.authoring import PackageAuthoring
from whitebook.launcher import initialize_storage


def client_for(data_root: Path) -> TestClient:
    return TestClient(
        create_app(
            capability_token="token",
            instance_id="instance",
            port=8126,
            static_root=data_root.parent / "static",
            storage_root=data_root,
        ),
        base_url="http://127.0.0.1:8126",
        headers={"X-Whitebook-Token": "token"},
        client=("127.0.0.1", 50000),
    )


def math_package(data_root: Path) -> dict:
    initialize_storage(data_root)
    source = data_root / "runtime" / "math.pdf"
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    source.write_bytes(output.getvalue())
    authoring = PackageAuthoring(data_root)
    draft = authoring.create_import_draft(
        title="Math module",
        original_filename="math.pdf",
        temporary_pdf=source,
        answer_csv=(
            b"section,module,question_number,type,correct_answer,category\n"
            b"Math,1,1,student-produced response,2,Algebra\n"
        ),
    )
    authoring.set_question_regions(
        draft.id,
        0,
        [
            {
                "page_number": 1,
                "x": 0.05,
                "y": 0.05,
                "width": 0.9,
                "height": 0.9,
                "confirmed": True,
            }
        ],
    )
    return authoring.publish(draft.id)


def selection() -> dict[str, object]:
    return {
        "sections": ["Math"],
        "modules": [1],
        "count": 1,
        "timing": "elapsed",
    }


def test_math_failure_is_named_and_scientific_fallback_is_explicit(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.delenv("WHITEBOOK_DESMOS_API_KEY", raising=False)
    data_root = tmp_path / "data"
    package = math_package(data_root)
    client = client_for(data_root)

    setup = client.post(
        "/api/attempt-setups",
        json={"packageId": package["id"], "kind": "practice", "selection": selection()},
    ).json()

    assert setup["status"] == "failed"
    assert setup["failedStage"] == "math_tools"
    assert setup["allowedActions"] == [
        "retry",
        "return_to_setup",
        "use_scientific",
    ]
    assert client.get("/api/attempts").json() == []

    fallback = client.post(f"/api/attempt-setups/{setup['setupId']}/use-scientific")
    assert fallback.status_code == 200
    assert fallback.json()["status"] == "ready"
    begun = client.post(f"/api/attempt-setups/{setup['setupId']}/begin")
    assert begun.status_code == 201
    assert begun.json()["calculatorMode"] == "scientific"


def test_desmos_must_be_confirmed_usable_and_state_survives_restart(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("WHITEBOOK_DESMOS_API_KEY", "licensed-test-key")
    data_root = tmp_path / "data"
    package = math_package(data_root)
    reference = data_root / "assets" / "reference-sheet.png"
    reference.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
    client = client_for(data_root)

    setup = client.post(
        "/api/attempt-setups",
        json={"packageId": package["id"], "kind": "practice", "selection": selection()},
    ).json()
    assert setup["status"] == "loading"
    assert setup["mathTool"]["scriptUrl"].endswith("apiKey=licensed-test-key")
    assert setup["mathTool"]["options"] == {
        "images": False,
        "folders": False,
        "notes": False,
        "links": False,
        "pasteGraphLink": False,
        "authorFeatures": False,
    }

    failed = client.post(
        f"/api/attempt-setups/{setup['setupId']}/confirm-calculator",
        json={
            "scriptLoaded": True,
            "constructorAvailable": True,
            "instanceCreated": True,
            "stateReadable": False,
            "usableSize": True,
        },
    )
    assert failed.json()["status"] == "failed"
    assert failed.json()["failedStage"] == "math_tools"

    ready = client.post(
        f"/api/attempt-setups/{setup['setupId']}/confirm-calculator",
        json={
            "scriptLoaded": True,
            "constructorAvailable": True,
            "instanceCreated": True,
            "stateReadable": True,
            "usableSize": True,
        },
    )
    assert ready.json()["status"] == "ready"
    attempt = client.post(f"/api/attempt-setups/{setup['setupId']}/begin").json()

    state = {"version": 11, "expressions": {"list": [{"id": "1", "latex": "x=2"}]}}
    saved = client.put(
        f"/api/attempts/{attempt['id']}/calculator-state", json={"state": state}
    )
    assert saved.status_code == 200
    restarted = client_for(data_root)
    assert (
        restarted.get(f"/api/attempts/{attempt['id']}").json()["calculatorState"]
        == state
    )

    reference_response = restarted.get("/api/math/reference-sheet.png")
    assert reference_response.status_code == 200
    assert reference_response.headers["content-type"] == "image/png"
