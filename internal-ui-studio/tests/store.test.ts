import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Store, StoreInputError, NotFoundError, clean_name } from '../store.ts';
import type { ImportRow, StoredPlan } from '../store.ts';

const fixture: ImportRow = { name: '切图.PNG', mime: 'image/png', width: 8, height: 9, kind: 'image',
  pixel_hash: 'a'.repeat(64), file_hash: 'b'.repeat(64), data: Buffer.from([0, 1, 2, 255]) };
const reference = { ...fixture, name: 'reference.png', pixel_hash: 'c'.repeat(64), data: Buffer.from([3, 4, 0, 255]) };
const planFor = (assetId: string): StoredPlan => ({ width: 320, height: 480, issues: [], nodes: [
  { id: 'root', kind: 'container', parentId: null, name: '容器', x: 0, y: 0, width: 320, height: 480 },
  { id: 'sprite', kind: 'sprite', parentId: 'root', name: '图标', x: 0, y: 0, width: 8, height: 9, assetId },
] });
const provider = 'https://example.invalid/v1';

test('SQLite 数据范围、审批/重试、重启恢复和稳定资源', t => {
  const path = mkdtempSync(join(tmpdir(), 'figma-node-store-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const s = new Store(path);
  assert.deepEqual(s.settings(), {configured: false, baseUrl: '', model: '', verifiedAt: null});
  assert.equal(clean_name('\u0085测试😀　', 3), '测试😀');
  assert.throws(() => clean_name('测试😀', 2), StoreInputError);
  const p = s.create_project('项目甲');
  const q = s.create_project('项目乙');
  s.set_model(provider, 'test-only-access-key', 'vision-a');
  const setting = s.settings(true);
  assert.equal(setting.configured, true);
  if (!setting.configured) throw new Error('missing configuration');
  assert.equal(setting.key, 'test-only-access-key');
  assert.equal('key' in s.settings(), false);
  assert.equal(readFileSync(s.path).includes(Buffer.from('test-only-access-key')), false);
  assert.equal(statSync(join(path, 'settings.key')).mode & 0o777, 0o600);
  const j = s.submit(p.id, '界面😀', [fixture], reference, 320, 480, setting.version);
  const repeat = s.submit(p.id, '界面😀', [{...fixture, name: 'alias.png', file_hash: 'd'.repeat(64)}], reference, 320, 480, setting.version);
  assert.equal(j.id, repeat.id);
  const [asset] = s.assets(p.id);
  assert.deepEqual(asset.aliases, ['alias.png', fixture.name]);
  assert.deepEqual(s.asset_bytes(p.id, asset.id), [fixture.mime, fixture.data]);
  assert.throws(() => s.asset_bytes(q.id, asset.id), NotFoundError);
  assert.deepEqual(s.reference(j.id), reference.data);
  assert.equal(s.next_job()?.id, j.id);
  assert.equal(s.job(j.id).attempt, 1);
  const plan = planFor(asset.id);
  s.set_outcome(j.id, plan);
  assert.equal(s.approve(j.id, plan).status, 'approved');
  assert.throws(() => s.approve(j.id, plan), StoreInputError);
  assert.throws(() => s.retry(j.id, setting.version), StoreInputError);
  assert.equal(s.revisions(j.id).length, 2);
  assert.deepEqual(s.assets(p.id)[0].tags, ['图标']);
  assert.deepEqual(s.assets(p.id)[0].usedBy, [j.id]);
  assert.deepEqual(s.job_asset_ids(j.id), new Set([asset.id]));
  const next = s.submit(p.id, '恢复', [], null, null, null, setting.version);
  assert.equal(s.next_job()?.id, next.id);
  s.reset_interrupted();
  assert.equal(s.job(next.id).status, 'failed');
  assert.equal(s.retry(next.id, 'next-model-version').status, 'queued');
  assert.equal(s.submit(p.id, '恢复', [], null, null, null, 'next-model-version').id, next.id);
  assert.equal(s.next_job()?.id, next.id);
  assert.equal(s.job(next.id).attempt, 2);
  assert.equal(s.recent_tasks().length, 2);
  const reopened = new Store(path);
  assert.equal(reopened.assets(p.id)[0].uuid, asset.uuid);
});

// Captured from legacy Python Store via sqlite3.Connection.iterdump().
// Public synthetic fixture: Store was seeded with Fernet bytes(range(32)), fixed
// test UUIDs/UTC stamp (2026-01-01), and Fernet's _encrypt_from_parts used the
// same timestamp and bytes(range(16)) IV to make this vector reproducible.
// Never use the deterministic key or IV for real data.
const pythonSeedSql = `
BEGIN TRANSACTION;
CREATE TABLE aliases(asset TEXT NOT NULL REFERENCES assets(id), name TEXT NOT NULL, file_hash TEXT NOT NULL,
 PRIMARY KEY(asset,name,file_hash));
INSERT INTO "aliases" VALUES('33333333333333333333333333333333','切图.PNG','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
CREATE TABLE asset_usage(asset TEXT NOT NULL REFERENCES assets(id), job TEXT NOT NULL REFERENCES jobs(id),
 label TEXT NOT NULL, PRIMARY KEY(asset,job,label));
CREATE TABLE assets(
 id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, mime TEXT NOT NULL,
 kind TEXT NOT NULL, width INT NOT NULL, height INT NOT NULL, pixel_hash TEXT NOT NULL,
 uuid TEXT NOT NULL, bundle TEXT NOT NULL, path TEXT NOT NULL, data BLOB NOT NULL, created TEXT NOT NULL,
 UNIQUE(project,kind,pixel_hash), UNIQUE(project,path));
INSERT INTO "assets" VALUES('33333333333333333333333333333333','11111111111111111111111111111111','切图.PNG','image/png','image',8,9,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','11111111-2222-4333-8444-555555555555','gameResource','textures/asset-aaaaaaaaaaaa.png',X'000102FF','2026-01-01T00:00:00.000+00:00');
CREATE TABLE jobs(
 id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
 status TEXT NOT NULL, fingerprint TEXT NOT NULL, model_version TEXT NOT NULL,
 spec TEXT NOT NULL, reference BLOB, plan TEXT, error TEXT,
 created TEXT NOT NULL, updated TEXT NOT NULL, attempt INT NOT NULL DEFAULT 0);
INSERT INTO "jobs" VALUES('44444444444444444444444444444444','11111111111111111111111111111111','界面😀','queued','e2c9405876f34229db6ddf4798e923ee631a2be362eb6bba994b90dbb9223721','22222222222222222222222222222222','{"assetIds": ["33333333333333333333333333333333"], "width": 320, "height": 480, "referenceMime": "image/png", "referenceDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',X'030400FF',NULL,NULL,'2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00',0);
CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
INSERT INTO "projects" VALUES('11111111111111111111111111111111','双向测试🧪','2026-01-01T00:00:00.000+00:00');
CREATE TABLE revisions(job TEXT NOT NULL REFERENCES jobs(id), created TEXT NOT NULL,
 status TEXT NOT NULL, plan TEXT NOT NULL);
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), url TEXT NOT NULL,
 key BLOB NOT NULL, model TEXT NOT NULL, verified TEXT NOT NULL, version TEXT NOT NULL);
INSERT INTO "settings" VALUES(1,'https://example.invalid/v1',X'674141414141427056626B4141414543417751464267634943516F4C4441304F44795548676A50614638714F4D70596D4C56645651373232615F48646C534C4F6E76705654437255624A56545F307A4A764B434E3476554149687141487549686861644C5966776675557A4A596C434D4A7968416B62453D','vision-1','2026-01-01T00:00:00.000+00:00','22222222222222222222222222222222');
CREATE INDEX job_fingerprint ON jobs(project,fingerprint);
COMMIT;
`;

test('读取 Python 生成的合成 SQLite、Fernet 与 Unicode 指纹，再用 Node 续写', t => {
  const path = mkdtempSync(join(tmpdir(), 'figma-store-interop-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const keyPath = join(path, 'settings.key');
  const fixtureKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');
  writeFileSync(keyPath, fixtureKey, { mode: 0o600 });
  // Python iterdump writes in table-name order, so foreign keys are enabled
  // after the intact captured dump has been restored, not during replay.
  const legacy = new DatabaseSync(join(path, 'studio.sqlite'), { enableForeignKeyConstraints: false });
  try {
    legacy.exec(pythonSeedSql);
    assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { legacy.close(); }

  const [pid, version, aid, jid] = ['1', '2', '3', '4'].map(x => x.repeat(32));
  const s = new Store(path);
  const saved = s.settings(true);
  assert.ok(saved.configured);
  assert.equal(saved.key, 'python-test-only');
  assert.equal(saved.version, version);
  assert.equal(saved.model, 'vision-1');
  assert.equal(s.project(pid).name, '双向测试🧪');
  assert.equal(s.job(jid).name, '界面😀');
  assert.equal(s.assets(pid)[0].id, aid);
  assert.equal(s.assets(pid)[0].uuid, '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(s.asset_bytes(pid, aid), [fixture.mime, fixture.data]);
  assert.deepEqual(s.reference(jid), reference.data);
  // This lookup must compute exactly the same SHA as Python json.dumps.
  assert.equal(s.submit(pid, '界面😀', [fixture], reference, 320, 480, version).id, jid);
  assert.equal(s.project_jobs(pid).length, 1);
  assert.equal(s.next_job()?.id, jid);
  const plan = planFor(aid);
  s.set_outcome(jid, plan);
  s.approve(jid, plan);
  s.set_model(provider, 'node-test-only', 'vision-2');
  const reopened = new Store(path);
  assert.ok(reopened.settings(true).configured);
  assert.equal(reopened.settings(true).model, 'vision-2');
  assert.equal(readFileSync(keyPath, 'ascii'), fixtureKey);
  assert.deepEqual(reopened.assets(pid)[0].tags, ['图标']);
  assert.deepEqual(reopened.assets(pid)[0].usedBy, [jid]);
  assert.equal(reopened.revisions(jid).length, 2);

  const d = new DatabaseSync(s.path);
  try {
    const token = d.prepare('SELECT key FROM settings').get()?.key as Uint8Array;
    const damaged = Buffer.from(token);
    damaged[20] = damaged[20] === 65 ? 66 : 65;
    d.prepare('UPDATE settings SET key=?').run(damaged);
  } finally { d.close(); }
  assert.throws(() => s.settings(true), /无法验证本地加密数据/);
  assert.equal(s.settings().model, 'vision-2');
});
