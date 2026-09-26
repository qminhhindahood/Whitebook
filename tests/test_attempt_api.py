from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfWriter
from starlette.testclient import TestClient

from whitebook.app import create_app
from whitebook.launcher import initialize_storage


def make_client(data_root: Path) -> TestClient:
    initialize_storage(data_root)
    return TestClient(
        create_app(
            capability_token="token",
            instance_id="instance",
            port=8125,
            static_root=data_root.parent / "static",
            storage_root=data_root,
        ),
        base_url="http://127.0.0.1:8125",
        headers={"X-Whitebook-Token": "token"},
        client=("127.0.0.1", 50000),
    )


def publish_two_question_package(client: TestClient) -> dict:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    answer_csv = (
        b"section,module,question_number,type,correct_answer,category\n"
        b"Reading and Writing,1,1,multiple choice,A,Main Idea\n"
        b"Reading and Writing,1,2,multiple choice,B,Grammar\n"
    )
    draft = client.post(
        "/api/import-drafts",
        data={"title": "Starter module"},
        files={
            "source_pdf": ("starter.pdf", output.getvalue(), "application/pdf"),
            "answer_csv": ("answers.csv", answer_csv, "text/csv"),
        },
    ).json()
    for index in range(2):
        response = client.put(
            f"/api/import-drafts/{draft['id']}/questions/{index}/regions",
            json={
                "regions": [
                    {
                        "pageNumber": 1,
                        "x": 0.05,
                        "y": index * 0.45,
                        "width": 0.9,
                        "height": 0.4,
                        "confirmed": True,
                    }
                ]
            },
        )
        assert response.status_code == 200
    published = client.post(f"/api/import-drafts/{draft['id']}/publish")
    assert published.status_code == 201
    return published.json()


def test_practice_attempt_is_loaded_saved_resumed_and_scored(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    client = make_client(data_root)
    package = publish_two_question_package(client)

    options = client.get(f"/api/test-packages/{package['id']}/practice-options")
    assert options.status_code == 200
    assert options.json()["sections"] == ["Reading and Writing"]
    assert options.json()["modules"] == [
        {"section": "Reading and Writing", "module": 1, "questionCount": 2}
    ]

    setup = client.post(
        "/api/attempt-setups",
        json={
            "packageId": package["id"],
            "kind": "practice",
            "selection": {
                "sections": ["Reading and Writing"],
                "modules": [1],
                "count": 2,
                "timing": "elapsed",
                "shuffle": False,
            },
        },
    )
    assert setup.status_code == 201
    gate = setup.json()
    assert gate["status"] == "ready"
    assert [stage["name"] for stage in gate["stages"]] == [
        "source_validation",
        "question_region_preparation",
        "interface_assets",
        "autosave_verification",
        "ready",
    ]
    assert client.get("/api/attempts").json() == []

    begun = client.post(f"/api/attempt-setups/{gate['setupId']}/begin")
    assert begun.status_code == 201
    attempt = begun.json()
    assert attempt["status"] == "active"
    assert attempt["currentQuestionId"] == package["questions"][0]["id"]

    first_id = package["questions"][0]["id"]
    second_id = package["questions"][1]["id"]
    saved = client.put(
        f"/api/attempts/{attempt['id']}/questions/{first_id}/response",
        json={"response": "A"},
    )
    reviewed = client.put(
        f"/api/attempts/{attempt['id']}/questions/{first_id}/review-state",
        json={"marked": True, "eliminatedChoices": ["C"]},
    )
    navigated = client.put(
        f"/api/attempts/{attempt['id']}/current-question",
        json={"questionId": second_id},
    )
    paused = client.post(f"/api/attempts/{attempt['id']}/pause")

    assert saved.status_code == reviewed.status_code == navigated.status_code == 200
    assert saved.json()["saved"] is True
    assert paused.json()["status"] == "paused"

    restarted_client = make_client(data_root)
    recovered = restarted_client.get(f"/api/attempts/{attempt['id']}").json()
    assert recovered["responses"] == {first_id: "A"}
    assert recovered["reviewState"][first_id] == {
        "marked": True,
        "eliminatedChoices": ["C"],
    }
    assert recovered["currentQuestionId"] == second_id
    assert restarted_client.get("/api/attempts").json()[0]["status"] == "paused"

    resume_gate = restarted_client.post(f"/api/attempts/{attempt['id']}/prepare-resume")
    assert resume_gate.json()["status"] == "ready"
    resumed = restarted_client.post(f"/api/attempts/{attempt['id']}/resume")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "active"

    submitted = restarted_client.post(f"/api/attempts/{attempt['id']}/submit")
    assert submitted.status_code == 200
    result = submitted.json()["result"]
    assert result["correct"] == 1
    assert result["incorrect"] == 0
    assert result["unanswered"] == 1
    assert result["total"] == 2
    assert result["percentage"] == 50.0
    assert result["questions"][0]["marked"] is True
    assert "explanation" not in result["questions"][0]


def test_practice_mistakes_and_retake_create_new_frozen_setups(tmp_path: Path) -> None:
    client = make_client(tmp_path / "data")
    package = publish_two_question_package(client)
    setup = client.post(
        "/api/attempt-setups",
        json={
            "packageId": package["id"],
            "kind": "practice",
            "selection": {
                "sections": ["Reading and Writing"],
                "modules": [1],
                "count": 2,
                "timing": "elapsed",
            },
        },
    ).json()
    attempt = client.post(f"/api/attempt-setups/{setup['setupId']}/begin").json()
    client.post(f"/api/attempts/{attempt['id']}/submit")

    mistakes = client.post(f"/api/attempts/{attempt['id']}/practice-mistakes")
    retake = client.post(f"/api/attempts/{attempt['id']}/retake")

    assert mistakes.status_code == 201
    assert mistakes.json()["selection"]["questionIds"] == [
        question["id"] for question in package["questions"]
    ]
    assert retake.status_code == 201
    assert retake.json()["setupId"] != setup["setupId"]
    original = client.get(f"/api/attempts/{attempt['id']}").json()
    assert original["status"] == "completed"
