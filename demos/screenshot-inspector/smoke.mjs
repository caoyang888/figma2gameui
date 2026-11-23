import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const fixture = JSON.parse(read('fixture.json'));
const js = read('inspector.js');
const html = read('demo.html');
assert.equal(html.includes('@@FIXTURE@@'), false);
assert.equal(html.includes('http://') || html.includes('https://'), false);
assert.deepEqual(
  JSON.parse(html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1]),
  fixture,
);
const nodes = new Map(fixture.nodes.map((n) => [n.id, n]));
assert.equal(nodes.size, fixture.nodes.length);
const sprites = fixture.nodes.filter((n) => n.asset);
for (const n of nodes.values()) {
  if (n.parent) assert(nodes.has(n.parent), n.id);
  if (!n.asset) continue;
  assert.match(n.image, /^data:image\/png;base64,/);
  const png = Buffer.from(n.image.split(',')[1], 'base64');
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], n.size, n.id);
  assert(png.includes(Buffer.from('tRNS')), n.id);
}
const fit = js.slice(js.indexOf('function fitLobby'), js.indexOf("document.querySelector('#building-compare')"));
const hits = js.slice(js.indexOf('function planHits'));
const { fitLobby, planHits } = runInNewContext(fit + hits + '; ({fitLobby,planHits})');
const count = fixture.nodes.filter((n) => n.input).length;
for (const [label, W, H, T, B] of fixture.presets) {
  const layout = fitLobby(fixture, W, H, T, B);
  assert(layout.passed, label);
  const areas = planHits(fixture, layout, W, H, T, B);
  assert.equal(areas.length, count);
  for (const area of areas) {
    const [x, y, w, h] = area.rect;
    assert(x >= 0 && y >= T && x + w <= W + 1e-7 && y + h <= H - B + 1e-7, area.id);
    assert(w >= 44 && h >= 44, area.id);
  }
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const [x, y, w, h] = areas[i].rect, [X, Y, ww, hh] = areas[j].rect;
      assert(x + w <= X || X + ww <= x || y + h <= Y || Y + hh <= y,
        `${label}: hit areas overlap: ${areas[i].id}, ${areas[j].id}`);
    }
  }
}
console.log(`PASS: ${nodes.size} nodes, ${sprites.length} transparent PNGs, ${count} non-overlapping hit areas per viewport, ${fixture.presets.length} viewports`);
