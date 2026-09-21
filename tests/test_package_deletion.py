from pathlib import Path

from tests.test_simulation_engine import publish_full_package
from whitebook.authoring import PackageAuthoring

REGION = {
    "page_number": 1,
    "x": 0.05,
    "y": 0.05,
    "width": 0.9,
    "height": 0.9,
    "confirmed": True,
}


def test_permanently_delete_keeps_a_source_pdf_shared_with_live_drafts(
    tmp_path: Path,
):
    package = publish_full_package(tmp_path)
    authoring = PackageAuthoring(tmp_path)

    revision_draft = authoring.start_package_revision(package["id"])
    for index in range(revision_draft.question_count):
        authoring.set_question_regions(revision_draft.id, index, [REGION])
    revision = authoring.publish(revision_draft.id)

    live_draft = authoring.start_package_revision(revision["id"])
    stored = authoring.package_source_pdf(package["id"])
    assert stored is not None

    authoring.permanently_delete(package["id"], package["title"])

    assert stored.is_file()
    assert authoring.package_source_pdf(revision["id"]) == stored
    assert authoring.source_pdf(live_draft.id) == stored


def test_permanently_delete_removes_the_source_pdf_when_unreferenced(
    tmp_path: Path,
):
    package = publish_full_package(tmp_path)
    authoring = PackageAuthoring(tmp_path)
    stored = authoring.package_source_pdf(package["id"])
    assert stored is not None

    authoring.permanently_delete(package["id"], package["title"])

    assert not stored.is_file()
