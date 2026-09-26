"""Republish the player fixtures as revision 2 through the supported
revision workflow (start_package_revision -> presentations -> publish)."""

from pathlib import Path
import json
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_fixtures import PRESENTATIONS, request  # noqa: E402

lock = json.loads(
    (Path(__file__).parent / "runtime/runtime/instance.json").read_text()
)
base = f"http://{lock['host']}:{lock['port']}"
token = lock["token"]

status, packages = request("GET", f"{base}/api/test-packages", token=token)
assert status == 200
package = packages[0]
print("revising", package["id"], "revision", package["revision"])

status, revision = request(
    "POST", f"{base}/api/test-packages/{package['id']}/revision", {}, token
)
assert status == 201, (status, revision)
print("revision draft", revision["id"], revision["revisionOfPackageId"])

for index, presentation in PRESENTATIONS.items():
    status, body = request(
        "PUT",
        f"{base}/api/import-drafts/{revision['id']}/questions/{index}/presentation",
        presentation,
        token,
    )
    assert status == 200, (index, status, body)

status, published = request(
    "POST", f"{base}/api/import-drafts/{revision['id']}/publish", {}, token
)
assert status == 201, (status, published)
print("published revision", published["revision"], published["id"])
