from pathlib import Path

import pytest

from tests.test_authoring_api import make_client, make_pdf


def presentation():
    return {
        "version": 1,
        "stimulus": [],
        "stem": [{"kind": "text", "text": "If 3x + 2 = 14, what is x?"}],
        "choices": [
            {"id": letter, "content": [{"kind": "text", "text": value}]}
            for letter, value in zip("ABCD", ("2", "3", "4", "6"), strict=True)
        ],
    }


def math_draft(client):
    response = client.post(
        "/api/import-drafts",
        data={"title": "Presented Math"},
        files={
            "source_pdf": ("math.pdf", make_pdf(), "application/pdf"),
            "answer_csv": (
                "answers.csv",
                (
                    b"section,module,question_number,type,correct_answer,category\n"
                    b"Math,1,1,multiple choice,C,Algebra\n"
                ),
                "text/csv",
            ),
        },
    )
    assert response.status_code == 201
    return response.json()


def test_presented_math_question_survives_publication_and_completed_attempt(
    tmp_path: Path,
):
    client = make_client(tmp_path)
    (tmp_path / "data/assets/reference-sheet.png").write_bytes(
        b"\x89PNG\r\n\x1a\nfixture"
    )
    draft = math_draft(client)
    content = presentation()
    saved = client.put(
        f"/api/import-drafts/{draft['id']}/questions/0/presentation", json=content
    )
    assert saved.status_code == 200, saved.text
    reopened = client.get(f"/api/import-drafts/{draft['id']}").json()
    assert reopened["questions"][0]["presentation"] == content
    assert reopened["mappingProgress"] == {"confirmed": 1, "total": 1}
    published = client.post(f"/api/import-drafts/{draft['id']}/publish")
    assert published.status_code == 201, published.text
    package = published.json()
    assert package["questions"][0]["presentation"] == content
    gate = client.post(
        "/api/attempt-setups",
        json={
            "packageId": package["id"],
            "kind": "practice",
            "selection": {
                "sections": ["Math"],
                "modules": [1],
                "count": 1,
                "timing": "elapsed",
                "calculatorMode": "scientific",
            },
        },
    ).json()
    assert gate["status"] == "ready", gate
    assert gate["questions"][0]["presentation"] == content
    begun = client.post(f"/api/attempt-setups/{gate['setupId']}/begin")
    assert begun.status_code == 201, begun.text
    attempt = begun.json()
    route = f"/api/attempts/{attempt['id']}"
    question = attempt["questions"][0]["id"]
    assert (
        client.put(
            f"{route}/questions/{question}/response", json={"response": "C"}
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"{route}/questions/{question}/review-state",
            json={"marked": True, "eliminatedChoices": ["A"]},
        ).status_code
        == 200
    )
    loaded = client.get(route).json()
    assert loaded["responses"][question] == "C"
    assert loaded["reviewState"][question] == {
        "marked": True,
        "eliminatedChoices": ["A"],
    }
    assert loaded["questions"][0]["presentation"] == content
    assert client.post(f"{route}/pause").status_code == 200
    resume_gate = client.post(f"{route}/prepare-resume").json()
    assert resume_gate["questions"][0]["presentation"] == content
    resumed = client.post(f"/api/attempt-setups/{resume_gate['setupId']}/begin").json()
    assert resumed["responses"][question] == "C"
    assert resumed["questions"][0]["presentation"] == content
    completed = client.post(f"{route}/submit")
    assert completed.status_code == 200, completed.text
    result = completed.json()["result"]
    assert result["correct"] == 1
    assert result["questions"][0]["presentation"] == content


@pytest.mark.parametrize(
    "invalid",
    [
        {"stem": []},
        {"stem": [{"kind": "text", "text": "   "}]},
        {"stem": [{"kind": "html", "text": "<script>bad()</script>"}]},
        {"version": 2},
        {"choices": [{"id": "A", "content": [{"kind": "text", "text": "2"}]}] * 4},
        {"choices": []},
        {"correctAnswer": "B"},
        {"stimulus": [{"kind": "text", "text": "unexpected Math passage"}]},
        {
            "stem": [
                {
                    "kind": "region",
                    "region": {
                        "pageNumber": 2,
                        "x": 0,
                        "y": 0,
                        "width": 1,
                        "height": 1,
                        "confirmed": True,
                    },
                }
            ]
        },
        {
            "stem": [
                {
                    "kind": "region",
                    "region": {
                        "pageNumber": 1,
                        "x": 0.5,
                        "y": 0,
                        "width": 1,
                        "height": 1,
                        "confirmed": True,
                    },
                }
            ]
        },
        {
            "stem": [
                {
                    "kind": "region",
                    "region": {
                        "pageNumber": 1,
                        "x": 0,
                        "y": 0,
                        "width": 1,
                        "height": 1,
                        "confirmed": False,
                    },
                }
            ]
        },
    ],
)
def test_invalid_content_cannot_replace_a_valid_presentation(tmp_path: Path, invalid):
    client = make_client(tmp_path)
    draft = math_draft(client)
    route = f"/api/import-drafts/{draft['id']}/questions/0/presentation"
    content = presentation()
    assert client.put(route, json=content).status_code == 200
    assert client.put(route, json=content | invalid).status_code == 422
    assert (
        client.get(f"/api/import-drafts/{draft['id']}").json()["questions"][0][
            "presentation"
        ]
        == content
    )


def test_answer_crops_are_published_and_published_content_is_locked(tmp_path: Path):
    client = make_client(tmp_path)
    draft = math_draft(client)
    content = presentation()
    crop = {
        "pageNumber": 1,
        "x": 0.1,
        "y": 0.1,
        "width": 0.4,
        "height": 0.2,
        "confirmed": True,
    }
    content["choices"][0]["content"] = [
        {"kind": "region", "region": crop, "alt": "Graph of a line"}
    ]
    route = f"/api/import-drafts/{draft['id']}/questions/0/presentation"
    assert client.put(route, json=content).status_code == 200
    package = client.post(f"/api/import-drafts/{draft['id']}/publish").json()
    assert package["questions"][0]["regions"] == [crop]
    assert package["questions"][0]["presentation"] == content
    assert client.put(route, json=presentation()).status_code == 409
