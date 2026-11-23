import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";
import { build_zip } from "../export_cocos.ts";
import type { ExportAsset, ExportJob, ExportNode } from "../export_cocos.ts";

function archive(buf:Buffer) {
  const files=new Map<string,Buffer>();
  let pos=0;
  while(buf.readUInt32LE(pos)===0x04034b50) {
    const packed=buf.readUInt32LE(pos+18), size=buf.readUInt32LE(pos+22);
    const len=buf.readUInt16LE(pos+26), extra=buf.readUInt16LE(pos+28);
    const name=buf.toString("utf8",pos+30,pos+30+len);
    const start=pos+30+len+extra, raw=inflateRawSync(buf.subarray(start,start+packed));
    assert.equal(raw.length,size); assert.equal(crc32(raw),buf.readUInt32LE(pos+14));
    assert(!files.has(name)); files.set(name,raw); pos=start+packed;
  }
  let dirEntries=0;
  const dirOffset=pos;
  while(buf.readUInt32LE(pos)===0x02014b50) {
    const len=buf.readUInt16LE(pos+28), filename=buf.toString("utf8",pos+46,pos+46+len);
    assert(files.has(filename));
    assert.equal(buf.readUInt32LE(buf.readUInt32LE(pos+42)),0x04034b50);
    dirEntries++;pos+=46+len+buf.readUInt16LE(pos+30)+buf.readUInt16LE(pos+32);
  }
  assert.equal(buf.readUInt32LE(pos),0x06054b50);
  assert.equal(buf.readUInt16LE(pos+10),dirEntries);
  assert.equal(buf.readUInt32LE(pos+16),dirOffset);
  assert.equal(pos+22,buf.length);
  return files;
}

function fixture() {
  const project={id:"p-01",name:"项目",cocosVersion:"3.8.8"};
  const pic={id:"pic",name:"切图",mime:"image/png",kind:"image",width:1,height:1,bundle:"gameResource",
    path:"textures/图标-123abc.png",uuid:"d555c38c-494c-4346-8763-f392f4bc9ae6"};
  const font={id:"font",name:"字体",mime:"font/ttf",kind:"font",bundle:"common",path:"fonts/text-aaabcd.ttf",
    uuid:"d0fd1d9f-09cd-4e50-a116-24e7ab30397e"};
  const spare={...pic,id:"unused",name:"未引用",uuid:"d555c38c-494c-4346-8763-f392f4bc9ae7",path:null};
  const unsupported={...font,id:"otf",mime:"font/otf"};
  const assets:Record<string,ExportAsset>={pic,font,unused:spare,otf:unsupported};
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==","base64");
  const ttf=Buffer.from("000100000001000000000000","hex");
  const bytes:Record<string,Buffer>={pic:png,font:ttf,unused:png};
  const node=(id:string,kind:string,x:number,y:number,width:number,height:number,parentId:string|null,
    fields:Partial<ExportNode>={}):ExportNode=>({id,name:id,kind,x,y,width,height,parentId,...fields});
  const plan={width:320,height:640,nodes:[
    node("root","container",0,0,320,640,null),
    node("content","layout",20,100,200,300,"root",{direction:"vertical",gap:8}),
    node("cta","button",30,120,80,60,"content",{assetId:"pic"}),
    node("message","label",35,181,.5,.25,"content",{text:"中文",fontAssetId:"font",align:"bottom-right"}),
  ],issues:[{message:"复核图片",severity:"info"}]};
  const jobs:ExportJob[]=[{id:"screen1",name:"登录",plan},{id:"screen2",name:"大厅",plan}];
  return {project,jobs,assets,bytes};
}
const getJson=(files:Map<string,Buffer>,path:string)=>JSON.parse(files.get(path)!.toString("utf8"));

test("complete Cocos dependency graph, deterministic repeated/shared ZIP, stable Python UUID",()=>{
  const f=fixture();
  const access:string[]=[];
  const get=(id:string)=>{access.push(id);return f.bytes[id]!;};
  const zip=build_zip(f.project,f.jobs,f.assets,get);
  assert.deepEqual(access,["pic","font"]);
  assert.deepEqual(zip,build_zip(f.project,[...f.jobs].reverse(),f.assets,get));
  const files=archive(zip), single=archive(build_zip(f.project,[f.jobs[0]!],f.assets,get));
  for (const [path,body] of single) if (path!=="manifest.json") assert.deepEqual(files.get(path),body);
  const manifest=getJson(files,"manifest.json");
  assert.equal(manifest.screens.length,2); assert.equal(manifest.assets.length,2);
  assert.equal(manifest.screens[0].uuid,"fe8cd094-77b4-5ac3-abb3-671719c8a497");
  assert.equal(manifest.assetRoot,"assets/figma-ui-f393242f5127");
  assert.deepEqual(manifest.screens[0].reviewIssues,f.jobs[0]?.plan?.issues);
  for (const bundle of manifest.bundles) {
    assert.deepEqual(getJson(files,bundle.path+".meta").userData,
      {isBundle:true,bundleName:bundle.cocosBundle,isRemoteBundle:false});
  }
  const screen=getJson(files,manifest.screens[0].path);
  assert.equal(screen[0].data.__id__,1);
  const button=screen.find((r:any)=>r.__type__==="cc.Button");
  assert.deepEqual(button.clickEvents,[]);
  assert.deepEqual(screen[button.node.__id__]._lpos,{__type__:"cc.Vec3",x:-50,y:100,z:0});
  const label=screen.find((r:any)=>r.__type__==="cc.Label");
  assert.deepEqual([label._horizontalAlign,label._verticalAlign,label._string],[2,2,"中文"]);
  assert.deepEqual(label._font,{__uuid__:f.assets.font?.uuid,__expectedType__:"cc.TTFFont"});
  const transform=screen[screen[label.node.__id__]._components[0].__id__];
  assert.deepEqual(transform._contentSize,{__type__:"cc.Size",width:.5,height:.25});
  const sprite=screen.find((r:any)=>r.__type__==="cc.Sprite");
  assert.equal(sprite._sizeMode,0);
  const pic=manifest.assets.find((a:any)=>a.id==="pic");
  const pngMeta=getJson(files,pic.path+".meta");
  assert.equal(pngMeta.subMetas.f9941.uuid,sprite._spriteFrame.__uuid__);
  assert.equal(pngMeta.subMetas.f9941.userData.imageUuidOrDatabaseUri,pngMeta.subMetas["6c48a"].uuid);
});

test("project mode includes unused supported assets only and lists excluded OTF",()=>{
  const f=fixture();
  const read:string[]=[];
  const files=archive(build_zip(f.project,f.jobs,new Map(Object.entries(f.assets)),aid=>{read.push(aid);return f.bytes[aid]!;},true));
  const m=getJson(files,"manifest.json");
  assert.deepEqual(read,["pic","font","unused"]);
  assert.equal(m.assets.length,3);
  assert.equal(m.excludedAssets[0].id,"otf");
  assert(m.assets.find((a:any)=>a.id==="unused").path.endsWith("/asset-"+f.assets.unused?.uuid+".png"));
});

test("invalid assets, path traversal, duplicate UUID and disconnected roots fail atomically",()=>{
  const f=fixture();
  const src=(x:string)=>f.bytes[x]!;
  delete f.assets.pic;
  assert.throws(()=>build_zip(f.project,f.jobs,f.assets,src),/缺失资源/);
  f.assets.pic={...fixture().assets.pic!,path:"textures/../../bad.png"};
  assert.throws(()=>build_zip(f.project,f.jobs,f.assets,src),/路径无效/);
  f.assets.pic={...fixture().assets.pic!,uuid:f.assets.font?.uuid};
  assert.throws(()=>build_zip(f.project,f.jobs,f.assets,src),/UUID 冲突/);
  f.assets.pic=fixture().assets.pic!;
  f.assets.font!.mime="font/otf";
  assert.throws(()=>build_zip(f.project,f.jobs,f.assets,src),/TTF/);
  f.assets.font=fixture().assets.font!;
  f.jobs[0]!.plan!.nodes[0]!.parentId="content";
  assert.throws(()=>build_zip(f.project,f.jobs,f.assets,src),/循环/);
});
