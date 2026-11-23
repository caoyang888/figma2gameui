'use strict';
(() => {
const app = document.getElementById('app');
const $ = (id) => document.getElementById(id);
const state = { page: 'projects', projects: [], projectId: null, detail: null, job: null, draft: null, selection: null, timer: null, revision: 0, jobRequest: 0, reference: false };
const links = {
  projects: '/api/projects',
  project: (id) => '/api/projects/' + encodeURIComponent(id),
  jobs: (id) => '/api/jobs/' + encodeURIComponent(id),
  asset: (project, id) => links.project(project) + '/assets/' + encodeURIComponent(id)
};
const statuses = {
  queued: ['排队中','busy'], pending: ['排队中','busy'], running: ['处理中','busy'], processing: ['处理中','busy'],
  review: ['待复核','wait'], needs_review: ['待复核','wait'], ready_for_review: ['待复核','wait'], ready: ['待复核','wait'], candidate: ['待复核','wait'],
  approved: ['已批准','ok'], exported: ['已批准','ok'], completed: ['处理完成','ok'], succeeded: ['处理完成','ok'], done: ['处理完成','ok'],
  failed: ['处理失败','bad'], error: ['处理失败','bad'], cancelled: ['已取消','bad']
};
const KIND = {container:'容器',sprite:'图像',label:'文本',button:'按钮',layout:'布局'};
const busy = (job) => ['queued','pending','running','processing'].includes(job?.status);
const failed = (job) => ['failed','error','cancelled'].includes(job?.status);
const approved = (job) => ['approved','exported'].includes(job?.status);
const nameOf = (entry, fallback = '未命名') => entry?.name || entry?.filename || fallback;
const elapsed = (size) => typeof size === 'number' ? (size < 1024 ? size + ' B' : size < 1048576 ? (size/1024).toFixed(1) + ' KB' : (size/1048576).toFixed(1) + ' MB') : '';
const imageFile = (asset) => String(asset?.mimeType || asset?.contentType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(nameOf(asset, ''));
const array = (payload,key) => Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
const dup = (value) => value == null ? null : JSON.parse(JSON.stringify(value));
const errText = (error, fallback = '暂时无法完成，请重试。') => typeof error === 'string' && error ? error : typeof error?.message === 'string' ? error.message : fallback;
function el(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') element.className = v;
    else if (k === 'text') element.textContent = String(v);
    else if (k === 'onclick') element.addEventListener('click', v);
    else if (k === 'onchange') element.addEventListener('change', v);
    else element.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') element.append(document.createTextNode(String(child)));
    else element.append(child);
  }
  return element;
}
const button = (text, fn, cls = 'secondary') => el('button', { type: 'button', class: cls, onclick: fn }, text);
const link = (text, href, cls = 'secondary') => el('a', { class: cls, href, download: true }, text);
const empty = (text) => el('p',{class:'empty'},text);
const muted = (text) => el('p',{class:'muted small'},text);
const pill = (job) => {
  const label = statuses[job?.status] || [job?.status || '未知状态',''];
  return el('span',{class:'status-pill ' + label[1]},label[0]);
};
let noticeTimer;
function notice(message, isError = false) {
  const box = $('notice'); box.textContent = message; box.className = 'notice' + (isError ? ' error' : '');
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { box.textContent = ''; }, isError ? 7500 : 3500);
}
async function request(path, body, secrets = []) {
  const cfg = typeof body === 'undefined' ? undefined : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)};
  let response;
  try { response = await fetch(path,cfg); }
  catch { throw new Error('无法连接服务，请稍后再试。'); }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    let message = errText(json?.error ?? json?.message, '服务请求失败（' + response.status + '）。');
    for (const token of secrets) if (token) message = message.split(token).join('［已隐藏］');
    throw new Error(message);
  }
  return json;
}
function asyncClick(btn, run) {
  return async (event) => {
    event?.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;
    try { await run(); }
    catch (error) { notice(errText(error),true); }
    finally { btn.disabled = btn.id === 'save-model' && $('model-id')?.disabled === true; }
  };
}
function refreshNav() {
  $('nav-projects').classList.toggle('active',state.page==='projects');
  $('nav-settings').classList.toggle('active',state.page==='settings');
  $('nav-projects').setAttribute('aria-current',state.page==='projects'?'page':'false');
  $('nav-settings').setAttribute('aria-current',state.page==='settings'?'page':'false');
}
function setSettingsPill(settings) {
  const p = $('settings-pill');
  if (!settings) {p.textContent = '模型状态未知'; p.className = 'status-pill'; return;}
  p.textContent = settings.configured ? '模型已配置' : '模型未配置';
  p.className = 'status-pill ' + (settings.configured ? 'ok' : 'wait');
}
function inWorkspace(rev) { return state.page === 'projects' && rev === state.revision; }
function showPage(page) {
  previewObserver?.disconnect();
  const oldSecret = $('api-key'); if (oldSecret) oldSecret.value = '';
  clearTimeout(state.timer);
  state.page = page;
  const rev = ++state.revision;
  refreshNav();
  app.replaceChildren($((page === 'settings' ? 'settings' : 'workspace') + '-template').content.cloneNode(true));
  if (page === 'settings') return mountSettings(rev);
  const form = $('new-project-form');
  $('new-project').addEventListener('click',() => { form.hidden = !form.hidden; if (!form.hidden) $('project-name').focus(); });
  const create = form.querySelector('button[type=submit]');
  form.addEventListener('submit', asyncClick(create,async () => {
    const name = $('project-name').value.trim();
    if (!name) throw new Error('请输入项目名称。');
    const payload = await request(links.projects,{name});
    if (!inWorkspace(rev)) return;
    form.reset(); form.hidden = true;
    const p = payload?.project || payload;
    notice('项目已创建。');
    await loadWorkspace(rev,p?.id || null);
  }));
  $('content').replaceChildren(muted('正在读取项目…'));
  return loadWorkspace(rev,state.projectId);
}
async function loadWorkspace(rev, chosen) {
  try {
    const data = await request(links.projects);
    if (!inWorkspace(rev)) return;
    state.projects = array(data,'projects');
    renderProjects();
    const id = state.projects.find(p=>p.id===chosen)?.id ?? state.projects[0]?.id;
    if (id == null) {
      $('content').replaceChildren(el('p',{class:'eyebrow'},'工作台'),el('h1',{},'开始整理游戏界面'),
        el('p',{class:'lede'},'创建项目，把同一界面的图片、ZIP 和字体放在一次导入中。参考截图可以单独提供。'),
        button('新建项目',()=> { $('new-project-form').hidden=false; $('project-name').focus(); },'primary'));
      return;
    }
    await selectProject(id);
  } catch (error) { if (inWorkspace(rev)) $('content').replaceChildren(empty(errText(error)),button('重新加载',()=>loadWorkspace(rev,chosen))); }
}
function renderProjects() {
  const list = $('project-list'); if (!list) return;
  list.replaceChildren(...state.projects.map(p => el('li',{},el('button',{
    type:'button',class:'project-link'+(p.id===state.projectId?' selected':''),'aria-current':p.id===state.projectId?'true':null,
    onclick:()=> { if (p.id!==state.projectId || !state.detail) selectProject(p.id); }
  },nameOf(p)))));
  if (!state.projects.length) list.append(el('li',{class:'small muted'},'还没有项目'));
}
async function selectProject(id) {
  clearTimeout(state.timer);
  const local = ++state.jobRequest;
  state.projectId = id; state.detail = null; state.job = null; state.draft = null;
  renderProjects();
  $('content').replaceChildren(muted('正在读取项目…'));
  try {
    const detail = await request(links.project(id));
    if (state.page !== 'projects' || local!==state.jobRequest) return;
    state.detail = detail;
    renderProjectContent();
    const latestActive = array(detail,'jobs').find(busy);
    if (latestActive) selectJob(latestActive.id, false);
  } catch (error) {
    if (state.page==='projects' && local===state.jobRequest) $('content').replaceChildren(empty(errText(error)),button('重新加载',()=>selectProject(id)));
  }
}
const filesAttr = '.png,.jpg,.jpeg,.webp,.zip,.ttf,.otf';
const imageAttr = '.png,.jpg,.jpeg,.webp';
function inputLine(id,label,attrs) {
  return el('div',{},el('label',{for:id},label),el('input',{id,...attrs}));
}
function renderProjectContent() {
  const detail = state.detail;
  const project = detail?.project || state.projects.find(p=>p.id===state.projectId);
  const count = array(detail,'jobs').length;
  const form = el('form',{class:'form-grid',id:'job-form'}, 
    inputLine('job-name','任务名称',{placeholder:'例如：大厅首轮整理',maxlength:80,required:true}),
    inputLine('job-files','素材文件',{type:'file',accept:filesAttr, multiple:true}),
    el('small',{class:'muted'},'可同时选图片、ZIP 和字体。把同一界面相关素材放在这次导入中。'),
    inputLine('job-reference','参考截图（可选）',{type:'file',accept:imageAttr}),
    el('small',{class:'muted'},'参考截图用来判断整体位置，不会混入待排版切图。'),
    el('details',{},el('summary',{},'设置画布尺寸（可选）'),
      el('div',{class:'dimensions'},inputLine('job-width','宽',{type:'number',min:1,max:16384,step:1,placeholder:'自动'}),
        inputLine('job-height','高',{type:'number',min:1,max:16384,step:1,placeholder:'自动'}))),
    el('div',{class:'actions'},el('button',{type:'submit',class:'primary',id:'submit-job'},'导入并开始处理')),
    el('p',{id:'job-error',class:'inline-error',role:'alert',hidden:true})
  );
  const review = el('section',{id:'job-review',class:'panel job-review',hidden:true});
  $('content').replaceChildren(
    el('div',{class:'project-header'},el('div',{},el('p',{class:'eyebrow'},'工作台 / 项目'),el('h1',{},nameOf(project)),
      el('p',{class:'lede'},'导入同一界面的素材，再核对节点、建议和预览。')),
      link('下载整个项目 ZIP',links.project(state.projectId)+'/export.zip')),
    el('div',{class:'content-grid'},el('div',{},
      el('section',{class:'panel'},el('h2',{},'导入素材'),form),
      el('section',{class:'panel'},el('div',{class:'pane-head'},el('h2',{},'处理任务'),el('span',{id:'job-count',class:'muted small'},count+' 个')),
        el('div',{id:'jobs-list'}))),
      el('section',{class:'panel'},el('div',{class:'pane-head'},el('h2',{},'素材库'),el('span',{id:'asset-count',class:'muted small'})),
        el('p',{class:'muted small'},'查看和下载这个项目中已导入的素材。'),el('div',{id:'assets-list'}))),
    review);
  renderJobs(); renderAssets();
  const submit = $('submit-job');
  form.addEventListener('submit',asyncClick(submit,async () => {
    const pid=state.projectId;
    const revision=state.revision;
    const alert=$('job-error'); alert.hidden=true; alert.textContent='';
    try {
      const inputFiles=Array.from($('job-files').files);
      const ref=$('job-reference').files[0];
      const extension=/(\.png|\.jpe?g|\.webp|\.zip|\.ttf|\.otf)$/i;
      if (!inputFiles.length && !ref) throw new Error('请至少上传切图或参考截图。');
      if (inputFiles.some(f => !extension.test(f.name))) throw new Error('素材格式须为 PNG、JPG、WebP、ZIP、TTF 或 OTF。');
      if ([...inputFiles,...(ref?[ref]:[])].reduce((n,f)=>n+f.size,0)>32*1024*1024) throw new Error('本次上传超过 32 MiB，请分批缩小后再试。');
      if (ref && !/\.(png|jpe?g|webp)$/i.test(ref.name)) throw new Error('参考截图必须是 PNG、JPG 或 WebP。');
      const width=$('job-width').value, height=$('job-height').value;
      if ((width && !height) || (height && !width)) throw new Error('请同时填写画布宽和高，或都留空。');
      const name=$('job-name').value.trim();
      if (!name) throw new Error('请输入任务名称。');
      const body={name,files:await Promise.all(inputFiles.map(encodeFile))};
      if (ref) body.reference=await encodeFile(ref);
      if (width && height) {body.width=Number(width);body.height=Number(height);}
      if (!inWorkspace(revision) || pid!==state.projectId) return;
      const data=await request(links.project(pid)+'/jobs',body);
      if (!inWorkspace(revision) || pid!==state.projectId) return;
      form.reset(); const job=data?.job || data;
      if (job?.id == null) throw new Error('任务返回缺少编号。');
      state.detail.jobs=[job,...array(state.detail,'jobs').filter(j=>j.id!==job.id)];
      renderJobs(); notice('已提交任务，处理状态会自动更新。');
      selectJob(job.id, true);
      refreshDetail(pid);
    } catch (e) {alert.textContent=errText(e);alert.hidden=false;}
  }));
}
function encodeFile(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取文件「'+file.name+'」。'));
    reader.onload = () => { const data=String(reader.result); resolve({name:file.name,content:data.slice(data.indexOf(',')+1)}); };
    reader.readAsDataURL(file);
  });
}
async function refreshDetail(pid) {
  const revision=state.revision;
  try {
    const d=await request(links.project(pid));
    if (!inWorkspace(revision) || pid!==state.projectId) return;
    state.detail=d;
    renderJobs(); renderAssets();
  } catch { /* retain the latest usable state if background refresh is interrupted */ }
}
function renderJobs() {
  const box=$('jobs-list'); if (!box) return;
  const all=array(state.detail,'jobs');
  $('job-count').textContent=all.length+' 个';
  if (!all.length) {box.replaceChildren(empty('暂无任务。导入素材后，会在这里看到处理状态。'));return;}
  box.replaceChildren(el('ul',{class:'job-list'},all.map(j=>el('li',{},
    el('div',{class:'job-name'},el('button',{type:'button',onclick:()=>selectJob(j.id,true),'aria-current':state.job?.id===j.id?'true':null},
      nameOf(j,'任务 ' + j.id))),
    pill(state.job?.id===j.id?state.job:j)))));
}
function renderAssets() {
  const box=$('assets-list'); if (!box) return;
  const all=array(state.detail,'assets'); $('asset-count').textContent=all.length+' 个';
  if (!all.length) {box.replaceChildren(empty('暂时没有素材。'));return;}
  box.replaceChildren(el('ul',{class:'asset-list'},all.map(a=>{
    const href=links.asset(state.projectId,a.id);
    const image=imageFile(a)?el('img',{class:'thumb',src:href,alt:'',loading:'lazy'}):el('span',{class:'file-kind'},nameOf(a,'').split('.').at(-1).slice(0,8).toUpperCase()||'文件');
    return el('li',{},el('div',{class:'asset-details'},image,el('div',{},el('div',{},nameOf(a)),el('div',{class:'muted small'},elapsed(a.size??a.byteLength)))),
      link('下载',href));
  })));
}
async function selectJob(id, focus) {
  clearTimeout(state.timer);
  const req=++state.jobRequest;
  const review=$('job-review'); if (!review) return;
  state.job=null;state.draft=null;state.selection=null;state.reference=false;
  review.hidden=false; review.replaceChildren(muted('正在读取任务…'));
  if (focus) review.scrollIntoView({block:'start',behavior:'smooth'});
  await loadJob(id,req);
}
async function loadJob(id,req) {
  if (state.page!=='projects' || req!==state.jobRequest) return;
  try {
    const payload=await request(links.jobs(id));
    if (state.page!=='projects' || req!==state.jobRequest) return;
    const prev=state.job;
    state.job=payload?.job || payload;
    if (!state.job) throw new Error('任务不存在。');
    if (!prev || prev.status!==state.job.status) {
      state.draft=dup(state.job.plan);
      renderReview();
      if (prev && !busy(state.job)) refreshDetail(state.projectId);
    }
    renderJobs();
    if (busy(state.job)) state.timer=setTimeout(()=>loadJob(id,req),1250);
  } catch(error) {
    if ($('job-review') && req===state.jobRequest) {
      const review=$('job-review');
      if (state.job && busy(state.job)) {
        const msg=review.querySelector('[data-poll-info]');
        if (msg) msg.textContent='状态连接暂时中断，正在重试…';
        state.timer=setTimeout(()=>loadJob(id,req),2500);
      } else review.replaceChildren(empty(errText(error)),button('重新加载',()=>selectJob(id,false)));
    }
  }
}
function reviewHeader(job) {
  const tools=[];
  if (approved(job)) tools.push(link('下载此任务 ZIP',links.jobs(job.id)+'/export.zip','primary'));
  if (failed(job)) {
    const retry=button('重试任务',()=>{},'primary');
    retry.addEventListener('click',asyncClick(retry,async()=>{
      const old=job.id; const token=state.jobRequest; const pid=state.projectId;
      const result=await request(links.jobs(old)+'/retry',{});
      if (token!==state.jobRequest) return;
      selectJob(result?.job?.id || result?.id || old,false);
      refreshDetail(pid);
    }));
    tools.push(retry);
  }
  return el('div',{class:'project-header'},el('div',{},el('p',{class:'eyebrow'},'工作台 / 任务详情'),el('h2',{},nameOf(job,'任务 '+job.id)),pill(job)),
    el('div',{class:'actions'},tools));
}
let previewObserver;
function renderReview() {
  const box=$('job-review'); const job=state.job;
  if (!box || !job) return;
  previewObserver?.disconnect();
  box.hidden=false;
  box.replaceChildren(reviewHeader(job));
  if (busy(job)) {
    box.append(el('p',{class:'dialogue',role:'status','data-poll-info':true},'正在整理素材与预览，状态会自动刷新。'));
    return;
  }
  if (failed(job)) {
    box.append(el('p',{class:'inline-error',role:'alert'},errText(job.error,'任务没有成功，请重试或检查素材文件。')));
    return;
  }
  if (!state.draft || !Array.isArray(state.draft.nodes)) {
    box.append(empty('这个任务还没有可预览的节点。'));return;
  }
  if (approved(job)) box.append(muted('当前显示的是已批准的结构。重新处理素材请另建任务。'));
  else box.append(muted('先核对布局和素材，再决定是否批准。预览用于检查结构，不代表游戏引擎中的最终效果。'));
  const plan=state.draft;
  const previewArea=el('div',{class:'preview-outer'});
  const side=el('div',{},el('h3',{},'预制体树'));
  const nodeBox=el('div',{class:'node-info'});
  const nodes=el('ul',{class:'node-list','aria-label':'节点列表'});
  side.append(nodeBox,nodes);
  const assets=array(state.detail,'assets');
  const refId=plan.referenceAssetId || job.referenceAssetId || job.reference?.assetId || job.reference?.id ||
    assets.find(a=>(a.role==='reference' || a.kind==='reference') && (a.jobId===job.id || !a.jobId))?.id;
  const refHref=job.hasReference ? links.jobs(job.id)+'/reference' : refId!=null ? links.asset(state.projectId,refId) : null;
  const layers=new Map(), rows=new Map();
  const width=Number(plan.width),height=Number(plan.height);
  if (width>0 && height>0 && Number.isFinite(width) && Number.isFinite(height)) {
    const canvas=el('div',{class:'preview-canvas','aria-label':'画布预览'});
    if (refHref) {
      const toggle=el('input',{type:'checkbox',id:'show-reference'});
      const reference=el('img',{src:refHref,class:'preview-ref',alt:'',hidden:!state.reference});
      toggle.checked=state.reference;
      toggle.addEventListener('change',()=>{state.reference=toggle.checked;reference.hidden=!state.reference;});
      side.insertBefore(el('label',{class:'small muted',for:'show-reference'},toggle,' 叠加参考截图'),nodeBox);
      canvas.append(reference);
    }
    for (const node of plan.nodes) {
      const known=Object.prototype.hasOwnProperty.call(KIND,node.kind);
      const layer=el('button',{type:'button',class:'layer '+(known?node.kind:'unknown'),
        'aria-label': nameOf(node,'未命名节点'),onclick:()=>chooseNode(node.id)});
      const coords=[node.x,node.y,node.width,node.height].map(Number);
      if (coords.every(Number.isFinite)) {
        layer.style.left=(coords[0]/width*100)+'%';layer.style.top=(coords[1]/height*100)+'%';
        layer.style.width=(Math.max(0,coords[2])/width*100)+'%';layer.style.height=(Math.max(0,coords[3])/height*100)+'%';
      } else continue;
      const assetId=node.assetId;
      if ((node.kind==='sprite' || node.kind==='button') && assetId!=null) layer.append(el('img',{src:links.asset(state.projectId,assetId),alt:''}));
      else if (node.kind==='label') layer.append(el('span',{},node.text ?? nameOf(node)));
      else if (node.kind==='button') layer.append(el('span',{},node.text ?? nameOf(node)));
      layers.set(node.id,layer);canvas.append(layer);
    }
    const resize=()=>{const maxW=Math.max(1,previewArea.clientWidth-24);const s=Math.min(1,maxW/width,630/height);canvas.style.width=width*s+'px';canvas.style.height=height*s+'px';};
    previewArea.append(canvas);
    if (typeof ResizeObserver==='function') {previewObserver=new ResizeObserver(resize);previewObserver.observe(previewArea);}
    requestAnimationFrame(resize);
  } else previewArea.append(empty('画布宽高无效。请更正高级编辑器中的尺寸。'));
  function chooseNode(id) {
    state.selection=id;
    for (const [k,l] of layers) l.classList.toggle('selected',k===id);
    for (const [k,r] of rows) {r.classList.toggle('selected',k===id);r.setAttribute('aria-pressed',k===id?'true':'false');}
    const p = plan.nodes.find(n=>n.id===id);
    nodeBox.textContent=p ? [nameOf(p), (KIND[p.kind]||p.kind),
      '尺寸 '+p.width+' × '+p.height, '位置 '+p.x+', '+p.y, p.align ? '对齐 '+p.align : '', p.direction ? '排列 '+p.direction : '', Number.isFinite(p.gap)? '间距 '+p.gap : ''].filter(Boolean).join(' · ') : '点树上的节点，查看尺寸和位置。';
  }
  const children=new Map(); const ids=new Set(plan.nodes.map(n=>n.id)); const visited=new Set();
  for (const n of plan.nodes) {
    const parent=n.parentId!=null && ids.has(n.parentId) ? n.parentId : null;
    if (!children.has(parent)) children.set(parent,[]);
    children.get(parent).push(n);
  }
  const renderNode=(n,d)=>{
    if (visited.has(n.id)) return;
    visited.add(n.id);
    const b=el('button',{type:'button',class:'node-link',onclick:()=>chooseNode(n.id),'aria-pressed':'false'},el('span',{},nameOf(n)),
      el('span',{class:'small muted'},KIND[n.kind]||n.kind));
    b.style.paddingLeft=(10+Math.min(d,10)*15)+'px';
    nodes.append(el('li',{},b));rows.set(n.id,b);
    for (const ch of children.get(n.id)||[]) renderNode(ch,d+1);
  };
  for (const n of children.get(null)||[]) renderNode(n,0);
  for (const n of plan.nodes) renderNode(n,0);
  chooseNode(state.selection);
  box.append(el('div',{class:'preview-grid'},previewArea,side));
  const issueList=el('ul',{class:'issues'});
  const issues=Array.isArray(plan.issues)?plan.issues:[];
  const reviewedMark='［已复核］';
  const acceptedMark='［已接受替代方式］';
  const isMarked=(s)=>typeof s==='string' && (s.startsWith(reviewedMark)||s.startsWith(acceptedMark));
  const advanced=el('textarea',{id:'plan-json','aria-label':'结构 JSON','spellcheck':'false',readonly:approved(job)});
  advanced.value=JSON.stringify(plan,null,2);
  let jsonDirty=false;
  advanced.addEventListener('input',()=>{jsonDirty=true;});
  const levelLabel={info:'提示',warning:'需核对',error:'阻塞'};
  issues.forEach((item)=>{
    const badge=el('span',{class:'issue-severity'},levelLabel[item.severity]||'待核对');
    const li=el('li',{},el('div',{},badge,String(item.message || '待查看的问题')));
    if (typeof item.resolution === 'string' && item.resolution.trim()) {
      const blocked=item.severity==='error';
      const suggest=el('p',{class:'muted small'},'建议：'+item.resolution);
      li.append(suggest);
      if (!approved(job) && !isMarked(item.resolution)) {
        const choose=button(blocked?'确认采用替代方式，解除阻塞':'标记建议已复核',()=>{
          if (jsonDirty) {notice('请先更新 JSON 预览，再操作建议。',true);return;}
          const mark=blocked ? acceptedMark : reviewedMark;
          item.resolution=mark+Array.from(item.resolution).slice(0,600-mark.length).join('');
          if (blocked) item.severity='warning';
          renderReview();
        });
        li.append(el('div',{class:'issue-control'},choose,muted(blocked?'只记录你接受了替代方式，不会改变节点。':'只记录复核，不会改变节点。')));
      } else if (isMarked(item.resolution)) li.append(muted('已复核；节点未自动修改。'));
    } else if (item.severity==='error') li.append(muted('请在高级编辑中修订结构和这条问题，再更新预览。'));
    issueList.append(li);
  });
  box.append(el('section',{},el('h3',{},'待核对问题'),issues.length?issueList:muted('未列出待核对问题。')));
  const error=el('p',{class:'inline-error',role:'alert',hidden:true});
  const details=el('details',{},el('summary',{},approved(job)?'查看结构 JSON':'高级：编辑结构 JSON'),
    muted(approved(job)?'这是已批准的节点数据。':'采纳建议只记录复核结果。要改位置、尺寸或层级，请在 JSON 中修改，再更新预览。'),advanced);
  function candidateFromEditor() {
    let value;try{value=JSON.parse(advanced.value);}catch{throw new Error('结构 JSON 格式有误，请检查标点和括号。');}
    if (!(value && Number.isFinite(value.width) && value.width>0 && Number.isFinite(value.height) && value.height>0 && Array.isArray(value.nodes) && Array.isArray(value.issues)))
      throw new Error('需要正数宽高，以及 nodes 和 issues 数组。');
    if (value.nodes.some(n=>!n || typeof n.id!=='string' || !n.id.trim() || ![n.x,n.y,n.width,n.height].every(Number.isFinite) || n.width<=0 || n.height<=0))
      throw new Error('每个节点都需要文本 ID、有效位置和正数尺寸。');
    if (value.issues.some(x=>!x || typeof x!=='object' || typeof x.message!=='string' || !x.message.trim())) throw new Error('每条问题需要非空的 message。');
    if (new Set(value.nodes.map(n=>String(n.id))).size!==value.nodes.length) throw new Error('节点 ID 不能重复。');
    return value;
  }
  const commitActions=el('div',{class:'actions'});
  if (!approved(job)) {
    const renderButton=button('更新预览',()=>{try{state.draft=candidateFromEditor();renderReview();$('job-review').querySelector('details').open=true;}catch(e){error.textContent=errText(e);error.hidden=false;}});
    details.append(el('div',{class:'actions'},renderButton));
    const approve=button('批准并允许导出',()=>{},'primary');
    approve.addEventListener('click',asyncClick(approve,async()=>{
      error.hidden=true;
      try {
        if (jsonDirty) throw new Error('你编辑了 JSON。请先点「更新预览」，核对后再批准。');
        const value=candidateFromEditor();const token=state.jobRequest;const pid=state.projectId;
        if (value.issues.some(x=>x.severity==='error')) throw new Error('还有阻塞问题。请先修订结构，或明确接受对应替代方式。');
        await request(links.jobs(job.id)+'/approve',{plan:value});
        if (token!==state.jobRequest) return;
        notice('任务已批准，可以下载。');await loadJob(job.id,token);refreshDetail(pid);
      } catch (e) {error.textContent=errText(e);error.hidden=false;}
    }));
    commitActions.append(approve);
  }
  box.append(el('div',{class:'review-bottom'},details,commitActions,error));
}
function mountSettings(rev) {
  const by = (id) => $(id);
  const form=by('settings-form'), fetchModel=by('load-models'), save=by('save-model'), model=by('model-id');
  const address=by('base-url'), secret=by('api-key'), status=by('saved-setting'), error=by('settings-error'), options=by('model-options');
  const still=()=>state.page==='settings'&&rev===state.revision;
  let settings=null;let inputEpoch=0;
  function showSaved(value) {
    settings=value;
    if (!still()) return;
    if (value?.baseUrl && !address.value) address.value=value.baseUrl;
    if (value?.model && !model.value) model.value=value.model;
    if (!value?.configured) status.textContent='还没有已验证的默认模型。';
    else {
      const date=value.verifiedAt ? new Date(value.verifiedAt) : null;
      const when=date && Number.isFinite(date.getTime()) ? ' · 验证于 '+date.toLocaleString('zh-CN') : '';
      status.textContent='当前默认：'+(value.model||'已配置')+when;
    }
    setSettingsPill(value);
  }
  function clearError() {error.textContent='';error.hidden=true;}
  function report(e) {error.textContent=errText(e);error.hidden=false;}
  function clearModels() {options.replaceChildren();}
  function args() {
    const baseUrl=address.value.trim(),apiKey=secret.value.trim();
    if (!baseUrl || !address.checkValidity()) throw new Error('请输入有效的服务地址。');
    if (!apiKey && baseUrl.replace(/\/+$/, '')!==settings?.baseUrl) throw new Error('新连接须填写 API Key。');
    const parts=new URL(baseUrl);
    if (parts.protocol!=='https:' || parts.username || parts.password || parts.search || parts.hash) throw new Error('服务地址应为 HTTPS API 根地址，不含登录信息、参数或片段。');
    return {baseUrl,apiKey};
  }
  [address,secret].forEach(i=>i.addEventListener('input',()=>{++inputEpoch;clearModels();}));
  request('/api/settings').then(showSaved).catch(e=>{if(still()){status.textContent='暂时无法读取已保存设置。';report(e);}});
  fetchModel.addEventListener('click',asyncClick(fetchModel,async()=>{
    clearError();clearModels();
    try {
      const cfg=args();const epoch=++inputEpoch;
      const payload=await request('/api/settings/models',cfg,[cfg.apiKey]);
      if (!still() || epoch!==inputEpoch) return;
      const ids=array(payload,'models').map(x=>typeof x==='string'?x:x?.id??x?.name)
        .filter(x=>typeof x==='string' && x.trim() && (!cfg.apiKey || !x.includes(cfg.apiKey)));
      const unique=[...new Set(ids)];
      if (!unique.length) throw new Error('服务没有返回模型，可手动输入模型 ID 再验证。');
      options.replaceChildren(...unique.map(x=>el('option',{value:x})));
      if (unique.includes(settings?.model)) model.value=settings.model;
      model.disabled=false;save.disabled=false;notice('获取到 '+unique.length+' 个模型。');
    } catch (e) {if(still()) report(e);}
  }));
  form.addEventListener('submit',asyncClick(save,async()=>{
    clearError();
    try {
      const cfg=args();const selection=model.value.trim();
      if (!selection) throw new Error('请选择或填写模型 ID。');
      const epoch=++inputEpoch;
      address.disabled=true;secret.disabled=true;model.disabled=true;fetchModel.disabled=true;
      try {
        await request('/api/settings/default',{...cfg,model:selection},[cfg.apiKey]);
        if (!still() || epoch!==inputEpoch) return;
        secret.value='';clearModels();
        const s=await request('/api/settings');
        if (still()) {showSaved(s);notice('已验证并保存默认模型。');}
      } finally { if(still()) {address.disabled=false;secret.disabled=false;fetchModel.disabled=false;model.disabled=false;} }
    } catch (e) {if(still()) report(e);}
  }));
  window.addEventListener('pagehide',()=>{secret.value='';},{once:true});
}
$('brand').addEventListener('click',()=>showPage('projects'));
$('nav-projects').addEventListener('click',()=>{if(state.page!=='projects')showPage('projects');});
$('nav-settings').addEventListener('click',()=>{if(state.page!=='settings')showPage('settings');});
request('/api/settings').then(setSettingsPill).catch(()=>setSettingsPill(null));
showPage('projects');
})();
