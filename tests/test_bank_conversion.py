"""Regressions for the offline question-bank conversion used by the player."""

import json
import sys
from pathlib import Path

import numpy as np
import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import convert_bank_content as converter
from preview_crops import crop

from tests.test_authoring_api import make_client
from tests.test_question_presentation_api import math_draft, presentation


def test_preview_uses_choice_interior_not_printed_box():
    pixels = np.full((80, 100, 3), 255, dtype=np.uint8)
    pixels[10:12, 10:90] = 0  # Printed top border.
    pixels[68:70, 10:90] = 0
    pixels[30:40, 30:45] = 50  # Answer content.
    box = {
        "x0": 10,
        "x1": 90,
        "y0": 10,
        "y1": 70,
        "cx0": 25,
        "cx1": 85,
        "cy0": 20,
        "cy1": 60,
    }
    rendered = np.asarray(crop(pixels, box))
    assert rendered.shape == (40, 60, 3)
    assert not (rendered == 0).any(), "Preview includes the printed box"
    assert (rendered == 50).sum() == 15 * 10 * 3


def test_published_choice_uses_interior_even_with_outer_y_bounds():
    # The original screenshot was caused by publishing y0/y1 instead of cy0/cy1.
    region = converter.norm_region(
        1,
        {"1": [100, 100]},
        {
            "y0": 10,
            "y1": 70,
            "cx0": 25,
            "cx1": 85,
            "cy0": 20,
            "cy1": 60,
        },
    )
    assert region["y"] == 0.2
    assert region["height"] == 0.4
    assert region["x"] == 0.25
    assert region["width"] == 0.6


def test_choice_interior_follows_text_hugging_borders():
    # Choice text can sit right against the box border; a flat height
    # fraction sliced multi-line choices (reported as wrong cuts).
    pixels = np.full((100, 200, 3), 255, dtype=np.uint8)
    pixels[10:12, 20:180] = 0  # top border
    pixels[88:90, 20:180] = 0  # bottom border
    pixels[14:30, 40:160] = 50  # two text lines hugging the top border
    pixels[34:50, 40:160] = 50
    dark = pixels.mean(axis=2) < 200
    # Word gaps keep text rows well below border-stroke density.
    dark[14:50, 60:70] = False
    box = {"x0": 20, "x1": 180, "y0": 10, "y1": 90, "w": 160, "h": 80}
    interior = converter.choice_interior(box, dark, 200)
    assert interior["cy0"] <= 14, "Crop slices the first text line"
    assert interior["cy1"] >= 50, "Crop slices the last text line"


def test_horizontal_lines_preserves_shared_ink_mask():
    # horizontal_lines used to erase rows outside its band in place, so the
    # stimulus bbox computed afterwards started below the first passage line.
    pixels = np.full((200, 400, 3), 255, dtype=np.uint8)
    pixels[20:22, 20:380] = 0  # line above the search band
    pixels[100:102, 20:380] = 0  # line inside the band
    dark = pixels.mean(axis=2) < 200
    converter.horizontal_lines(dark, 80, 180, min_len=100)
    assert dark[20:22, 20:380].any(), "Mask rows above the band were erased"


def test_stimulus_window_extends_above_question_band():
    # Passages start under the page margin, above the box-search band; the
    # stimulus window must open at the page top (reported cut passages).
    bank = dict(converter.BANKS["meo"])
    pixels = np.full((1000, 2000, 3), 255, dtype=np.uint8)
    pixels[40:80, 30:900] = 60  # passage line above the 0.075 band
    pixels[300:340, 1100:1800] = 60  # stem line inside the band
    box = {"x0": 1090, "x1": 1810, "y0": 290, "y1": 350, "w": 720, "h": 60}
    result = converter.analyze_single(
        pixels, bank, is_spr=False, last_page=True,
        forced_boxes=[box, dict(box, y0=360, y1=420),
                      dict(box, y0=430, y1=490), dict(box, y0=500, y1=560)],
    )
    stim = result["stimulus_box"]
    assert stim["y0"] <= 40, "Stimulus crop starts below the passage line"
    assert stim["y1"] <= int(1000 * bank["content_bottom"]), (
        "Stimulus crop crosses the footer rule"
    )


def test_math_question_does_not_inherit_another_banks_missing_choice(
    tmp_path, monkeypatch
):
    # Question 84 in the hardest bank has a missing choice; August Math does not.
    source = tmp_path / "question-bank/hardest-sat-math-questions.pdf"
    source.parent.mkdir()
    with pymupdf.open() as doc:
        for _ in range(84):
            doc.new_page()
        doc.save(source)
    monkeypatch.setattr(converter, "ROOT", tmp_path)
    monkeypatch.setattr(converter, "OUT", tmp_path)
    monkeypatch.setattr(
        converter,
        "question_rows",
        lambda key: {("Math", "1", "84"): {"type": "multiple choice", "pages": [1]}},
    )
    box = {"page": 1, "x0": 10, "x1": 90, "y0": 10, "y1": 20}
    geometry = {
        "stem_box": box,
        "page_dims": {"1": [100, 100]},
        "choices": [
            dict(box, cy0=30 + i * 10, cy1=38 + i * 10, cx0=20, cx1=80)
            for i in range(4)
        ],
    }
    (tmp_path / "meo-math-analysis.json").write_text(
        json.dumps({str(("Math", "1", "84")): geometry})
    )
    converter.build_presentations(["meo-math"])
    result = json.loads((tmp_path / "meo-math-presentations.json").read_text())
    blocks = [c["content"][0] for c in result["Math:1:84"]["choices"]]
    assert all(b["kind"] == "region" for b in blocks)
    assert all(b["region"]["pageNumber"] == 1 for b in blocks)


@pytest.mark.parametrize("complete", [True, False])
def test_bank_publish_retires_bad_crops_only_after_replacement(
    tmp_path, monkeypatch, complete
):
    client = make_client(tmp_path)
    draft = math_draft(client)
    content = presentation()
    client.put(
        f"/api/import-drafts/{draft['id']}/questions/0/presentation", json=content
    )
    old = client.post(f"/api/import-drafts/{draft['id']}/publish").json()
    monkeypatch.setattr(converter, "ROOT", tmp_path)
    monkeypatch.setattr(converter, "OUT", tmp_path)
    monkeypatch.setattr(converter, "BANKS", {"fixture": {"package": old["id"]}})
    (tmp_path / "fixture-presentations.json").write_text(
        json.dumps({"Math:1:1": content} if complete else {})
    )
    if complete:
        converter.publish(["fixture"])
    else:
        with pytest.raises(ValueError, match="missing presentation"):
            converter.publish(["fixture"])
    from whitebook.authoring import PackageAuthoring

    authoring = PackageAuthoring(tmp_path / "data")
    available = authoring.list_packages()
    assert len(available) == 1, "Old box crops remain selectable for new practice"
    assert available[0]["revision"] == (2 if complete else 1)
    assert authoring.get_package(old["id"])["archived"] is complete
