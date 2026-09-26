from pathlib import Path

from tests.test_authoring_api import make_client, make_pdf, region


def read_write_csv() -> bytes:
    return (
        b"section,module,question_number,type,correct_answer,category\n"
        b"Reading and Writing,1,1,multiple choice,B,Main Idea\n"
        b"Math,1,2,student produced response,3/4,Algebra\n"
    )


def create_bank_draft(client, title: str) -> dict:
    response = client.post(
        "/api/import-drafts",
        data={"title": title},
        files={
            "source_pdf": ("bank.pdf", make_pdf(), "application/pdf"),
            "answer_csv": ("answers.csv", read_write_csv(), "text/csv"),
        },
    )
    assert response.status_code == 201
    return response.json()


def multiple_choice_presentation() -> dict:
    return {
        "version": 1,
        "stimulus": [
            {
                "kind": "region",
                "region": {
                    "pageNumber": 1,
                    "x": 0.05,
                    "y": 0.05,
                    "width": 0.9,
                    "height": 0.3,
                    "confirmed": True,
                },
                "alt": "Passage about tidal marshes",
            }
        ],
        "stem": [{"kind": "text", "text": "Which choice reinforces the claim?"}],
        "choices": [
            {"id": "A", "content": [{"kind": "text", "text": "A weak aside"}]},
            {"id": "B", "content": [{"kind": "text", "text": "The study"}]},
            {"id": "C", "content": [{"kind": "text", "text": "A denial"}]},
            {"id": "D", "content": [{"kind": "text", "text": "An anecdote"}]},
        ],
    }


def spr_presentation() -> dict:
    return {
        "version": 1,
        "stimulus": [],
        "stem": [{"kind": "text", "text": "What is three quarters of twelve?"}],
    }


def convert_all_questions(client, draft: dict, *, spr_second: bool = True) -> None:
    saved = client.put(
        f"/api/import-drafts/{draft['id']}/questions/0/presentation",
        json=multiple_choice_presentation(),
    )
    assert saved.status_code == 200, saved.text
    second = (
        spr_presentation()
        if spr_second
        else {
            "version": 1,
            "stimulus": [],
            "stem": [{"kind": "text", "text": "Which choice best concludes?"}],
            "choices": [
                {"id": "A", "content": [{"kind": "text", "text": "One"}]},
                {"id": "B", "content": [{"kind": "text", "text": "Two"}]},
                {"id": "C", "content": [{"kind": "text", "text": "Three"}]},
                {"id": "D", "content": [{"kind": "text", "text": "Four"}]},
            ],
        }
    )
    saved = client.put(
        f"/api/import-drafts/{draft['id']}/questions/1/presentation",
        json=second,
    )
    assert saved.status_code == 200, saved.text


def test_revision_publishes_converted_content_without_changing_answers(
    tmp_path: Path,
):
    client = make_client(tmp_path)
    draft = create_bank_draft(client, "Converted Bank")
    for index in range(2):
        mapped = client.put(
            f"/api/import-drafts/{draft['id']}/questions/{index}/regions",
            json={"regions": [region()]},
        )
        assert mapped.status_code == 200
    original = client.post(f"/api/import-drafts/{draft['id']}/publish").json()

    revision = client.post(f"/api/test-packages/{original['id']}/revision")
    assert revision.status_code == 201, revision.text
    revision_draft = revision.json()
    assert revision_draft["editable"] is True
    assert revision_draft["status"] == "mapping"
    assert revision_draft["revisionOfPackageId"] == original["id"]
    assert revision_draft["questionCount"] == 2
    assert revision_draft["sourcePdfUrl"].startswith("/api/import-drafts/")
    assert revision_draft["sourcePdfUrl"].endswith(f"/{revision_draft['id']}/source.pdf")
    assert revision_draft["mappingProgress"] == {"confirmed": 0, "total": 2}

    convert_all_questions(client, revision_draft)
    published = client.post(
        f"/api/import-drafts/{revision_draft['id']}/publish"
    )
    assert published.status_code == 201, published.text
    upgraded = published.json()
    assert upgraded["id"] != original["id"]
    assert upgraded["familyId"] == original["familyId"]
    assert upgraded["revision"] == 2
    assert upgraded["title"] == original["title"]
    assert (
        upgraded["questions"][0]["presentation"] == multiple_choice_presentation()
    )
    assert upgraded["questions"][1]["presentation"] == {
        **spr_presentation(),
        "choices": [],
    }
    assert [question["accepted_answers"] for question in upgraded["questions"]] == [
        question["accepted_answers"] for question in original["questions"]
    ]

    untouched = client.get(f"/api/test-packages/{original['id']}").json()
    assert untouched["revision"] == 1
    assert all(
        "presentation" not in question for question in untouched["questions"]
    )
    assert untouched["familyId"] == original["familyId"]

    library = client.get("/api/test-packages?include_archived=true").json()
    assert {package["id"] for package in library} == {
        original["id"],
        upgraded["id"],
    }


def test_revision_gate_publishes_only_after_every_question_is_mapped(tmp_path: Path):
    client = make_client(tmp_path)
    draft = create_bank_draft(client, "Gate Bank")
    for index in range(2):
        client.put(
            f"/api/import-drafts/{draft['id']}/questions/{index}/regions",
            json={"regions": [region()]},
        )
    original = client.post(f"/api/import-drafts/{draft['id']}/publish").json()

    revision_draft = client.post(
        f"/api/test-packages/{original['id']}/revision"
    ).json()
    blocked = client.post(f"/api/import-drafts/{revision_draft['id']}/publish")
    assert blocked.status_code == 409
    convert_all_questions(client, revision_draft)
    published = client.post(
        f"/api/import-drafts/{revision_draft['id']}/publish"
    )
    assert published.status_code == 201


def test_revision_of_unknown_package_fails(tmp_path: Path):
    client = make_client(tmp_path)
    response = client.post("/api/test-packages/missing/revision")
    assert response.status_code == 404


def test_deleting_a_package_removes_its_revision_draft(tmp_path: Path):
    client = make_client(tmp_path)
    draft = create_bank_draft(client, "Delete Bank")
    for index in range(2):
        client.put(
            f"/api/import-drafts/{draft['id']}/questions/{index}/regions",
            json={"regions": [region()]},
        )
    original = client.post(f"/api/import-drafts/{draft['id']}/publish").json()
    revision_draft = client.post(
        f"/api/test-packages/{original['id']}/revision"
    ).json()
    deleted = client.request(
        "DELETE",
        f"/api/test-packages/{original['id']}",
        json={"confirmation": original["title"]},
    )
    assert deleted.status_code == 200
    assert client.get(f"/api/import-drafts/{revision_draft['id']}").status_code == 404
