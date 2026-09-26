from pathlib import Path

from tests.test_attempt_api import make_client


def test_only_calculator_frame_allows_eval_and_cannot_access_parent_origin(
    tmp_path: Path,
):
    client = make_client(tmp_path)
    main = client.get("/api/health")
    frame = client.get("/app/calculator-frame")
    assert frame.status_code == 200
    assert "unsafe-eval" not in main.headers["content-security-policy"]
    policy = frame.headers["content-security-policy"]
    assert "sandbox allow-scripts;" in policy
    assert "allow-same-origin" not in policy
    assert "unsafe-eval" in policy
    assert "font-src data:" in policy
    assert "frame-ancestors 'self'" in policy
    assert "event.source !== parent" in frame.text
