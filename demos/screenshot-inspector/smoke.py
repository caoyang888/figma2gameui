"""Offline Chromium smoke test; run build.py first. Requires playwright and Chromium."""
import json, os, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
fixture = json.loads((ROOT / "fixture.json").read_text())
nodes = fixture["nodes"]
node_ids = {n["id"] for n in nodes}
assets = [n for n in nodes if n.get("asset")]
assert len(node_ids) == len(nodes)
assert assets and all(n.get("parent") in node_ids or n.get("parent") is None for n in nodes)
assert fixture["layoutContract"].get("engineVerified") is False

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"), args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1200, "height": 920})
    errors, network = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda request: network.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.goto((ROOT / "demo.html").as_uri())
    expect(page.locator("#tree .row")).to_have_count(len(nodes))
    expect(page.locator("#gallery .tile")).to_have_count(len(assets))
    for n in assets:
        image = page.locator(f'#gallery [data-node="{n["id"]}"] img')
        image.scroll_into_view_if_needed()
        expect(image).to_have_js_property("complete", True)
        assert image.evaluate("(n) => [n.naturalWidth,n.naturalHeight]") == n["size"]
    page.locator("#tree .row[data-node='safeArea']").click()
    sizes = []
    for button in page.locator("#scenarios button").all():
        button.click()
        expect(page.locator("#fit-summary")).to_contain_text("检查通过")
        sizes.append(page.locator("#details .sizeinfo", has_text="视口区域").inner_text())
        hits = page.locator("#fit-view button")
        assert hits.count() == sum(bool(n.get("input")) for n in nodes)
    assert len(sizes) == len(set(sizes)) == 3
    page.locator("#toggle-hits").uncheck()
    expect(page.locator("#fit-view button")).to_have_count(0)
    page.locator("[data-filter=cut]").click()
    expect(page.locator("#tree .row").first).to_be_visible()
    with page.expect_download() as ev:
        page.locator("#save-tree").click()
    downloaded = json.loads(ev.value.path().read_text())
    assert len(downloaded["nodes"]) == len(nodes)
    assert [x["id"] for x in downloaded["nodes"]] == [x["id"] for x in nodes]
    assert "data:image" not in json.dumps(downloaded)
    assert not errors and not network, (errors, network)
    browser.close()
print(f"PASS: {len(nodes)} nodes, {len(assets)} PNGs, {len(sizes)} viewports, offline export")
