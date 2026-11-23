import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import sharp from 'sharp';
import { createStudio } from '../app.ts';
import { ProviderError } from '../provider.ts';

const password='internal-ui-studio-test-pass';
const env={F2_SITE_ORIGIN:'https://internal.example',F2_WORKSPACE_PASSWORD:password};
const raw=await sharp({create:{width:12,height:12,channels:4,background:'#49a99eff'}}).png().toBuffer();
type Mock = NonNullable<Parameters<typeof createStudio>[2]>;
const listing: Mock['list_models']=async()=>['vision','text'];
const probe: Mock['probe_vision']=async(_url,_key,model)=> {
  if(typeof model!=='string' || model==='text') throw new ProviderError('vision_not_verified');
  return {ok:true,vision:true,model,reported_model:model,probe:'hidden-shapes-v1'};
};
type Result = Record<string, any>; // intentionally exercise JSON HTTP wire format
async function start(t: TestContext, provider: Mock, e: NodeJS.ProcessEnv=env) {
  const root=mkdtempSync(join(tmpdir(),'studio-http-'));
  const {server}=createStudio(root,e,provider);
  server.listen(0,'127.0.0.1');
  t.after(async()=>{server.close();server.closeAllConnections(); if(server.listening) await once(server,'close');rmSync(root,{recursive:true,force:true});});
  await once(server,'listening');
  const a=server.address();assert(a && typeof a==='object');
  const base='http://127.0.0.1:'+a.port;
  const auth='Basic '+Buffer.from('studio:'+password).toString('base64');
  return async(path:string, value?: unknown, extra: Record<string,string>={}, withAuth=true) => {
    const response=await fetch(base+path,{method:value===undefined?'GET':'POST',
      headers:{...(withAuth?{Authorization:auth}:{}),...(value===undefined?{}:{'Content-Type':'application/json'}),...extra},
      body:value===undefined?undefined:JSON.stringify(value)});
    const mime=response.headers.get('content-type') ?? '';
    return {status:response.status, result:mime.startsWith('application/json') ? await response.json() as Result : null, data:mime.startsWith('application/json')?null:Buffer.from(await response.arrayBuffer())};
  };
}
const cfg={baseUrl:'https://example.invalid/v1',apiKey:'test-only-key'};
test('HTTP: requires login, checks origin, verifies vision before storing a selected model',async t=>{
  const request=await start(t,{list_models:listing,probe_vision:probe,analyze:async()=>({})});
  assert.equal((await request('/api/settings',undefined,{},false)).status,401);
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/api/projects',{name:'阻止'},{Origin:'https://outside.example'})).status,403);
  assert.deepEqual((await request('/api/settings/models',cfg)).result,{models:['vision','text']});
  assert.equal((await request('/api/settings')).result?.configured,false);
  const saved=await request('/api/settings/default',{...cfg,model:'vision'});
  assert.equal(saved.status,200,JSON.stringify(saved.result));
  assert.equal(saved.result?.model,'vision');
  assert(!JSON.stringify(saved.result).includes(cfg.apiKey));
  assert.equal((await request('/api/settings/default',{...cfg,model:'text'})).status,429);
  await pause(2050);
  assert.equal((await request('/api/settings/default',{...cfg,model:'text'})).status,400);
  assert.equal((await request('/api/settings')).result?.model,'vision');
});
test('HTTP: upload, dedup, failed analysis/retry, review, approve and both exports',async t=>{
  let calls=0;
  const request=await start(t,{list_models:listing,probe_vision:probe,analyze:async(_url,_key,_model,images,rawContext)=>{
    assert(Array.isArray(images)); assert.equal(images[0].id,'reference');
    if(++calls===1)throw new ProviderError('vision_not_verified');
    const ctx=rawContext as {width:number;height:number;assets:{id:string;kind:string}[]};
    return {width:ctx.width,height:ctx.height,issues:[],nodes:[
      {id:'root',parentId:null,name:'界面',kind:'container',x:0,y:0,width:ctx.width,height:ctx.height},
      {id:'icon',parentId:'root',name:'图标',kind:'sprite',x:1,y:1,width:8,height:8,assetId:ctx.assets.find(a=>a.kind==='image')?.id}
    ]};
  }});
  const created=await request('/api/projects',{name:'示例'});
  assert.equal(created.status,201,JSON.stringify(created.result));
  const p='/api/projects/'+created.result?.id;
  assert.equal((await request(p+'/jobs',{name:'启动'})).status,409);
  assert.equal((await request('/api/settings/default',{...cfg,model:'vision'})).status,200);
  const upload={name:'启动',files:[{name:'icon.png',content:raw.toString('base64')}],reference:{name:'reference.png',content:raw.toString('base64')}};
  const createdJob=await request(p+'/jobs',upload);
  assert.equal(createdJob.status,202,JSON.stringify(createdJob.result));
  const j='/api/jobs/'+createdJob.result?.id;
  async function wait(status:string){
    for(let i=0;i<80;i++){const v=(await request(j)).result;if(v?.status===status)return v;await pause(15);}
    assert.fail('未到达任务状态 '+status+': '+JSON.stringify((await request(j)).result));
  }
  await wait('failed');
  assert.equal((await request(j+'/retry',{})).status,202);
  const review=await wait('review');
  assert.equal(review.attempt,2);
  assert.equal(review.plan.width,12);
  const reused=await request(p+'/jobs',{...upload,files:[{...upload.files[0],name:'also.png'}]});
  assert.equal(reused.result?.id,createdJob.result?.id);
  assert.deepEqual(new Set((await request(p)).result?.assets[0].aliases),new Set(['icon.png','also.png']));
  const approved=await request(j+'/approve',{plan:review.plan});
  assert.equal(approved.status,200,JSON.stringify(approved.result));
  assert.equal((await request(j+'/approve',{plan:review.plan})).status,400);
  assert.equal((await request(j+'/revisions')).result?.revisions.length,2);
  for (const url of [p,j]) {
    const zip=await request(url+'/export.zip');
    assert.equal(zip.status,200,JSON.stringify(zip.result));
    assert.equal(zip.data?.subarray(0,4).toString('hex'),'504b0304');
  }
});
test('developer mode refuses forwarded headers and non-loopback binding', async t=>{
  assert.throws(()=>createStudio('/not-used',{F2_DEV_LOCAL:'1',F2_HOST:'0.0.0.0'}),/loopback-only/);
  const request=await start(t,{list_models:listing,probe_vision:probe,analyze:async()=>({})},{F2_DEV_LOCAL:'1'});
  assert.equal((await request('/api/settings')).status,200);
  assert.equal((await request('/api/settings',undefined,{'X-Forwarded-For':'127.0.0.1'})).status,401);
});
