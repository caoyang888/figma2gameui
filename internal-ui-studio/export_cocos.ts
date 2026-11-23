/** Cocos Creator 3.8.8 exporter, preserving studio Python exporter identities. */
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

export interface ExportNode {
  id: string;
  parentId?: string | null;
  kind: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  assetId?: string;
  fontAssetId?: string;
  text?: string;
  align?: string;
  direction?: string;
  gap?: number;
  fontSize?: number;
}
export interface ExportProject { id: string; name: string; cocosVersion: string }
export interface ExportJob {
  id: string;
  name: string;
  plan?: { width: number; height: number; nodes: readonly ExportNode[]; issues?: readonly unknown[] } | null;
}
export interface ExportAsset {
  id: string;
  name: string;
  kind: string;
  mime: string;
  width?: number;
  height?: number;
  uuid?: string | null;
  bundle?: string | null;
  path?: string | null;
}
type Obj = Record<string, unknown>;
type Rect = Pick<ExportNode, "x" | "y" | "width" | "height">;
type Ref = { __id__: number };
const VERSION = "3.8.8", TEXTURE = "6c48a", SPRITE = "f9941";
const NS = Buffer.from("eba33b7724884b3888838af7900616f3", "hex");
const MAX_BYTES = 256 * 1024 * 1024;
const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PNG_END = Buffer.from("0000000049454e44ae426082", "hex");
const TTF_HEAD = Buffer.from("00010000", "hex");
const lexical = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function formatUuid(h: string): string {
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20,32)].join("-");
}
function ident(...parts: string[]): string {
  const hash = createHash("sha1").update(NS).update(JSON.stringify(parts)).digest().subarray(0,16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return formatUuid(hash.toString("hex"));
}
function checkedUuid(input: unknown): string {
  if (typeof input !== "string") throw new Error("UUID 必须是文本");
  const h = input.replace(/^urn:uuid:/, "").replace(/^\{|\}$/g, "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) throw new Error("UUID 格式错误");
  return formatUuid(h);
}
function key(value: unknown, description: string): string {
  if (typeof value !== "string" || !value || Array.from(value).length > 256 || /[\x00-\x1f]/.test(value)) {
    throw new Error("无效" + description);
  }
  return value;
}
function num(value: unknown, desc: string, min=-100000, positive=false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > 100000 || (positive && value <= 0)) {
    throw new Error("无效" + desc);
  }
  return value;
}
const display = (value: unknown, fallback: string) =>
  Array.from(String(value || "").replace(/[\x00-\x1f]/g, "").trim()).slice(0,120).join("") || fallback;
const jsonify = (o: unknown) => Buffer.from(JSON.stringify(o,null,2) + "\n");
const ref = (node: number): Ref => ({ __id__: node });
const assetRef = (uuid: string, expected: string) => ({ __uuid__:uuid, __expectedType__:expected });
const size = (width: number, height: number) => ({ __type__:"cc.Size",width,height });
const vec3 = (x=0,y=0,z=0) => ({ __type__:"cc.Vec3",x,y,z });
const color = (r=255,g=255,b=255,a=255) => ({ __type__:"cc.Color",r,g,b,a });
const meta = (ver: string, importer: string, uuid: string, files: string[], userData:Obj={}, subMetas:Obj={}) =>
  ({ ver,importer,imported:true,uuid,files,subMetas,userData });

function imageMeta(uid: string, filename: string, w: number, h: number): Obj {
  const texture = uid+"@"+TEXTURE, frame = uid+"@"+SPRITE, displayName = filename.slice(0,-4);
  const tex = { ...meta("1.0.22","texture",texture,[".json"],{
    wrapModeS:"clamp-to-edge",wrapModeT:"clamp-to-edge",imageUuidOrDatabaseUri:uid,isUuid:true,visible:false,
    minfilter:"linear",magfilter:"linear",mipfilter:"none",anisotropy:0,
  }),displayName,id:TEXTURE,name:"texture" };
  const spr = { ...meta("1.0.12","sprite-frame",frame,[".json"],{
    trimThreshold:1,rotated:false,offsetX:0,offsetY:0,trimX:0,trimY:0,width:w,height:h,rawWidth:w,rawHeight:h,
    borderTop:0,borderBottom:0,borderLeft:0,borderRight:0,packable:true,pixelsToUnit:100,pivotX:.5,pivotY:.5,
    meshType:0,isUuid:true,vertices:{rawPosition:[-w/2,-h/2,0,w/2,-h/2,0,-w/2,h/2,0,w/2,h/2,0],
      indexes:[0,1,2,2,1,3],uv:[0,h,w,h,0,0,w,0],nuv:[0,0,1,0,0,1,1,1],minPos:[-w/2,-h/2,0],maxPos:[w/2,h/2,0]},
    imageUuidOrDatabaseUri:texture,atlasUuid:"",trimType:"none",
  }),displayName,id:SPRITE,name:"spriteFrame" };
  return meta("1.0.26","image",uid,[".json",".png"],{
    type:"sprite-frame",hasAlpha:true,fixAlphaTransparencyArtifacts:true,redirect:frame,
  },{ [TEXTURE]:tex,[SPRITE]:spr });
}
const alignments: Record<string, [number,number]> = {
  start:[0,1],left:[0,1],center:[1,1],stretch:[1,1],end:[2,1],right:[2,1],top:[1,0],bottom:[1,2],
};
for (const [vi,v] of ["top","center","bottom"].entries()) {
  for (const [hi,h] of ["left","center","right"].entries()) alignments[v+"-"+h] = [hi,vi];
}
class Prefab {
  readonly uid: string;
  readonly rows: Obj[];
  constructor(uid: string, title: string) {
    this.uid=uid;
    this.rows=[{__type__:"cc.Prefab",_name:title,_objFlags:0,__editorExtras__:{},_native:"",
      data:ref(1),optimizationPolicy:0,asyncLoadAssets:false,persistent:false}];
  }
  private add(o: Obj): number { return this.rows.push(o)-1; }
  private fileId(stem: string, slot: string): string {
    return Buffer.from(ident(this.uid,stem,slot).replace(/-/g,""),"hex").toString("base64").replace(/=+$/,"");
  }
  private component(node: number, stem: string, kind: string, fields: Obj): void {
    const i=this.add({__type__:kind,_name:"",_objFlags:0,__editorExtras__:{},node:ref(node),
      _enabled:true,...fields,_id:""});
    this.rows[i]!.__prefab=ref(this.add({__type__:"cc.CompPrefabInfo",fileId:this.fileId(stem,kind)}));
    (this.rows[node]!._components as Ref[]).push(ref(i));
  }
  node(parent: number|null, stem: string, title: string, x: number,y: number,w: number,h: number): number {
    const i=this.add({__type__:"cc.Node",_name:title,_objFlags:0,__editorExtras__:{},
      _parent:parent===null?null:ref(parent),_children:[],_active:true,_components:[],_lpos:vec3(x,y),
      _lrot:{__type__:"cc.Quat",x:0,y:0,z:0,w:1},_lscale:vec3(1,1,1),_mobility:0,_layer:33554432,
      _euler:vec3(),_id:""});
    this.rows[i]!._prefab=ref(this.add({__type__:"cc.PrefabInfo",root:ref(1),asset:ref(0),fileId:this.fileId(stem,"node")}));
    this.component(i,stem,"cc.UITransform",{_contentSize:size(w,h),_anchorPoint:{__type__:"cc.Vec2",x:.5,y:.5}});
    if (parent!==null) (this.rows[parent]!._children as Ref[]).push(ref(i));
    return i;
  }
  sprite(node: number, stem: string, uid: string): void {
    this.component(node,stem,"cc.Sprite",{_customMaterial:null,_srcBlendFactor:2,_dstBlendFactor:4,
      _color:color(),_spriteFrame:assetRef(uid+"@"+SPRITE,"cc.SpriteFrame"),_type:0,_fillType:0,
      _sizeMode:0,_fillCenter:{__type__:"cc.Vec2",x:0,y:0},_fillStart:0,_fillRange:0,
      _isTrimmedMode:false,_useGrayscale:false,_atlas:null});
  }
  label(node: number, stem: string, spec: ExportNode, font?: string): void {
    const text=spec.text??"", alignment=spec.align||"center";
    if (typeof text!=="string" || Array.from(text).length>20000) throw new Error("无效节点文字: "+spec.id);
    const resolved=typeof alignment==="string" && Object.hasOwn(alignments,alignment.toLowerCase())
      ? alignments[alignment.toLowerCase()] : undefined;
    if (!resolved) throw new Error("无效文字对齐: "+spec.id);
    const rawSize=num(spec.fontSize??24,"字号",1);
    const fs=rawSize%1===.5?Math.floor(rawSize/2)*2+(Math.floor(rawSize)%2===0?0:2):Math.round(rawSize);
    this.component(node,stem,"cc.Label",{_customMaterial:null,_visFlags:0,_srcBlendFactor:2,_dstBlendFactor:4,
      _color:color(),_string:text,_horizontalAlign:resolved[0],_verticalAlign:resolved[1],_actualFontSize:fs,
      _fontSize:fs,_fontFamily:"Arial",_lineHeight:fs+2,_overflow:1,_enableWrapText:true,
      _font:font?assetRef(font,"cc.TTFFont"):null,_isSystemFontUsed:!font,_spacingX:0,_isItalic:false,
      _isBold:false,_isUnderline:false,_underlineHeight:2,_cacheMode:0,_enableOutline:false});
  }
  button(node: number,stem: string): void {
    this.component(node,stem,"cc.Button",{clickEvents:[],_interactable:true,_transition:0,_normalColor:color(),
      _hoverColor:color(),_pressedColor:color(210,210,210),_disabledColor:color(128,128,128),_normalSprite:null,
      _hoverSprite:null,_pressedSprite:null,_disabledSprite:null,_duration:.1,_zoomScale:.9,_target:ref(node)});
  }
  layout(node: number, stem: string, spec:ExportNode, children:readonly ExportNode[]): number {
    const modes=new Map([["none",0],["horizontal",1],["row",1],["vertical",2],["column",2]]);
    const dir=spec.direction||"none", type=typeof dir==="string"?modes.get(dir.toLowerCase()):undefined;
    if (type===undefined) throw new Error("无效布局方向: "+spec.id);
    const gap=num(spec.gap??0,"布局间距",0), first=children[0];
    this.component(node,stem,"cc.Layout",{_resizeMode:0,_cellSize:size(40,40),_startAxis:0,
      _paddingLeft:type===1&&first?first.x-spec.x:0,_paddingRight:0,_paddingTop:type===2&&first?first.y-spec.y:0,
      _paddingBottom:0,_spacingX:type===1?gap:0,_spacingY:type===2?gap:0,_verticalDirection:1,
      _horizontalDirection:0,_affectedByScale:false,_layoutSize:size(spec.width,spec.height),_layoutType:type});
    return type;
  }
}

function checkedPlan(job: ExportJob) {
  const plan=job.plan;
  if (!plan || !Array.isArray(plan.nodes)) throw new Error("任务缺少已审查方案");
  num(plan.width,"画板 width",1); num(plan.height,"画板 height",1);
  if (!plan.nodes.length || plan.nodes.length>4096) throw new Error("方案节点数量必须为 1–4096");
  const ids=new Set<string>(), children=new Map<string|null,ExportNode[]>();
  for (const node of plan.nodes as readonly ExportNode[]) {
    if (!node || typeof node!=="object" || Array.isArray(node)) throw new Error("方案节点必须是对象");
    const sid=key(node.id,"节点 ID");
    if (ids.has(sid)) throw new Error("重复节点 ID: "+sid);
    ids.add(sid);
    if (!["container","sprite","label","button","layout"].includes(node.kind)) throw new Error("节点类型不支持: "+sid);
    const parent=node.parentId==null ? null : key(node.parentId,"父节点 ID");
    for (const f of ["x","y","width","height"] as const) {
      const positive=f==="width"||f==="height";
      num(node[f],"节点 "+sid+" "+f,positive?0:-100000,positive);
    }
    const siblings=children.get(parent)??[];
    siblings.push(node); children.set(parent,siblings);
  }
  for (const p of children.keys()) if (p!==null&&!ids.has(p)) throw new Error("缺少父节点: "+p);
  const todo=(children.get(null)??[]).map(n=>[n,0] as const) as Array<readonly [ExportNode,number]>;
  while (todo.length) {
    const [n,depth]=todo.pop()!;
    if (depth>64) throw new Error("节点嵌套超过 64 层");
    ids.delete(n.id);
    for (const c of children.get(n.id)??[]) todo.push([c,depth+1]);
  }
  if (ids.size) throw new Error("方案存在循环父子关系");
  return {plan,children};
}

/** No ZIP dependency. Emit ordinary UTF-8 archive entries with stable 1980 DOS times. */
function zip(files:Map<string,Buffer>): Buffer {
  if (files.size>65535) throw new Error("导出文件数量超过 ZIP 格式限制");
  const entries: Buffer[]=[];
  const directory: Buffer[]=[];
  let offset=0, centralSize=0;
  for (const [path,data] of [...files].sort(([a],[b])=>lexical(a,b))) {
    const pathBytes=Buffer.from(path), packed=deflateRawSync(data,{level:6}), crc=crc32(data);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);
    local.writeUInt16LE(20,4); local.writeUInt16LE(0x0800,6); local.writeUInt16LE(8,8);
    local.writeUInt16LE(33,12); local.writeUInt32LE(crc,14);
    local.writeUInt32LE(packed.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(pathBytes.length,26);
    const entry=Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50,0);
    entry.writeUInt16LE(0x0314,4); entry.writeUInt16LE(20,6); entry.writeUInt16LE(0x0800,8);
    entry.writeUInt16LE(8,10); entry.writeUInt16LE(33,14); entry.writeUInt32LE(crc,16);
    entry.writeUInt32LE(packed.length,20); entry.writeUInt32LE(data.length,24); entry.writeUInt16LE(pathBytes.length,28);
    entry.writeUInt32LE((0o100644*65536)>>>0,38); entry.writeUInt32LE(offset,42);
    entries.push(local,pathBytes,packed); directory.push(entry,pathBytes);
    offset += local.length+pathBytes.length+packed.length;
    centralSize += entry.length+pathBytes.length;
  }
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(files.size,8); end.writeUInt16LE(files.size,10);
  end.writeUInt32LE(centralSize,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...entries,...directory,end]);
}

interface AssetInfo {
  id:string; name:string; kind:string; uuid:string; bundle:string; cocosBundle:string; path:string; sha256:string;
  spriteFrameUuid?:string; width?:number; height?:number;
}
function foldPath(path:string):string {
  // JavaScript has no full casefold; cover common expansion cases absent in lowerCase.
  return path.normalize("NFC").toLowerCase().replace(/ß/g,"ss").replace(/ς/g,"σ")
    .replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g,c=>c.normalize("NFKD").toLowerCase());
}

export function build_zip(project: ExportProject, jobs: readonly ExportJob[],
    inputAssets: ReadonlyMap<string,ExportAsset> | Readonly<Record<string,ExportAsset>>,
    get_bytes: (id:string)=>Uint8Array, include_all_assets=false): Buffer {
  const pid=key(project.id,"项目 ID");
  if (project.cocosVersion!==VERSION) throw new Error("仅支持 Cocos Creator "+VERSION);
  if (!jobs.length) throw new Error("没有可导出的界面");
  const token=ident(pid,"root").replace(/-/g,"").slice(0,12), root="assets/figma-ui-"+token;
  const bundleRoot=root+"/bundles";
  const assets=inputAssets instanceof Map ? inputAssets : new Map(Object.entries(inputAssets));
  const files=new Map<string,Buffer>(), uuids=new Map<string,string>(), assetIndex=new Map<string,AssetInfo>();
  const bundleNames=new Map<string,string>(), folders=new Set<string>(), foldedPaths=new Set<string>();
  const jobIds=new Set<string>(), screens: Array<{id:string}&Obj>=[];
  let total=0;
  function put(path:string,data:Buffer) {
    const folded=foldPath(path);
    if (foldedPaths.has(folded)) throw new Error("导出文件路径冲突: "+path);
    total+=data.length;
    if (total>MAX_BYTES) throw new Error("导出内容超过 256 MB");
    foldedPaths.add(folded); files.set(path,data);
  }
  function register(uid:string,path:string) {
    if (uuids.has(uid)) throw new Error("资源 UUID 冲突: "+uuids.get(uid)+" / "+path);
    uuids.set(uid,path);
  }
  function folder(path:string,data?:Obj) {
    if (folders.has(path)) return;
    folders.add(path);
    const uid=ident(pid,"directory",path);
    register(uid,path+".meta");
    put(path+".meta",jsonify(meta("1.2.0","directory",uid,[],data)));
  }
  folder(root); folder(root+"/prefabs");

  function useAsset(assetId: string, kind: "image"|"font", sid:string):string {
    const aid=key(assetId,"资源 ID"), a=assets.get(aid);
    if (!a || typeof a!=="object" || (a.id!==undefined&&a.id!==aid)) {
      throw new Error("节点 "+sid+" 引用缺失资源: "+aid);
    }
    if (a.kind!==kind) throw new Error("节点 "+sid+" 的资源 "+aid+" 不是 "+kind);
    const cached=assetIndex.get(aid);
    if (cached) return cached.uuid;
    const wanted=kind==="image"?"image/png":"font/ttf";
    if (a.mime!==wanted) {
      const text=kind==="image"?"请先标准化为 PNG":"Creator 导出仅支持已验证的 TTF，请换用 TTF";
      throw new Error("资源 "+aid+" 格式不支持；"+text);
    }
    let raw:Uint8Array;
    try { raw=get_bytes(aid); }
    catch (cause) { throw new Error("无法读取资源 "+aid,{cause}); }
    if (!(raw instanceof Uint8Array) || !raw.byteLength) throw new Error("资源 "+aid+" 没有可导出的字节");
    if (raw.byteLength>MAX_BYTES-total) throw new Error("导出内容超过 256 MB");
    const content=Buffer.from(raw);
    let uid:string;
    try { uid=a.uuid?checkedUuid(a.uuid):ident(pid,"asset",aid); }
    catch (cause) { throw new Error("资源 "+aid+" UUID 无效",{cause}); }
    const bundle=key(a.bundle||"common","Bundle 名称");
    let bn=bundleNames.get(bundle);
    if (!bn) {
      const slug=bundle.normalize("NFKD").toLowerCase().replace(/[^a-z0-9-]+/g,"-")
        .replace(/^-+|-+$/g,"").slice(0,28)||"bundle";
      bn="figma-"+token+"-"+slug+"-"+ident(pid,"bundle",bundle).slice(0,8);
      bundleNames.set(bundle,bn);
      folder(bundleRoot);
      folder(bundleRoot+"/"+bn,{isBundle:true,bundleName:bn,isRemoteBundle:false});
    }
    const parent=bundleRoot+"/"+bn, dir=kind==="image"?"textures":"fonts", ext=kind==="image"?"png":"ttf";
    let filename="asset-"+uid+"."+ext;
    if (a.path) {
      if (typeof a.path!=="string") throw new Error("资源 "+aid+" 的导出路径无效");
      const p=a.path.normalize("NFC");
      const [givenDir,base,...rest]=p.split("/");
      if (givenDir!==dir || rest.length || !base || /[\x00-\x1f]/.test(base) ||
          !new RegExp("^[\\p{L}\\p{N}_-][\\p{L}\\p{N}_ .-]{0,159}\\."+ext+"$","iu").test(base)) {
        throw new Error("资源 "+aid+" 的导出路径无效");
      }
      if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(base)) {
        throw new Error("资源 "+aid+" 的导出文件名无效");
      }
      filename=base;
    }
    folder(parent+"/"+dir);
    const path=parent+"/"+dir+"/"+filename;
    const info:AssetInfo={id:aid,name:display(a.name,aid),kind,uuid:uid,bundle,cocosBundle:bn,path,
      sha256:createHash("sha256").update(content).digest("hex")};
    register(uid,path);
    let m:Obj;
    if (kind==="image") {
      if (content.length<45 || !content.subarray(0,16).equals(PNG_HEAD) || !content.subarray(-12).equals(PNG_END)) {
        throw new Error("资源 "+aid+" 的 PNG 数据无效");
      }
      const w=content.readUInt32BE(16), h=content.readUInt32BE(20);
      if (!w||!h||a.width!==w||a.height!==h) throw new Error("资源 "+aid+" 的 PNG 尺寸与登记数据不符");
      Object.assign(info,{spriteFrameUuid:uid+"@"+SPRITE,width:w,height:h});
      register(uid+"@"+TEXTURE,path+".meta#"+TEXTURE); register(uid+"@"+SPRITE,path+".meta#"+SPRITE);
      m=imageMeta(uid,filename,w,h);
    } else {
      if (content.length<12 || !content.subarray(0,4).equals(TTF_HEAD)) throw new Error("资源 "+aid+" 的 TTF 数据无效");
      m=meta("1.0.1","ttf-font",uid,[".json",filename]);
    }
    put(path,content); put(path+".meta",jsonify(m)); assetIndex.set(aid,info);
    return uid;
  }

  for (const job of jobs) {
    const jid=key(job.id,"任务 ID");
    if (jobIds.has(jid)) throw new Error("重复任务 ID: "+jid);
    jobIds.add(jid);
    const {plan,children}=checkedPlan(job), title=display(job.name,"Screen"), uid=ident(pid,"prefab",jid);
    const path=root+"/prefabs/screen-"+uid+".prefab", b=new Prefab(uid,title);
    const rootNode=b.node(null,"@root",title,0,0,plan.width,plan.height);
    const used=new Set<string>(), warnings:Obj[]=[];
    function add(n:ExportNode,parent:number,rect:Rect):void {
      const {id:sid,kind,width:w,height:h}=n, stem="node:"+sid;
      const x=n.x-rect.x+(w-rect.width)/2, y=(rect.height-h)/2-(n.y-rect.y);
      const row=b.node(parent,stem,display(n.name,kind),x,y,w,h);
      const image=n.assetId, font=n.fontAssetId, hasText=n.text!==null&&n.text!==undefined;
      if (image!==null&&image!==undefined&&image!=="") {
        if (kind!=="sprite"&&kind!=="button") throw new Error("节点 "+sid+" 的类型不支持图片引用");
        b.sprite(row,stem,useAsset(image,"image",sid)); used.add(image);
      } else if (kind==="sprite") warnings.push({nodeId:sid,code:"sprite-placeholder",detail:"缺少图片，保留空节点"});
      let fuid:string|undefined;
      if (font!==null&&font!==undefined&&font!=="") {
        if (kind!=="label" && (kind!=="button"||!hasText)) throw new Error("节点 "+sid+" 的字体引用没有对应文字");
        fuid=useAsset(font,"font",sid); used.add(font);
      }
      if (kind==="label") {
        b.label(row,stem,n,fuid);
        if (n.align==="stretch") warnings.push({nodeId:sid,code:"label-align-stretch",
          detail:"原文字框保持宽度；Cocos Label 不支持拉伸文字，改为居中对齐"});
      }
      if (kind==="button") {
        b.button(row,stem);
        if (hasText) {
          const subkey="generated-button-label:"+sid, label=b.node(row,subkey,"Label",0,0,w,h);
          b.label(label,subkey,n,fuid);
        }
      }
      if (kind!=="label"&&n.align) warnings.push({nodeId:sid,code:"nonlabel-align",
        detail:"几何位置已保留；未生成额外的跨轴对齐、拉伸约束或 Widget"});
      const descendants=children.get(sid)??[];
      if (kind==="layout"&&b.layout(row,stem,n,descendants)) warnings.push({nodeId:sid,code:"layout-reflow",
        detail:"Creator 按节点顺序、显式方向与间距沿主轴排列；以首个子节点的原始偏移作为起始内边距，主轴可与原坐标不同"});
      for (const child of descendants) add(child,row,n);
    }
    for (const n of children.get(null)??[]) add(n,rootNode,{x:0,y:0,width:plan.width,height:plan.height});
    register(uid,path);
    const stack:unknown[]=[...b.rows];
    while (stack.length) {
      const item=stack.pop();
      if (Array.isArray(item)) stack.push(...item);
      else if (item && typeof item==="object") {
        const ob=item as Obj;
        if ("__uuid__" in ob && !uuids.has(ob.__uuid__ as string)) throw new Error("预制体 "+jid+" 的资源引用未打包");
        if ("__id__" in ob && !(Number.isInteger(ob.__id__) && (ob.__id__ as number)>=0 && (ob.__id__ as number)<b.rows.length)) {
          throw new Error("预制体 "+jid+" 的内部引用无效");
        }
        stack.push(...Object.values(ob));
      }
    }
    put(path,jsonify(b.rows));
    put(path+".meta",jsonify(meta("1.1.45","prefab",uid,[".json"],{syncNodeName:title})));
    screens.push({id:jid,name:title,path,uuid:uid,assets:[...used].sort(lexical),warnings,reviewIssues:plan.issues??[]});
  }
  const excludedAssets:Obj[]=[];
  if (include_all_assets) for (const [aid,a] of [...assets].sort(([x],[y])=>lexical(x,y))) {
    if (assetIndex.has(aid)) continue;
    if (a.kind==="image"&&a.mime==="image/png") useAsset(aid,"image","项目资源库");
    else if (a.kind==="font"&&a.mime==="font/ttf") useAsset(aid,"font","项目资源库");
    else excludedAssets.push({id:aid,name:display(a.name,aid),reason:"格式暂无 Creator 3.8.8 导出支持"});
  }
  put("manifest.json",jsonify({
    excludedAssets,format:"figma2gameui-cocos-export-v1",cocosVersion:VERSION,project:{id:pid,name:display(project.name,pid)},
    assetRoot:root,screens:screens.sort((a,b)=>lexical(a.id,b.id)),
    assets:[...assetIndex].sort(([a],[b])=>lexical(a,b)).map(([,a])=>a),
    bundles:[...bundleNames].sort(([a],[b])=>lexical(a,b)).map(([name,cocosBundle])=>({name,cocosBundle,path:bundleRoot+"/"+cocosBundle})),
    manualVerification:["用 Creator 3.8.8 实际导入、预览并重导检查 UUID","不生成按钮业务回调、图集、动画、遮罩或适配约束"],
  }));
  return zip(files);
}
