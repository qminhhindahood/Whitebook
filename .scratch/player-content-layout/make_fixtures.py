"""Build the ticket 07 verification fixtures and publish them to a scratch
data root. Run: uv run python .scratch/player-content-layout/make_fixtures.py
"""

from __future__ import annotations

import io
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "runtime"
INPUT = ROOT / "input"
TOKEN_HEADER = None


def draw_page(writer: PdfWriter, font, lines: list[str]) -> None:
    page = writer.add_blank_page(width=612, height=792)
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    content = (
        "BT /F1 12 Tf 40 750 Td 20 TL "
        + " ".join(("T* " if index else "") + f"({line}) Tj" for index, line in enumerate(lines))
        + " ET"
    )
    stream = DecodedStreamObject()
    stream.set_data(content.encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)


PASSAGE_LINES = [
    "Reading and Writing - Module 1",
    "1. The tidal marsh has been rewritten by a century of engineering,",
    "yet its oldest function survives: when storms push seawater over the",
    "flats, the grasses slow the surge, and the water that finally reaches",
    "the town arrives weaker than it left the sea. Engineers once judged",
    "the marsh wasteland and drained it; the floods that followed taught a",
    "harder lesson. Restoring the grasses is now cheaper than raising walls,",
    "and the marsh quietly does the work of concrete while the city sleeps,",
    "which is why coastal planners treat wetlands as infrastructure rather",
    "than scenery. The cheapest seawall ever built was planted, not poured,",
    "and it grows a little stronger every year it is left alone to spread,",
    "binding sediment with roots that no contractor could drive or weld.",
]
MATH_PAGE_LINES = [
    "Math - Module 1",
    "1. Line m passes through the origin and the point (4, 2).",
    "Which equation represents line m?",
    "A. y = 2x          [graph: slope 2 through origin]",
    "B. y = (1/2)x      [graph: slope 1/2 through origin]",
    "C. y = x + 2       [graph: slope 1, intercept 2]",
    "D. y = x - 2       [graph: slope 1, intercept -2]",
]
SPR_PAGE_LINES = [
    "Math - Module 1",
    "2. A recipe uses 3 cups of flour for every 4 servings.",
    "How many cups of flour are needed for 12 servings?",
    "Enter your answer.",
]


def build_pdf(path: Path) -> None:
    writer = PdfWriter()
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    draw_page(writer, font, PASSAGE_LINES)
    draw_page(writer, font, MATH_PAGE_LINES)
    draw_page(writer, font, SPR_PAGE_LINES)
    with path.open("wb") as output:
        writer.write(output)


CSV = (
    "section,module,question_number,type,correct_answer,category\n"
    "Reading and Writing,1,1,multiple choice,A,Main Idea\n"
    "Reading and Writing,1,2,multiple choice,D,Transition\n"
    "Math,1,1,multiple choice,B,Algebra\n"
    "Math,1,2,multiple choice,C,Algebra\n"
    "Math,1,3,student-produced response,9,Algebra\n"
).encode()


def passage_block() -> dict:
    return {
        "kind": "region",
        "region": {
            "pageNumber": 1,
            "x": 0.05,
            "y": 0.04,
            "width": 0.92,
            "height": 0.32,
            "confirmed": True,
        },
        "alt": "Long passage about a tidal marsh that protects a coastal town",
    }


def equation_block() -> dict:
    return {
        "kind": "region",
        "region": {
            "pageNumber": 2,
            "x": 0.04,
            "y": 0.03,
            "width": 0.9,
            "height": 0.085,
            "confirmed": True,
        },
        "alt": "Line m passes through the origin and the point (4, 2)",
    }


def graph_block(letter: str) -> dict:
    return {
        "kind": "region",
        "region": {
            "pageNumber": 2,
            "x": 0.04,
            "y": 0.11 if letter == "A" else 0.137,
            "width": 0.44,
            "height": 0.03,
            "confirmed": True,
        },
        "alt": f"Answer {letter} graph",
    }


def text(text: str) -> dict:
    return {"kind": "text", "text": text}


PRESENTATIONS = {
    0: {
        "version": 1,
        "stimulus": [passage_block()],
        "stem": [
            text(
                "Which choice best states how the engineers' view of the marsh changed over time?"
            )
        ],
        "choices": [
            {
                "id": "A",
                "content": [
                    text(
                        "They first dismissed it as wasteland to be drained, then came to value it as natural flood protection that outperforms built infrastructure."
                    )
                ],
            },
            {"id": "B", "content": [text("They always preferred planting grasses to pouring concrete.")]},
            {"id": "C", "content": [text("They believed the marsh made storms stronger.")]},
            {"id": "D", "content": [text("They wanted the marsh turned into scenery for the town.")]},
        ],
    },
    1: {
        "version": 1,
        "stimulus": [],
        "stem": [
            text(
                "Which choice completes the sentence with the most logical transition? The city could raise its seawalls; ______, it could restore the marsh that already blunts the waves."
            )
        ],
        "choices": [
            {"id": "A", "content": [text("moreover")]},
            {"id": "B", "content": [text("instead")]},
            {"id": "C", "content": [text("likewise")]},
            {"id": "D", "content": [text("alternatively")]},
        ],
    },
    2: {
        "version": 1,
        "stimulus": [],
        "stem": [equation_block()],
        "choices": [
            {"id": "A", "content": [graph_block("A")]},
            {"id": "B", "content": [graph_block("B")]},
            {"id": "C", "content": [text("y = x + 2")]},
            {"id": "D", "content": [text("y = x - 2")]},
        ],
    },
    3: {
        "version": 1,
        "stimulus": [],
        "stem": [text("If 3x + 2 = 14, what is the value of x?")],
        "choices": [
            {"id": "A", "content": [text("2")]},
            {"id": "B", "content": [text("3")]},
            {"id": "C", "content": [text("4")]},
            {"id": "D", "content": [text("6")]},
        ],
    },
    4: {
        "version": 1,
        "stimulus": [],
        "stem": [
            text(
                "A recipe uses 3 cups of flour for every 4 servings. How many cups of flour are needed for 12 servings?"
            )
        ],
    },
}


def request(method: str, url: str, payload: dict | None = None, token: str = "") -> tuple[int, dict | bytes]:
    data = None
    headers = {"X-Whitebook-Token": token}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            body = response.read()
            return response.status, (
                json.loads(body) if response.headers.get_content_type() == "application/json" else body
            )
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def main() -> None:
    INPUT.mkdir(parents=True, exist_ok=True)
    build_pdf(INPUT / "player-fixtures.pdf")
    (INPUT / "player-answers.csv").write_bytes(CSV)
    print("fixtures written to", INPUT)

    lock = DATA / "runtime" / "instance.json"
    if not lock.is_file():
        raise SystemExit(
            "Scratch server is not running. Start it first with:\n"
            "  uv run python -m whitebook --data-dir .scratch/player-content-layout/runtime --no-browser"
        )
    record = json.loads(lock.read_text())
    base = f"http://{record['host']}:{record['port']}"
    token = record["token"]

    for attempt in range(30):
        try:
            status, _ = request("GET", f"{base}/api/health", token=token)
            if status == 200:
                break
        except urllib.error.URLError:
            pass
        time.sleep(0.5)
    else:
        raise SystemExit("Server never became healthy.")

    # Authorize this browser session through the bootstrap endpoint.
    # (urllib drops the redirect cookie; the browser performs its own
    # bootstrap, so no server-side session state is needed here.)

    boundary = "----whitebookfixture"
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nPlayer Layout Fixtures\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="source_pdf"; filename="player-fixtures.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
        + (INPUT / "player-fixtures.pdf").read_bytes()
        + b"\r\n",
        f'--{boundary}\r\nContent-Disposition: form-data; name="answer_csv"; filename="player-answers.csv"\r\nContent-Type: text/csv\r\n\r\n'.encode()
        + CSV
        + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    req = urllib.request.Request(
        f"{base}/api/import-drafts",
        data=b"".join(parts),
        headers={
            "X-Whitebook-Token": token,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as response:
        draft = json.loads(response.read())
    print("draft", draft["id"], draft["status"], draft["diagnostics"])

    for index, presentation in PRESENTATIONS.items():
        status, body = request(
            "PUT",
            f"{base}/api/import-drafts/{draft['id']}/questions/{index}/presentation",
            presentation,
            token,
        )
        assert status == 200, (status, body)
    status, package = request(
        "POST", f"{base}/api/import-drafts/{draft['id']}/publish", {}, token
    )
    assert status == 201, (status, package)
    print("published", package["id"], "revision", package["revision"])
    print("questions", len(package["questions"]))
    print(f"APP_URL={base}/app/")


if __name__ == "__main__":
    main()
