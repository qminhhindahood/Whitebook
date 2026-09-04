from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfWriter
from starlette.testclient import TestClient

from whitebook.app import create_app
from whitebook.launcher import initialize_storage


def make_client(tmp_path: Path) -> TestClient:
    data_root = tmp_path / "data"
    initialize_storage(data_root)
    return TestClient(
        create_app(
            capability_token="token",
            instance_id="instance",
            port=8124,
            static_root=tmp_path / "static",
            storage_root=data_root,
        ),
        base_url="http://127.0.0.1:8124",
        headers={"X-Whitebook-Token": "token"},
        client=("127.0.0.1", 50000),
    )


def make_pdf(marker: str = "") -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.add_metadata({"/Marker": marker})
    writer.write(output)
    return output.getvalue()


def make_csv(answer: str = "A") -> bytes:
    return (
        "section,module,question_number,type,correct_answer,category\n"
        f"Reading and Writing,1,1,multiple choice,{answer},Main Idea\n"
        "Reading and Writing,1,2,multiple choice,B,Grammar\n"
    ).encode()


def create_draft(
    client: TestClient, *, title: str = "Practice", answer: str = "A"
) -> dict:
    response = client.post(
        "/api/import-drafts",
        data={"title": title},
        files={
            "source_pdf": ("practice.pdf", make_pdf(), "application/pdf"),
            "answer_csv": ("answers.csv", make_csv(answer), "text/csv"),
        },
    )
    assert response.status_code == 201
    return response.json()


def region(x: float = 0.1) -> dict[str, object]:
    return {
        "pageNumber": 1,
        "x": x,
        "y": 0.1,
        "width": 0.8,
        "height": 0.35,
        "confirmed": True,
    }


def test_region_mapping_is_normalized_ordered_and_resumable(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    draft = create_draft(client)

    first = client.put(
        f"/api/import-drafts/{draft['id']}/questions/0/regions",
        json={"regions": [region(0.1), region(0.2)]},
    )

    assert first.status_code == 200
    payload = first.json()
    assert payload["mappingProgress"] == {"confirmed": 1, "total": 2}
    assert [item["ordinal"] for item in payload["questions"][0]["regions"]] == [1, 2]
    assert payload["nextUnmappedQuestion"] == 1

    reopened = client.get(f"/api/import-drafts/{draft['id']}")
    assert reopened.status_code == 200
    assert (
        reopened.json()["questions"][0]["regions"] == payload["questions"][0]["regions"]
    )
    source = client.get(payload["sourcePdfUrl"])
    assert source.status_code == 200
    assert source.headers["content-type"] == "application/pdf"


def test_invalid_regions_and_incomplete_mapping_block_publication(
    tmp_path: Path,
) -> None:
    client = make_client(tmp_path)
    draft = create_draft(client)

    invalid = client.put(
        f"/api/import-drafts/{draft['id']}/questions/0/regions",
        json={"regions": [region(0.5) | {"width": 0.8}]},
    )
    blocked = client.post(f"/api/import-drafts/{draft['id']}/publish")

    assert invalid.status_code == 422
    assert invalid.json()["detail"] == "Question Regions must stay within the page."
    assert blocked.status_code == 409
    assert (
        blocked.json()["detail"] == "Every question needs a confirmed Question Region."
    )


def test_publication_is_immutable_visible_and_classifies_partial_packages(
    tmp_path: Path,
) -> None:
    client = make_client(tmp_path)
    draft = create_draft(client)
    for index in range(2):
        mapped = client.put(
            f"/api/import-drafts/{draft['id']}/questions/{index}/regions",
            json={"regions": [region()]},
        )
        assert mapped.status_code == 200

    published = client.post(f"/api/import-drafts/{draft['id']}/publish")

    assert published.status_code == 201
    package = published.json()
    assert package["revision"] == 1
    assert package["questionCount"] == 2
    assert package["practiceEligible"] is True
    assert package["simulationEligible"] is False
    assert package["eligibilityReasons"] == [
        "missing_standard_module",
        "wrong_question_count",
    ]
    assert len({question["id"] for question in package["questions"]}) == 2

    locked = client.get(f"/api/import-drafts/{draft['id']}").json()
    assert locked["editable"] is False
    assert locked["status"] == "published"
    assert locked["publishedPackageId"] == package["id"]
    assert (
        client.put(
            f"/api/import-drafts/{draft['id']}/questions/0/regions",
            json={"regions": [region()]},
        ).status_code
        == 409
    )

    library = client.get("/api/test-packages")
    assert library.status_code == 200
    assert library.json() == [package]


def test_exact_duplicate_reopens_package_and_changed_answers_create_revision(
    tmp_path: Path,
) -> None:
    client = make_client(tmp_path)
    draft = create_draft(client, title="Revision family")
    for index in range(2):
        client.put(
            f"/api/import-drafts/{draft['id']}/questions/{index}/regions",
            json={"regions": [region()]},
        )
    first = client.post(f"/api/import-drafts/{draft['id']}/publish").json()

    duplicate = create_draft(client, title="Different display title")
    assert duplicate["status"] == "published"
    assert duplicate["publishedPackageId"] == first["id"]
    assert duplicate["editable"] is False

    changed = create_draft(client, title="Revision family", answer="C")
    for index in range(2):
        client.put(
            f"/api/import-drafts/{changed['id']}/questions/{index}/regions",
            json={"regions": [region()]},
        )
    second = client.post(f"/api/import-drafts/{changed['id']}/publish").json()

    assert second["id"] != first["id"]
    assert second["familyId"] == first["familyId"]
    assert second["revision"] == 2
    assert client.get(f"/api/test-packages/{first['id']}").json()["revision"] == 1
