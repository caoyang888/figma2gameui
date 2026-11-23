import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AssetImportError, MAX_UPLOAD_BYTES, parse_inputs, preview_image } from './asset_import.ts';
import type { ExportAsset, ExportJob } from './export_cocos.ts';
import { build_zip } from './export_cocos.ts';
import { PlanValidationError, validate_plan, PLAN_INSTRUCTIONS } from './plan.ts';
import { ProviderError, list_models, probe_vision, analyze } from './provider.ts';
import { NotFoundError, Store, StoreInputError, clean_name } from './store.ts';

const BODY_LIMIT = Math.floor((MAX_UPLOAD_BYTES * 4 + 2) / 3) + 512 * 1024;
const ID = '[a-f0-9]{32}';
const PROJECT = new RegExp('^/api/projects/('+ID+')(?:/(jobs|export\\.zip|assets(?:/'+ID+')?))?$');
const JOB = new RegExp('^/api/jobs/('+ID+')(?:/(retry|approve|revisions|reference|export\\.zip))?$');
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const HASH = (s: string) => createHash('sha256').update(s).digest();
class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
type Row = Record<string, unknown>;
const object = (a: unknown): a is Row => typeof a === 'object' && a !== null && !Array.isArray(a);
function fromBase64(s: string): Buffer {
  const b = Buffer.from(s, 'base64');
  if (b.toString('base64') !== s) throw new AppError('上传内容格式不正确。');
  return b;
}
function dimension(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 16384) throw new AppError('画布尺寸须为 1–16384 的整数。');
  return v;
}
async function files(rows: unknown) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 256) throw new AppError('请选择 1–256 个素材或 ZIP 文件。');
  let total = 0;
  const pairs = rows.map((r: unknown) => {
    if (!object(r) || typeof r.content !== 'string') throw new AppError('上传内容格式不正确。');
    const bytes = fromBase64(r.content);
    total += bytes.length;
    if (total > MAX_UPLOAD_BYTES) throw new AppError('上传总大小超过 32 MiB。');
    return [clean_name(r.name, 255), bytes] as const;
  });
  return parse_inputs(pairs);
}
type Asset = ReturnType<Store['assets']>[number];
function wirePlan(raw: unknown, assets: Asset[], width?: number | null, height?: number | null) {
  const plan = validate_plan(raw, new Set(assets.map(a => a.id)));
  if ((width && plan.width !== width) || (height && plan.height !== height)) throw new AppError('方案画布与参考图或指定尺寸不一致。');
  const by = new Map(assets.map(a => [a.id, a]));
  for (const n of plan.nodes) {
    if (n.assetId && by.get(n.assetId)?.kind !== 'image') throw new AppError('贴图节点必须引用图片。');
    if (n.fontAssetId && by.get(n.fontAssetId)?.mime !== 'font/ttf') throw new AppError('Creator 3.8.8 导出的 Label 请绑定 TTF 字体，或使用系统字体。');
  }
  return plan;
}
function knownError(e: unknown): e is Error {
  return e instanceof AppError || e instanceof ProviderError || e instanceof PlanValidationError || e instanceof AssetImportError || e instanceof StoreInputError;
}

export function createStudio(path: string, env: NodeJS.ProcessEnv = process.env,
                            provider = { list_models, probe_vision, analyze }) {
  const password = env.F2_WORKSPACE_PASSWORD ?? '';
  const local = env.F2_DEV_LOCAL === '1';
  const site = (env.F2_SITE_ORIGIN ?? '').replace(/\/+$/, '');
  const host = env.F2_HOST ?? '127.0.0.1';
  const port = Number(env.F2_PORT ?? '8765');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('F2_PORT must be a valid port.');
  if (local && !['127.0.0.1', 'localhost'].includes(host)) throw new Error('F2_DEV_LOCAL=1 is loopback-only; never put it behind a reverse proxy.');
  if (!local) {
    const u = URL.canParse(site) ? new URL(site) : null;
    if (password.length < 16 || !u || u.protocol !== 'https:' || u.origin !== site || u.username || u.password) {
      throw new Error('Company mode requires F2_WORKSPACE_PASSWORD (16+ chars) and a complete HTTPS F2_SITE_ORIGIN.');
    }
  }
  const store = new Store(path);
  store.reset_interrupted();
  let probeBusy = false, probeNext = 0, working = false, stopped = false;
  let tick: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    if (stopped || working || tick) return;
    tick = setTimeout(() => { tick = undefined; void work(); }, 0);
    tick.unref();
  };
  async function work() {
    if (stopped || working) return;
    working = true;
    try {
      const job = store.next_job();
      if (!job) return;
      try {
        const cfg = store.settings(true);
        if (!cfg.configured || cfg.version !== job.modelVersion) throw new AppError('识图模型配置已变更，请使用新配置重试。');
        const aids = new Set(job.spec.assetIds);
        const assets = store.assets(job.projectId).filter(a => aids.has(a.id));
        const refs: { id: string; data?: Buffer }[] = job.spec.assetIds
          .filter(id => assets.some(a => a.id === id && a.kind === 'image')).map(id => ({ id }));
        if (job.reference) refs.unshift({ id: 'reference', data: job.reference });
        if (refs.length > 24) throw new AppError('每个界面的 AI 分析最多接受 24 张图（含参考图）。');
        let sum = 0;
        const images: { id: string; mime: string; data: Buffer }[] = [];
        for (const item of refs) {
          const data = await preview_image(item.data ?? store.asset_bytes(job.projectId, item.id)[1]);
          sum += data.length;
          if (sum > 5 * 1024 * 1024) throw new AppError('处理后的图片总大小超过 5 MiB，请按界面拆分再试。');
          images.push({ id: item.id, mime: 'image/png', data });
        }
        const context = { screen: job.name, has_reference: Boolean(job.reference), width: job.spec.width,
          height: job.spec.height, assets: assets.filter(a => a.kind !== 'font' || a.mime === 'font/ttf')
            .map(({id,name,width,height,kind,tags}) => ({id,name,width,height,kind,tags})), contract: PLAN_INSTRUCTIONS };
        const result = await provider.analyze(cfg.baseUrl, cfg.key, cfg.model, images, context);
        store.set_outcome(job.id, wirePlan(result, assets, context.width, context.height));
      } catch (e) {
        store.set_outcome(job.id, null, knownError(e) ? e.message : '分析中断，请检查服务状态后重试。');
      }
      working = false; kick();
    } catch {
      // Do not put model responses, credentials or upload data in logs.
    } finally {
      working = false;
    }
  }
  function session(req: IncomingMessage): boolean {
    if (!password) return local && ['127.0.0.1','::1'].includes(req.socket.remoteAddress ?? '') &&
      /^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(req.headers.host ?? '') &&
      !['forwarded','x-forwarded-for','x-forwarded-host'].some(h => req.headers[h] !== undefined);
    const m = /^basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.headers.authorization ?? '');
    if (!m) return false;
    try {
      const credentials = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(m[1]));
      return timingSafeEqual(HASH(credentials), HASH('studio:' + password));
    } catch { return false; }
  }
  function write(res: ServerResponse, status: number, data: Buffer, mime: string, headers: Record<string,string> = {}) {
    res.writeHead(status, { 'Content-Type': mime, 'Content-Length': String(data.length), 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': CSP, ...headers });
    res.end(data);
  }
  const json = (res: ServerResponse, data: unknown, status = 200, headers?: Record<string,string>) =>
    write(res, status, Buffer.from(JSON.stringify(data)), 'application/json; charset=utf-8', headers);
  async function body(req: IncomingMessage): Promise<Row> {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AppError('只接受 JSON 请求。',415);
    const origin = req.headers.origin;
    if (origin && origin !== (site || 'http://' + (req.headers.host ?? ''))) throw new AppError('请求来源不符。',403);
    const size = req.headers['content-length'];
    if (!size || !/^\d+$/.test(size)) throw new AppError('请求长度无效。');
    const n = Number(size);
    if (n <= 0 || n > BODY_LIMIT) throw new AppError('请求为空或超过上传限制。',413);
    const chunks: Buffer[] = [];
    let read = 0;
    for await (const chunk of req) {
      const b: Buffer = chunk;
      read += b.length;
      if (read > n) throw new AppError('请求长度无效。');
      chunks.push(b);
    }
    if (read !== n) throw new AppError('请求长度无效。');
    let v: unknown;
    try { v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, n))); }
    catch { throw new AppError('JSON 格式无效。'); }
    if (!object(v)) throw new AppError('应传入 JSON 对象。');
    return v;
  }
  function credentials(b: Row) {
    const url = clean_name(b.baseUrl, 512).replace(/\/+$/, '');
    const value = b.apiKey ?? '';
    let key: string;
    if (typeof value !== 'string' || !/^[\x20-\x7e]{0,4096}$/.test(value)) throw new AppError('API 密钥格式无效。');
    key = value;
    if (!key) {
      const cur = store.settings(true);
      if (url === cur.baseUrl && cur.configured) key = cur.key;
      else throw new AppError('请填写 API 密钥。');
    }
    return { url, key };
  }
  function exportZip(res: ServerResponse, p: ReturnType<Store['project']>, jobs: ReturnType<Store['project_jobs']>, mode: 'project'|'interface') {
    if (!jobs.length) throw new AppError('请先确认至少一个界面。',409);
    const assets = new Map(store.assets(p.id).map(a => [a.id, a as ExportAsset]));
    const data = build_zip(p, jobs as ExportJob[], assets, aid => store.asset_bytes(p.id, aid)[1], mode === 'project');
    write(res, 200, data, 'application/zip', { 'Content-Disposition': 'attachment; filename="ui-studio-' + mode + '.zip"' });
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    if (!session(req)) return json(res, {error:'请先登录工作台。'}, 401, {'WWW-Authenticate':'Basic realm="UI Studio", charset="UTF-8"'});
    const path = (req.url ?? '').split('?')[0], method = req.method;
    if (method !== 'GET' && method !== 'POST') throw new NotFoundError();
    const staticFile = STATIC.get(path);
    if (method === 'GET' && staticFile) return write(res,200,readFileSync(new URL('./web/'+staticFile[0],import.meta.url)),staticFile[1]);
    if (path === '/api/settings' && method === 'GET') return json(res, store.settings());
    if (method === 'POST' && (path === '/api/settings/models' || path === '/api/settings/default')) {
      const b = await body(req), { url, key } = credentials(b);
      if (path.endsWith('/models')) return json(res,{models:await provider.list_models(url,key)});
      if (probeBusy || performance.now() < probeNext) throw new AppError('模型验证请求过于频繁，请稍后重试。',429);
      probeBusy = true;
      probeNext = performance.now() + 2000;
      try {
        const model = clean_name(b.model,200);
        const result = await provider.probe_vision(url,key,model);
        if (result.vision !== true || result.ok !== true) throw new AppError('模型未通过真实识图验证。');
        store.set_model(url,key,model);
      } finally { probeBusy = false; }
      return json(res,store.settings());
    }
    if (path === '/api/jobs' && method === 'GET') return json(res,{jobs:store.recent_tasks()});
    if (path === '/api/projects') return method === 'GET' ? json(res,{projects:store.projects()}) :
      json(res,store.create_project((await body(req)).name),201);
    const m = PROJECT.exec(path);
    if (m) {
      const [,pid,action] = m, p = store.project(pid);
      if (!action && method === 'GET') return json(res,{project:p,assets:store.assets(pid),jobs:store.project_jobs(pid)});
      if (action?.startsWith('assets/') && method === 'GET') {
        const [mime,data] = store.asset_bytes(pid,action.split('/')[1]); return write(res,200,data,mime);
      }
      if (action === 'jobs' && method === 'POST') {
        const b = await body(req), cfg = store.settings(true);
        if (!cfg.configured) throw new AppError('请先在设置中验证并启用识图模型。',409);
        const raw = !b.files || (Array.isArray(b.files) && !b.files.length) ? [] : await files(b.files);
        if (b.reference && (!object(b.reference) || typeof b.reference.name !== 'string' || !/\.(png|jpe?g|webp)$/i.test(b.reference.name))) throw new AppError('参考图必须是一张 PNG、JPEG 或 WebP。');
        const refs = b.reference ? await files([b.reference]) : [];
        if (refs.length && (refs.length !== 1 || refs[0].kind !== 'image')) throw new AppError('参考图必须是一张 PNG、JPEG 或 WebP。');
        if (!raw.some(a => a.kind === 'image') && !refs.length) throw new AppError('至少上传一张图片用于识图。');
        const ref = refs[0] ?? null;
        let w = dimension(b.width), h = dimension(b.height);
        if ((w === null) !== (h === null)) throw new AppError('画布宽与高应同时填写，或留空。');
        if (ref && !w) { w = ref.width; h = ref.height; }
        const job = store.submit(pid,b.name,raw,ref,w,h,cfg.version);
        kick();
        return json(res,job,202);
      }
      if (action === 'export.zip' && method === 'GET') return exportZip(res,p,store.project_jobs(pid).filter(j => j.status === 'approved'),'project');
    }
    const j = JOB.exec(path);
    if (j) {
      const [,jid,action] = j, job = store.job(jid);
      if (!action && method === 'GET') return json(res,job);
      if (action === 'reference' && method === 'GET') return write(res,200,store.reference(jid),'image/png');
      if (action === 'revisions' && method === 'GET') return json(res,{revisions:store.revisions(jid)});
      if (action === 'retry' && method === 'POST') {
        await body(req); const cfg = store.settings(true);
        if (!cfg.configured) throw new AppError('请先配置识图模型。',409);
        const next = store.retry(jid,cfg.version); kick();
        return json(res,next,202);
      }
      if (action === 'approve' && method === 'POST') {
        const b = await body(req), assets = store.assets(job.projectId);
        const previous: Row = object(job.plan) ? job.plan : {};
        const plan = wirePlan(b.plan,assets,typeof previous.width === 'number' ? previous.width : null,typeof previous.height === 'number' ? previous.height : null);
        if (plan.issues.some(x => x.severity === 'error')) throw new AppError('还有阻塞问题；补素材、修订方案或确认替代方式后再导出。',409);
        return json(res,store.approve(jid,plan));
      }
      if (action === 'export.zip' && method === 'GET' && job.status === 'approved') return exportZip(res,store.project(job.projectId),[job],'interface');
    }
    throw new NotFoundError();
  }
  const server = createServer({requestTimeout:45000,headersTimeout:12000},(req,res) => {
    void route(req,res).catch((e: unknown) => {
      if (res.destroyed || res.headersSent) { res.destroy(); return; }
      if (knownError(e)) json(res,{error:e.message},e instanceof AppError ? e.status : 400);
      else if (e instanceof NotFoundError) json(res,{error:'未找到该项目、任务或资源。'},404);
      else json(res,{error:'服务器暂未完成请求。'},500);
    });
  });
  server.setTimeout(45000, socket => socket.destroy());
  server.once('listening',kick);
  server.once('close',() => { stopped = true; if (tick) clearTimeout(tick); });
  return {server,host,port};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { server, host, port } = createStudio(process.env.F2_DATA_DIR ?? './studio-data');
    server.on('error', (e: NodeJS.ErrnoException) => {
      console.error('服务无法启动：' + (e.code ?? 'UNKNOWN')); process.exitCode = 1;
    });
    server.listen(port,host,() => {
      const actual = server.address(); console.log('UI Studio listening on ' + host + ':' + (typeof actual === 'object' ? actual?.port : port));
    });
    for (const s of ['SIGINT','SIGTERM'] as const) process.once(s, () => {server.close();});
  } catch (e) {
    console.error(e instanceof Error && /^F2_|^Company mode/.test(e.message) ? e.message : '工作台启动失败；检查数据目录和配置。');
    process.exitCode = 1;
  }
}
