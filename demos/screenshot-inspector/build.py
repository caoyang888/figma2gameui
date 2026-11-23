#!/usr/bin/env python3
"""Pack the checked-in synthetic fixture and original inspector into one offline page."""
from pathlib import Path
import json, sys

root = Path(__file__).resolve().parent
out = Path(sys.argv[1]) if len(sys.argv)==2 else root / "demo.html"
fixture = json.loads((root / "fixture.json").read_text(encoding="utf-8"))
fields = {
    "@@CSS@@": (root / "inspector.css").read_text(encoding="utf-8"),
    "@@JS@@": (root / "inspector.js").read_text(encoding="utf-8"),
    # Prevent a string inside the dataset from prematurely closing the script tag.
    "@@FIXTURE@@": json.dumps(fixture, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c"),
}
html = (root / "index.template.html").read_text(encoding="utf-8")
for key, value in fields.items():
    assert html.count(key) == 1, key
    html = html.replace(key, value)
out.write_text(html, encoding="utf-8")
print(out)
