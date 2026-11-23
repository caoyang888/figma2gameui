/** Node 24 shared SQLite store, readable by the original Python implementation. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import type { Plan } from './plan.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(
 id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, mime TEXT NOT NULL,
 kind TEXT NOT NULL, width INT NOT NULL, height INT NOT NULL, pixel_hash TEXT NOT NULL,
 uuid TEXT NOT NULL, bundle TEXT NOT NULL, path TEXT NOT NULL, data BLOB NOT NULL, created TEXT NOT NULL,
 UNIQUE(project,kind,pixel_hash), UNIQUE(project,path));
CREATE TABLE IF NOT EXISTS aliases(asset TEXT NOT NULL REFERENCES assets(id), name TEXT NOT NULL, file_hash TEXT NOT NULL,
 PRIMARY KEY(asset,name,file_hash));
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
 status TEXT NOT NULL, fingerprint TEXT NOT NULL, model_version TEXT NOT NULL,
 spec TEXT NOT NULL, reference BLOB, plan TEXT, error TEXT,
 created TEXT NOT NULL, updated TEXT NOT NULL, attempt INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS asset_usage(asset TEXT NOT NULL REFERENCES assets(id), job TEXT NOT NULL REFERENCES jobs(id),
 label TEXT NOT NULL, PRIMARY KEY(asset,job,label));
CREATE INDEX IF NOT EXISTS job_fingerprint ON jobs(project,fingerprint);
CREATE TABLE IF NOT EXISTS revisions(job TEXT NOT NULL REFERENCES jobs(id), created TEXT NOT NULL,
 status TEXT NOT NULL, plan TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), url TEXT NOT NULL,
 key BLOB NOT NULL, model TEXT NOT NULL, verified TEXT NOT NULL, version TEXT NOT NULL);
`;

type Row = Record<string, SQLOutputValue>;
export type StoredPlan = Plan;
export type ImportRow = { name: string; mime: string; kind: 'image' | 'font'; width: number; height: number;
  pixel_hash: string; file_hash: string; data: Uint8Array };
export type Asset = { id: string; name: string; mime: string; kind: string; width: number; height: number;
  uuid: string; bundle: string; path: string; pixelHash: string; aliases: string[]; tags: string[]; usedBy: string[] };
export type Spec = { assetIds: string[]; width: number | null; height: number | null;
  referenceMime: string | null; referenceDigest: string | null };
export type Settings = { configured: false; baseUrl: ''; model: ''; verifiedAt: null } |
  { configured: true; baseUrl: string; model: string; verifiedAt: string };
export type PrivateSettings = Exclude<Settings, { configured: true }> |
  (Extract<Settings, { configured: true }> & { key: string; version: string });
export type JobStatus = 'queued' | 'running' | 'review' | 'approved' | 'failed';
export type Job = { id: string; projectId: string; name: string; status: JobStatus; plan: StoredPlan | null; error: string | null;
  hasReference: boolean; createdAt: string; updatedAt: string; attempt: number };

export class NotFoundError extends Error {
  constructor() {
    super('未找到该项目、任务或资源。');
    this.name = 'NotFoundError';
  }
}

export class StoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreInputError';
  }
}

const jobCols = 'id,project,name,status,plan,error,created,updated,attempt,reference IS NOT NULL AS has_reference';
const newId = () => randomUUID().replaceAll('-', '');
const stamp = () => new Date().toISOString().replace('Z', '+00:00');
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'asset';

// Python str.strip() is not identical to ECMAScript trim (e.g. U+0085 and BOM).
const pyWhitespace = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;
export function clean_name(s: unknown, n = 80): string {
  if (typeof s === 'string') {
    const stripped = s.replace(pyWhitespace, '');
    // Reject invalid UTF-16 before SQLite can silently replace it.
    if (stripped && [...stripped].length <= n && !/[\u0000-\u001f]/u.test(s) && s.isWellFormed()) return stripped;
  }
  throw new StoreInputError(`请填写 1–${n} 字的有效名称。`);
}

function pyJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(pyJson).join(', ') + ']';
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return '{' + Object.keys(row).sort().map(k => pyJson(k) + ': ' + pyJson(row[k])).join(', ') + '}';
  }
  // Deliberately code-unit based to reproduce Python ensure_ascii surrogate pairs.
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function analysis_fingerprint(name: string, spec: Spec, model_version: string): string {
  return createHash('sha256').update(pyJson([name, spec, model_version])).digest('hex');
}

function b64url(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replaceAll('+', '-').replaceAll('/', '_');
}
function fromB64url(encoded: Uint8Array): Buffer {
  const s = Buffer.from(encoded).toString('latin1').replace(/[\t\n\r ]/g, '');
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('本地加密数据格式无效。');
  return Buffer.from(s, 'base64url');
}

/** Fernet v0x80: timestamp, random IV, AES-128-CBC ciphertext, SHA-256 HMAC. */
function encrypt(secret: Buffer, clear: string): Buffer {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', secret.subarray(16), iv);
  const header = Buffer.alloc(9);
  header[0] = 0x80;
  header.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 1);
  const unsigned = Buffer.concat([header, iv, cipher.update(clear, 'utf8'), cipher.final()]);
  const signature = createHmac('sha256', secret.subarray(0, 16)).update(unsigned).digest();
  return Buffer.from(b64url(Buffer.concat([unsigned, signature])), 'ascii');
}
function decrypt(secret: Buffer, compact: Uint8Array): string {
  const token = fromB64url(compact);
  if (token.length < 73 || token[0] !== 0x80 || (token.length - 57) % 16 !== 0) throw new Error('本地加密数据格式无效。');
  const unsigned = token.subarray(0, -32);
  const signature = createHmac('sha256', secret.subarray(0, 16)).update(unsigned).digest();
  if (!timingSafeEqual(signature, token.subarray(-32))) throw new Error('无法验证本地加密数据。');
  const cipher = createDecipheriv('aes-128-cbc', secret.subarray(16), token.subarray(9, 25));
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([cipher.update(token.subarray(25, -32)), cipher.final()]));
}

function parsed<T>(raw: SQLOutputValue): T { return JSON.parse(raw as string) as T; }
function projectRow(r?: Row) {
  if (!r) throw new NotFoundError();
  return { id: r.id as string, name: r.name as string, createdAt: r.created as string, cocosVersion: '3.8.8',
    bundles: ['common', 'gameResource'] };
}
function jobRow(r?: Row): Job {
  if (!r) throw new NotFoundError();
  return { id: r.id as string, projectId: r.project as string, name: r.name as string, status: r.status as JobStatus,
    plan: r.plan === null ? null : parsed<StoredPlan>(r.plan), error: r.error as string | null,
    hasReference: Boolean(r.has_reference), createdAt: r.created as string, updatedAt: r.updated as string, attempt: r.attempt as number };
}

export class Store {
  readonly root: string;
  readonly path: string;
  readonly #secret: Buffer;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const secret = join(root, 'settings.key');
    try {
      const fd = openSync(secret, 'wx', 0o600);
      try { writeFileSync(fd, b64url(randomBytes(32))); }
      finally { closeSync(fd); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    this.#secret = fromB64url(readFileSync(secret));
    if (this.#secret.length !== 32) throw new Error('本地加密密钥格式无效。');
    this.path = join(root, 'studio.sqlite');
    this.#db(db => { db.exec('PRAGMA journal_mode=WAL'); db.exec(SCHEMA); });
  }

  #db<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.path, { timeout: 15000, enableForeignKeyConstraints: true });
    try { return fn(db); }
    finally { db.close(); }
  }

  #tx<T>(fn: (db: DatabaseSync) => T): T {
    return this.#db(db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(db);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* Preserve original error. */ }
        throw error;
      }
    });
  }

  project(pid: string) {
    return this.#db(d => projectRow(d.prepare('SELECT * FROM projects WHERE id=?').get(pid)));
  }
  projects() {
    return this.#db(d => d.prepare('SELECT * FROM projects ORDER BY created DESC').all().map(projectRow));
  }
  create_project(name: unknown) {
    const id = newId();
    this.#db(d => d.prepare('INSERT INTO projects VALUES(?,?,?)').run(id, clean_name(name), stamp()));
    return this.project(id);
  }

  #asset(d: DatabaseSync, pid: string, a: ImportRow): string {
    const prior = d.prepare('SELECT id FROM assets WHERE project=? AND kind=? AND pixel_hash=?').get(pid, a.kind, a.pixel_hash);
    const aid = prior ? prior.id as string : newId();
    if (!prior) {
      const bundle = a.kind === 'font' ? 'common' : 'gameResource';
      const folder = a.kind === 'font' ? 'fonts' : 'textures';
      const originalExt = extname(a.name);
      const ext = a.kind === 'font' ? originalExt.toLowerCase() : '.png';
      const path = `${folder}/${slug(basename(a.name, originalExt))}-${a.pixel_hash.slice(0, 12)}${ext}`;
      d.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        aid, pid, a.name, a.mime, a.kind, a.width, a.height, a.pixel_hash, randomUUID(), bundle, path, a.data, stamp());
    }
    d.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?,?)').run(aid, a.name, a.file_hash);
    return aid;
  }

  assets(pid: string): Asset[] {
    return this.#db(d => {
      const alias = d.prepare('SELECT DISTINCT name FROM aliases WHERE asset=? ORDER BY name');
      const tag = d.prepare('SELECT DISTINCT label FROM asset_usage WHERE asset=? ORDER BY label LIMIT 30');
      const job = d.prepare('SELECT DISTINCT job FROM asset_usage WHERE asset=? ORDER BY job');
      return d.prepare(`SELECT id,name,mime,kind,width,height,uuid,bundle,path,pixel_hash AS pixelHash
                       FROM assets WHERE project=? ORDER BY name,id`).all(pid).map(r => ({
        ...r, aliases: alias.all(r.id).map(x => x.name), tags: tag.all(r.id).map(x => x.label), usedBy: job.all(r.id).map(x => x.job),
      } as Asset));
    });
  }
  asset_bytes(pid: string, aid: string): [string, Buffer] {
    const row = this.#db(d => d.prepare('SELECT mime,data FROM assets WHERE project=? AND id=?').get(pid, aid));
    if (!row) throw new NotFoundError();
    return [row.mime as string, Buffer.from(row.data as Uint8Array)];
  }

  set_model(url: string, key: string, model: string): void {
    this.#db(d => d.prepare(`INSERT INTO settings VALUES(1,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url,key=excluded.key,model=excluded.model,
      verified=excluded.verified,version=excluded.version`).run(url, encrypt(this.#secret, key), model, stamp(), newId()));
  }
  settings(privateSettings: true): PrivateSettings;
  settings(privateSettings?: false): Settings;
  settings(privateSettings = false): Settings | PrivateSettings {
    const row = this.#db(d => d.prepare(privateSettings ? 'SELECT * FROM settings WHERE id=1' :
      'SELECT url,model,verified FROM settings WHERE id=1').get());
    if (!row) return { configured: false, baseUrl: '', model: '', verifiedAt: null };
    const result = { configured: true as const, baseUrl: row.url as string, model: row.model as string,
      verifiedAt: row.verified as string };
    return privateSettings ? { ...result, key: decrypt(this.#secret, row.key as Uint8Array), version: row.version as string } : result;
  }

  submit(pid: string, rawName: unknown, raw_assets: ImportRow[], reference: ImportRow | null,
    width: number | null, height: number | null, model_version: string): Job {
    this.project(pid);
    const name = clean_name(rawName);
    const winner = this.#tx(d => {
      const assetIds = [...new Set(raw_assets.map(a => this.#asset(d, pid, a)))].sort();
      const spec = { assetIds, width, height, referenceMime: reference?.mime ?? null, referenceDigest: reference?.pixel_hash ?? null };
      const fingerprint = analysis_fingerprint(name, spec, model_version);
      const prior = d.prepare('SELECT id FROM jobs WHERE project=? AND fingerprint=? ORDER BY created DESC LIMIT 1').get(pid, fingerprint);
      if (prior) return prior.id as string;
      const jid = newId();
      d.prepare(`INSERT INTO jobs(id,project,name,status,fingerprint,model_version,spec,reference,created,updated)
        VALUES(?,?,?,'queued',?,?,?,?,?,?)`).run(jid, pid, name, fingerprint, model_version, JSON.stringify(spec),
        reference?.data ?? null, stamp(), stamp());
      return jid;
    });
    return this.job(winner);
  }
  job(jid: string): Job {
    return this.#db(d => jobRow(d.prepare(`SELECT ${jobCols} FROM jobs WHERE id=?`).get(jid)));
  }
  reference(jid: string): Buffer {
    const row = this.#db(d => d.prepare('SELECT reference FROM jobs WHERE id=?').get(jid));
    if (!row || row.reference === null) throw new NotFoundError();
    return Buffer.from(row.reference as Uint8Array);
  }
  project_jobs(pid: string): Job[] {
    return this.#db(d => d.prepare(`SELECT ${jobCols} FROM jobs WHERE project=? ORDER BY created DESC`).all(pid).map(jobRow));
  }
  recent_tasks() {
    return this.#db(d => d.prepare(`SELECT j.id,j.project,j.name,j.status,j.updated,p.name AS projectName
      FROM jobs j JOIN projects p ON j.project=p.id ORDER BY j.updated DESC,j.id LIMIT 100`).all().map(r => ({
      id: r.id as string, projectId: r.project as string, projectName: r.projectName as string, name: r.name as string,
      status: r.status as JobStatus, updatedAt: r.updated as string,
    })));
  }
  reset_interrupted(): void {
    this.#db(d => d.prepare("UPDATE jobs SET status='failed',error=?,updated=? WHERE status='running'")
      .run('服务重启中断了分析，可重试。', stamp()));
  }
  next_job() {
    return this.#tx(d => {
      const row = d.prepare("SELECT *,reference IS NOT NULL AS has_reference FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").get();
      if (!row) return null;
      d.prepare("UPDATE jobs SET status='running',attempt=attempt+1,updated=? WHERE id=?").run(stamp(), row.id);
      // Match the Python worker handoff: queue snapshot plus spec, with the transition persisted.
      return { ...jobRow(row), spec: parsed<Spec>(row.spec),
        reference: row.reference === null ? null : Buffer.from(row.reference as Uint8Array), modelVersion: row.model_version as string };
    });
  }
  set_outcome(jid: string, plan: StoredPlan | null = null, error: string | null = null): void {
    this.#tx(d => {
      const now = stamp();
      const raw = plan ? JSON.stringify(plan) : null;
      const status = plan ? 'review' : 'failed';
      const changed = d.prepare("UPDATE jobs SET status=?,plan=?,error=?,updated=? WHERE id=? AND status='running'")
        .run(status, raw, error, now, jid);
      if (raw && changed.changes) d.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(jid, now, status, raw);
    });
  }
  job_asset_ids(jid: string): Set<string> {
    const r = this.#db(d => d.prepare('SELECT spec FROM jobs WHERE id=?').get(jid));
    if (!r) throw new NotFoundError();
    return new Set(parsed<Spec>(r.spec).assetIds);
  }
  revisions(jid: string) {
    this.job(jid);
    return this.#db(d => d.prepare('SELECT created,status,plan FROM revisions WHERE job=? ORDER BY created DESC')
      .all(jid).map(r => ({ createdAt: r.created as string, status: r.status as JobStatus, plan: parsed<StoredPlan>(r.plan) })));
  }
  retry(jid: string, model_version: string): Job {
    const winner = this.#tx(d => {
      const row = d.prepare('SELECT name,spec,project,status FROM jobs WHERE id=?').get(jid);
      if (!row || row.status !== 'failed') throw new StoreInputError('只能重试失败的任务。');
      const fingerprint = analysis_fingerprint(row.name as string, parsed<Spec>(row.spec), model_version);
      const prior = d.prepare(`SELECT id FROM jobs WHERE project=? AND fingerprint=? AND id<>? AND status<>'failed'
        ORDER BY created DESC LIMIT 1`).get(row.project, fingerprint, jid);
      if (prior) return prior.id as string;
      d.prepare("UPDATE jobs SET status='queued',model_version=?,fingerprint=?,error=NULL,updated=? WHERE id=?")
        .run(model_version, fingerprint, stamp(), jid);
      return jid;
    });
    return this.job(winner);
  }
  approve(jid: string, plan: StoredPlan): Job {
    const raw = JSON.stringify(plan);
    this.#tx(d => {
      const now = stamp();
      const changed = d.prepare("UPDATE jobs SET status='approved',plan=?,error=NULL,updated=? WHERE id=? AND status='review'")
        .run(raw, now, jid);
      if (!changed.changes) throw new StoreInputError('任务尚不可确认。');
      d.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(jid, now, 'approved', raw);
      d.prepare('DELETE FROM asset_usage WHERE job=?').run(jid);
      const insert = d.prepare('INSERT OR IGNORE INTO asset_usage VALUES(?,?,?)');
      for (const node of plan.nodes) for (const aid of [node.assetId, node.fontAssetId]) if (aid) insert.run(aid, jid, node.name);
    });
    return this.job(jid);
  }
}
