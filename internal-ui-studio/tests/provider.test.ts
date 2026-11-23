import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import type { request } from "node:https";
import { ProviderError, createProvider } from "../provider.ts";

const BASE="https://vision.example.com/api/v1", KEY="secret-in-test-only", MODEL="fixture/vision";
process.env.F2_ALLOWED_AI_BASE_URLS=BASE;
type Wire={opts: Record<string,unknown>; body?: Buffer};
type TestResponse={status:number; headers?:Record<string,string>; body?:Buffer|string};
function fixture(serve: (wire:Wire) => TestResponse, overrides:Parameters<typeof createProvider>[0]={}) {
  const calls:Wire[]=[];
  let destroyed=0;
  const reqStub=((opts:Record<string,unknown>, callback:(res:unknown)=>void) => {
    const req=new EventEmitter() as EventEmitter & {end:(body?:Buffer)=>void};
    req.end=(body?:Buffer)=>{
      calls.push({opts,body});
      const r=serve({opts,body});
      const res=Readable.from(r.body!==undefined?[Buffer.from(r.body)]:[]);
      const destroy=res.destroy.bind(res);
      Object.assign(res,{statusCode:r.status,headers:r.headers??{},destroy:()=>{destroyed++;return destroy();}});
      queueMicrotask(()=>callback(res));
    };
    return req;
  }) as unknown as typeof request;
  const resolver=async (..._args:string[])=>[{address:"93.184.216.34",family:4}];
  return {
    provider:createProvider({request:reqStub,resolve:resolver,...overrides}),calls,
    get destroyed(){return destroyed},
  };
}
function ok(body:unknown) { return {status:200,body:JSON.stringify(body)}; }
function chat(result:unknown,model=MODEL) { return {model,choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}; }
const code=(expected:string)=>(error:unknown) => {
  assert.ok(error instanceof ProviderError);
  assert.equal(error.code,expected);
  assert.ok(!error.message.includes(KEY));
  assert.equal(error.cause,undefined);
  return true;
};

function independentPixels(url:string) {
  assert.ok(url.startsWith("data:image/png;base64,"));
  const b=Buffer.from(url.split(",",2)[1],"base64");
  assert.equal(b.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
  const width=b.readUInt32BE(16), height=b.readUInt32BE(20), stride=width*3+1;
  assert.equal(b[24],8); assert.equal(b[25],2);
  const idat=[];
  for(let p=8;p<b.length;) {
    const sz=b.readUInt32BE(p);
    if(b.toString("ascii",p+4,p+8)==="IDAT") idat.push(b.subarray(p+8,p+8+sz));
    p+=sz+12;
  }
  const pixels=inflateSync(Buffer.concat(idat));
  assert.equal(pixels.length,stride*height);
  const xy=(x:number,y:number)=>{
    assert.equal(pixels[y*stride],0);
    const k=y*stride+1+x*3;return pixels.subarray(k,k+3).toString("hex");
  };
  const colors:Record<string,string>={"d61e32":"red","225bdc":"blue","088744":"green","efb010":"yellow"};
  return Object.fromEntries([["top_left",36,36],["top_right",108,36],["bottom_left",36,108],["bottom_right",108,108]].map(([key,cx,cy])=>{
    const x=Number(cx),y=Number(cy),fill=xy(x,y);
    const test=(a:number,b:number)=>xy(x+a,y+b)===fill;
    const shape=test(15,15)&&test(15,-15)?"square":test(12,13)&&!test(12,-13)?"triangle":test(10,10)?"circle":"diamond";
    return [key,{shape,color:colors[fill]}];
  }));
}

test("exact HTTPS allowlist with DNS pinned under verified original TLS identity",async()=>{
  const m=fixture(()=>ok({data:[{id:"b"},{id:"a"},{id:"a"}]}));
  assert.deepEqual(await m.provider.listModels("https://VISION.example.com:443/api/v1/",KEY),["a","b"]);
  const {opts}=m.calls[0];
  assert.equal(opts.hostname,"93.184.216.34");
  assert.equal(opts.servername,"vision.example.com");
  assert.equal(opts.rejectUnauthorized,true);
  assert.equal(opts.agent,false);
  assert.equal(opts.method,"GET");
  assert.equal(opts.path,"/api/v1/models");
  assert.equal((opts.headers as Record<string,string>).Host,"vision.example.com");
  for(const u of [BASE+"?",BASE+"#x",BASE+"/other","http://vision.example.com/api/v1",
    "https://vision.example.com/api/a/../v1","https://vision.example.com/api/%2e/v1",
    "https://vision.example.com:8443/api/v1","https://vision.example.com:0/api/v1",
    "https://secret-in-test-only@vision.example.com/api/v1","https://127.1/api/v1"]) {
    await assert.rejects(()=>m.provider.listModels(u,KEY),code("endpoint_not_allowed"));
  }
  await assert.rejects(()=>m.provider.listModels(BASE,KEY+"\r\n"),code("invalid_key"));
  assert.equal(m.calls.length,1);
});

test("nonpublic and mixed DNS answers never reach HTTPS",async()=>{
  for(const addr of ["10.4.5.6","100.64.0.2","127.0.0.1","169.254.169.254","224.0.0.1","::1","::ffff:93.184.216.34","fec0::1","2002::1","2001:db8::1"]) {
    const m=fixture(()=>ok({}),{resolve:async()=>[{address:"93.184.216.34",family:4},{address:addr,family:addr.includes(":")?6:4}]});
    await assert.rejects(()=>m.provider.listModels(BASE,KEY),code("endpoint_not_allowed"));
    assert.equal(m.calls.length,0);
  }
});

test("redirect, upstream credential echo, malformed or oversized JSON are not accepted",async()=>{
  const cases: [TestResponse,string][] = [
    [{status:302,headers:{location:"https://example.net"},body:KEY},"upstream_rejected"],
    [{status:401,body:KEY},"authentication_failed"],
    [{status:200,headers:{"content-length":"1048577"},body:KEY},"invalid_response"],
    [{status:200,headers:{"content-encoding":"gzip"},body:KEY},"invalid_response"],
    [{status:200,body:'{"data":[],"d\\u0061ta":[]}' },"invalid_response"],
    [{status:200,body:'{"data":[],"value":1e999}' },"invalid_response"],
    [{status:200,body:Buffer.alloc(1_048_577)},"invalid_response"],
    [{status:200,body:Buffer.from([128])},"invalid_response"],
  ];
  for(const [res,expected] of cases) {
    const m=fixture(()=>res);
    await assert.rejects(()=>m.provider.listModels(BASE,KEY),code(expected));
    assert.equal(m.calls.length,1);
  }
});

test("absolute deadline includes DNS; a late answer never starts transport",async()=>{
  let resolve!: (value:{address:string;family:number}[])=>void;
  const late=new Promise<{address:string;family:number}[]>(x=>{resolve=x;});
  const m=fixture(()=>ok({}),{deadlineMs:5,resolve:()=>late});
  await assert.rejects(()=>m.provider.listModels(BASE,KEY),code("timed_out"));
  resolve([{address:"93.184.216.34",family:4}]);
  await new Promise(x=>setImmediate(x));
  assert.equal(m.calls.length,0);
});

test("two randomized images; independent image decoder can solve the probe",async()=>{
  const pngs=new Set<string>();
  const m=fixture(({body})=>{
    assert.ok(body);
    const p=JSON.parse(body.toString());
    assert.equal(p.model,MODEL);
    assert.equal(p.response_format.type,"json_object");
    const content=p.messages[0].content;
    assert.equal(content[1].text,"image_a");
    assert.equal(content[3].text,"image_b");
    const a=content[2].image_url.url,b=content[4].image_url.url;
    pngs.add(a);pngs.add(b);
    return ok(chat({image_a:independentPixels(a),image_b:independentPixels(b)}));
  });
  for(let i=0;i<3;i++) assert.deepEqual(await m.provider.probeVision(BASE,KEY,MODEL),
    {ok:true,model:MODEL,reported_model:MODEL,vision:true,probe:"hidden-shapes-v1"});
  assert.ok(pngs.size>2);
  assert.equal(m.calls[0].opts.path,"/api/v1/chat/completions");
});

test("vision claims, text-only replies, changed model and incomplete responses fail closed",async()=>{
  for(const [body,expected] of [
    [chat({vision:true}),"vision_not_verified"],
    [chat({vision:true},"other"),"model_mismatch"],
    [{model:MODEL,choices:[{message:{content:"I can see"}}]},"invalid_response"],
    [{model:MODEL,choices:[{finish_reason:"length",message:{content:"{}"}}]},"invalid_response"],
    [{model:MODEL,choices:[{finish_reason:"stop",message:{content:'{"vision":false,"vision":true}'}}]},"invalid_response"],
  ] as const) {
    const m=fixture(()=>ok(body));
    await assert.rejects(()=>m.provider.probeVision(BASE,KEY,MODEL),code(expected));
  }
});

test("analyze marshals Uint8Array image and context under requested model and limits",async()=>{
  const data=Buffer.from([137,80,78,71,13,10,26,10,0,1]);
  const assets=[{id:"图层-8",mime:"image/png",data}];
  const ctx={assets:[{id:"图层-8",width:144,height:144}],outputShape:{nodes:[]}};
  const m=fixture(({body})=>{
    assert.ok(body);
    const p=JSON.parse(body.toString()),content=p.messages[1].content;
    assert.ok(content[0].text.includes("图层-8"));
    assert.ok(content[1].text.includes("图层-8"));
    assert.deepEqual(Buffer.from(content[2].image_url.url.split(",",2)[1],"base64"),data);
    return ok(chat({nodes:[]},MODEL+"-2026-02-01"));
  });
  assert.deepEqual(await m.provider.analyze(BASE,KEY,MODEL,assets,ctx),{nodes:[]});
  await assert.rejects(()=>m.provider.analyze(BASE,KEY,MODEL,[...assets,...assets],ctx),code("invalid_input"));
  await assert.rejects(()=>m.provider.analyze(BASE,KEY,MODEL,[{...assets[0],mime:"image/svg+xml"}],ctx),code("invalid_input"));
  await assert.rejects(()=>m.provider.analyze(BASE,KEY,MODEL,assets,{n:Infinity}),code("invalid_input"));
  assert.equal(m.calls.length,1);
});
