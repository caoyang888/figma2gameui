"""Reviewed-plan Cocos 3.8.8 export. Serialization follows upstream prefab.ts
(94d280a3) and meta.ts (1a52769c), supplemented by existing 3.8.8 fixtures.
The supplied byte accessor is the only source of asset data.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import re
import struct
import unicodedata
import uuid
import zipfile
from collections.abc import Callable, Mapping

VERSION = "3.8.8"
NS = uuid.UUID("eba33b77-2488-4b38-8883-8af7900616f3")
TEXTURE, SPRITE = "6c48a", "f9941"
MAX_BYTES = 256 * 1024 * 1024


def ident(*parts):
    return str(uuid.uuid5(NS, json.dumps(parts, ensure_ascii=False, separators=(",", ":"))))


def key(value, desc):
    if not isinstance(value, str) or not value or len(value) > 256 or any(ord(c) < 32 for c in value):
        raise ValueError(f"无效{desc}")
    return value


def num(value, desc, minimum=-100000, *, positive=False):
    if type(value) not in (int, float) or not minimum <= value <= 100000 or not math.isfinite(value) or (positive and value <= 0):
        raise ValueError(f"无效{desc}")
    return value


def name(value, fallback):
    return "".join(c for c in str(value or "") if ord(c) >= 32).strip()[:120] or fallback


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()


def ref(value):
    return {"__id__": value}


def asset_ref(value, expected):
    return {"__uuid__": value, "__expectedType__": expected}


def size(w, h):
    return {"__type__": "cc.Size", "width": w, "height": h}


def vec3(x=0, y=0, z=0):
    return {"__type__": "cc.Vec3", "x": x, "y": y, "z": z}


def color(r=255, g=255, b=255, a=255):
    return {"__type__": "cc.Color", "r": r, "g": g, "b": b, "a": a}


def meta(ver, importer, uid, files, user=None, sub=None):
    return {"ver": ver, "importer": importer, "imported": True, "uuid": uid,
            "files": files, "subMetas": sub or {}, "userData": user or {}}


def image_meta(uid, filename, w, h):
    texture, frame = uid+"@"+TEXTURE, uid+"@"+SPRITE
    display = filename[:-4]
    tex = meta("1.0.22", "texture", texture, [".json"], {
        "wrapModeS": "clamp-to-edge", "wrapModeT": "clamp-to-edge",
        "imageUuidOrDatabaseUri": uid, "isUuid": True, "visible": False,
        "minfilter": "linear", "magfilter": "linear", "mipfilter": "none", "anisotropy": 0,
    })
    spr = meta("1.0.12", "sprite-frame", frame, [".json"], {
        "trimThreshold": 1, "rotated": False, "offsetX": 0, "offsetY": 0, "trimX": 0, "trimY": 0,
        "width": w, "height": h, "rawWidth": w, "rawHeight": h,
        "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0, "packable": True,
        "pixelsToUnit": 100, "pivotX": .5, "pivotY": .5, "meshType": 0, "isUuid": True,
        "vertices": {"rawPosition": [-w/2,-h/2,0,w/2,-h/2,0,-w/2,h/2,0,w/2,h/2,0],
                     "indexes": [0,1,2,2,1,3], "uv": [0,h,w,h,0,0,w,0], "nuv": [0,0,1,0,0,1,1,1],
                     "minPos": [-w/2,-h/2,0], "maxPos": [w/2,h/2,0]},
        "imageUuidOrDatabaseUri": texture, "atlasUuid": "", "trimType": "none",
    })
    tex.update(displayName=display, id=TEXTURE, name="texture")
    spr.update(displayName=display, id=SPRITE, name="spriteFrame")
    return meta("1.0.26", "image", uid, [".json", ".png"],
                {"type": "sprite-frame", "hasAlpha": True, "fixAlphaTransparencyArtifacts": True,
                 "redirect": frame}, {TEXTURE: tex, SPRITE: spr})


class Prefab:
    def __init__(self, uid, title):
        self.uid = uid
        self.rows = [{"__type__": "cc.Prefab", "_name": title, "_objFlags": 0, "__editorExtras__": {},
                      "_native": "", "data": ref(1), "optimizationPolicy": 0,
                      "asyncLoadAssets": False, "persistent": False}]

    def add(self, obj):
        self.rows.append(obj)
        return len(self.rows)-1

    def file_id(self, stem, slot):
        return base64.b64encode(uuid.UUID(ident(self.uid, stem, slot)).bytes).decode().rstrip("=")

    def component(self, node, stem, kind, **fields):
        idx = self.add({"__type__": kind, "_name": "", "_objFlags": 0, "__editorExtras__": {},
                        "node": ref(node), "_enabled": True, **fields, "_id": ""})
        self.rows[idx]["__prefab"] = ref(self.add({"__type__": "cc.CompPrefabInfo",
                                                    "fileId": self.file_id(stem, kind)}))
        self.rows[node]["_components"].append(ref(idx))

    def node(self, parent, stem, title, x, y, w, h):
        idx = self.add({"__type__": "cc.Node", "_name": title, "_objFlags": 0, "__editorExtras__": {},
                        "_parent": ref(parent) if parent is not None else None, "_children": [],
                        "_active": True, "_components": [], "_lpos": vec3(x,y),
                        "_lrot": {"__type__": "cc.Quat", "x":0,"y":0,"z":0,"w":1},
                        "_lscale": vec3(1,1,1), "_mobility": 0, "_layer": 33554432,
                        "_euler": vec3(), "_id": ""})
        self.rows[idx]["_prefab"] = ref(self.add({"__type__": "cc.PrefabInfo", "root": ref(1),
                                                  "asset": ref(0), "fileId": self.file_id(stem,"node")}))
        self.component(idx, stem, "cc.UITransform", _contentSize=size(w,h),
                       _anchorPoint={"__type__": "cc.Vec2", "x": .5, "y": .5})
        if parent is not None:
            self.rows[parent]["_children"].append(ref(idx))
        return idx

    def sprite(self, node, stem, uid):
        # Custom size mode preserves the approved rectangle, not raw PNG size.
        self.component(node, stem, "cc.Sprite", _customMaterial=None, _srcBlendFactor=2, _dstBlendFactor=4,
                       _color=color(), _spriteFrame=asset_ref(uid+"@"+SPRITE, "cc.SpriteFrame"),
                       _type=0, _fillType=0, _sizeMode=0, _fillCenter={"__type__": "cc.Vec2", "x":0,"y":0},
                       _fillStart=0, _fillRange=0, _isTrimmedMode=False, _useGrayscale=False, _atlas=None)

    def label(self, node, stem, spec, font):
        text = spec.get("text", "")
        if not isinstance(text, str) or len(text)>20000:
            raise ValueError(f"节点 {spec['id']} 的文字无效")
        align = spec.get("align") or "center"
        alignments = {
            "start":(0,1), "left":(0,1), "center":(1,1), "stretch":(1,1),
            "end":(2,1), "right":(2,1), "top":(1,0), "bottom":(1,2),
            **{f"{v}-{h}":(hi,vi) for vi,v in enumerate(("top","center","bottom"))
               for hi,h in enumerate(("left","center","right"))},
        }
        if not isinstance(align,str) or align.lower() not in alignments:
            raise ValueError(f"节点 {spec['id']} 的文字对齐无效")
        horizontal,vertical = alignments[align.lower()]
        fs = round(num(spec.get("fontSize",24),"字号",1))
        self.component(node, stem, "cc.Label", _customMaterial=None, _visFlags=0, _srcBlendFactor=2,
                       _dstBlendFactor=4, _color=color(), _string=text, _horizontalAlign=horizontal,
                       _verticalAlign=vertical, _actualFontSize=fs, _fontSize=fs, _fontFamily="Arial", _lineHeight=fs+2,
                       _overflow=1, _enableWrapText=True, _font=asset_ref(font,"cc.TTFFont") if font else None,
                       _isSystemFontUsed=not font, _spacingX=0, _isItalic=False, _isBold=False, _isUnderline=False,
                       _underlineHeight=2, _cacheMode=0, _enableOutline=False)

    def button(self, node, stem):
        self.component(node, stem, "cc.Button", clickEvents=[], _interactable=True, _transition=0,
                       _normalColor=color(), _hoverColor=color(), _pressedColor=color(210,210,210),
                       _disabledColor=color(128,128,128), _normalSprite=None, _hoverSprite=None,
                       _pressedSprite=None, _disabledSprite=None, _duration=.1, _zoomScale=.9, _target=ref(node))

    def layout(self, node, stem, spec, children):
        direction = spec.get("direction") or "none"
        modes = {"none":0,"horizontal":1,"row":1,"vertical":2,"column":2}
        if not isinstance(direction,str) or direction.lower() not in modes:
            raise ValueError(f"节点 {spec['id']} 的布局方向不支持")
        typ = modes[direction.lower()]
        gap = num(spec.get("gap",0),"布局间距",0)
        first = children[0] if children else None
        self.component(node, stem, "cc.Layout", _resizeMode=0, _cellSize=size(40,40), _startAxis=0,
                       _paddingLeft=first["x"]-spec["x"] if typ==1 and first else 0, _paddingRight=0,
                       _paddingTop=first["y"]-spec["y"] if typ==2 and first else 0, _paddingBottom=0,
                       _spacingX=gap if typ==1 else 0, _spacingY=gap if typ==2 else 0,
                       _verticalDirection=1, _horizontalDirection=0, _affectedByScale=False,
                       _layoutSize=size(spec["width"],spec["height"]), _layoutType=typ)
        return typ


def checked_plan(job):
    plan = job.get("plan")
    if not isinstance(plan, dict) or not isinstance(plan.get("nodes"),list):
        raise ValueError("任务缺少已审查方案")
    for field in ("width","height"):
        num(plan.get(field),f"画板 {field}",1)
    if not 1 <= len(plan["nodes"]) <= 4096:
        raise ValueError("方案节点数量必须为 1–4096")
    ids, children = set(), {}
    for node in plan["nodes"]:
        if not isinstance(node,dict):
            raise ValueError("方案节点必须是对象")
        sid = key(node.get("id"),"节点 ID")
        if sid in ids:
            raise ValueError(f"重复节点 ID: {sid}")
        ids.add(sid)
        if node.get("kind") not in ("container","sprite","label","button","layout"):
            raise ValueError(f"节点 {sid} 类型不支持")
        parent = node.get("parentId")
        if parent is not None:
            key(parent,"父节点 ID")
        for field in ("x","y","width","height"):
            num(node.get(field),f"节点 {sid} {field}",0 if field in ("width","height") else -100000,
                positive=field in ("width","height"))
        children.setdefault(parent,[]).append(node)
    for parent in children:
        if parent is not None and parent not in ids:
            raise ValueError(f"缺少父节点: {parent}")
    todo = [(n,0) for n in children.get(None,[])]
    while todo:
        node,depth = todo.pop()
        if depth>64:
            raise ValueError("节点嵌套超过 64 层")
        ids.remove(node["id"])
        todo.extend((c,depth+1) for c in children.get(node["id"],[]))
    if ids:
        raise ValueError("方案存在循环父子关系")
    return plan,children


def build_zip(project: dict, jobs: list[dict], assets: Mapping[str,dict],
              get_bytes: Callable[[str],bytes], *, include_all_assets=False) -> bytes:
    """Emit reviewed screens and referenced resources, or fail without returning a partial ZIP."""
    pid = key(project.get("id"),"项目 ID")
    if project.get("cocosVersion") != VERSION:
        raise ValueError(f"仅支持 Cocos Creator {VERSION}")
    if not jobs:
        raise ValueError("没有可导出的界面")
    token = ident(pid,"root").replace("-","")[:12]
    root = "assets/figma-ui-"+token
    bundle_root = root+"/bundles"
    files, uuids, asset_index, bundle_names = {}, {}, {}, {}
    folders, folded_paths, job_ids = set(),set(),set()
    screens = []
    total = 0

    def put(path, data):
        nonlocal total
        folded = unicodedata.normalize("NFC",path).casefold()
        if folded in folded_paths:
            raise ValueError(f"导出文件路径冲突: {path}")
        total += len(data)
        if total>MAX_BYTES:
            raise ValueError("导出内容超过 256 MB")
        folded_paths.add(folded)
        files[path] = data

    def register(uid,path):
        if uid in uuids:
            raise ValueError(f"资源 UUID 冲突: {uuids[uid]} / {path}")
        uuids[uid] = path

    def folder(path,user=None):
        if path not in folders:
            folders.add(path)
            uid = ident(pid,"directory",path)
            register(uid,path+".meta")
            put(path+".meta",json_bytes(meta("1.2.0","directory",uid,[],user)))

    folder(root)
    folder(root+"/prefabs")

    def use_asset(aid, kind, sid):
        aid = key(aid,"资源 ID")
        raw = assets.get(aid)
        if not isinstance(raw,Mapping) or raw.get("id",aid)!=aid:
            raise ValueError(f"节点 {sid} 引用缺失资源: {aid}")
        if raw.get("kind")!=kind:
            raise ValueError(f"节点 {sid} 的资源 {aid} 不是 {kind}")
        if aid in asset_index:
            return asset_index[aid]["uuid"]
        wanted = "image/png" if kind=="image" else "font/ttf"
        if raw.get("mime")!=wanted:
            help_text = "请先标准化为 PNG" if kind=="image" else "Creator 导出仅支持已验证的 TTF，请换用 TTF"
            raise ValueError(f"资源 {aid} 格式不支持；{help_text}")
        try:
            content = get_bytes(aid)
        except (KeyError,OSError) as cause:
            raise ValueError(f"无法读取资源 {aid}") from cause
        if not isinstance(content,bytes) or not content:
            raise ValueError(f"资源 {aid} 没有可导出的字节")
        try:
            uid = str(uuid.UUID(raw["uuid"])) if raw.get("uuid") else ident(pid,"asset",aid)
        except (TypeError,ValueError,AttributeError) as cause:
            raise ValueError(f"资源 {aid} UUID 无效") from cause
        bundle = key(raw.get("bundle") or "common","Bundle 名称")
        if bundle not in bundle_names:
            slug = re.sub("[^a-z0-9-]+","-",unicodedata.normalize("NFKD",bundle).lower()).strip("-")[:28] or "bundle"
            bn = "figma-"+token+"-"+slug+"-"+ident(pid,"bundle",bundle)[:8]
            bundle_names[bundle] = bn
            folder(bundle_root)
            folder(bundle_root+"/"+bn,{"isBundle":True,"bundleName":bn,"isRemoteBundle":False})
        parent = bundle_root+"/"+bundle_names[bundle]
        directory,ext = ("textures","png") if kind=="image" else ("fonts","ttf")
        supplied = raw.get("path")
        if supplied:
            if not isinstance(supplied,str):
                raise ValueError(f"资源 {aid} 的导出路径无效")
            supplied = unicodedata.normalize("NFC",supplied)
            pattern = directory+r"/[\w-][\w .-]{0,159}\."+ext
            if not re.fullmatch(pattern,supplied,re.IGNORECASE) or supplied.split("/")[0]!=directory:
                raise ValueError(f"资源 {aid} 的导出路径无效")
            filename = supplied.split("/")[1]
            if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", filename):
                raise ValueError(f"资源 {aid} 的导出文件名无效")
        else:
            filename = "asset-"+uid+"."+ext
        folder(parent+"/"+directory)
        path = parent+"/"+directory+"/"+filename
        info = {"id":aid,"name":name(raw.get("name"),aid),"kind":kind,"uuid":uid,"bundle":bundle,
                "cocosBundle":bundle_names[bundle],"path":path,"sha256":hashlib.sha256(content).hexdigest()}
        register(uid,path)
        if kind=="image":
            if len(content)<45 or content[:16]!=b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" or content[-12:]!=b"\0\0\0\0IEND\xaeB\x60\x82":
                raise ValueError(f"资源 {aid} 的 PNG 数据无效")
            width,height = struct.unpack_from(">II",content,16)
            if not width or not height or raw.get("width")!=width or raw.get("height")!=height:
                raise ValueError(f"资源 {aid} 的 PNG 尺寸与登记数据不符")
            info.update(spriteFrameUuid=uid+"@"+SPRITE,width=width,height=height)
            register(uid+"@"+TEXTURE,path+".meta#"+TEXTURE)
            register(uid+"@"+SPRITE,path+".meta#"+SPRITE)
            am = image_meta(uid,filename,width,height)
        else:
            if len(content)<12 or content[:4]!=b"\x00\x01\x00\x00":
                raise ValueError(f"资源 {aid} 的 TTF 数据无效")
            am = meta("1.0.1","ttf-font",uid,[".json",filename])
        put(path,content)
        put(path+".meta",json_bytes(am))
        asset_index[aid] = info
        return uid

    for job in jobs:
        jid = key(job.get("id"),"任务 ID")
        if jid in job_ids:
            raise ValueError(f"重复任务 ID: {jid}")
        job_ids.add(jid)
        plan,children = checked_plan(job)
        title = name(job.get("name"),"Screen")
        uid = ident(pid,"prefab",jid)
        path = root+"/prefabs/screen-"+uid+".prefab"
        b = Prefab(uid,title)
        root_node = b.node(None,"@root",title,0,0,plan["width"],plan["height"])
        used, warnings = set(), []

        def add(node,parent,rect):
            sid,kind = node["id"],node["kind"]
            stem = "node:"+sid
            w,h = node["width"],node["height"]
            x = node["x"]-rect["x"]+(w-rect["width"])/2
            y = (rect["height"]-h)/2-(node["y"]-rect["y"])
            row = b.node(parent,stem,name(node.get("name"),kind),x,y,w,h)
            image,font = node.get("assetId"),node.get("fontAssetId")
            has_text = "text" in node and node["text"] is not None
            if image is not None and image!="":
                if kind not in ("sprite","button"):
                    raise ValueError(f"节点 {sid} 的类型不支持图片引用")
                b.sprite(row,stem,use_asset(image,"image",sid))
                used.add(image)
            elif kind=="sprite":
                warnings.append({"nodeId":sid,"code":"sprite-placeholder","detail":"缺少图片，保留空节点"})
            fuid = None
            if font is not None and font!="":
                if kind not in ("label","button") or (kind=="button" and not has_text):
                    raise ValueError(f"节点 {sid} 的字体引用没有对应文字")
                fuid = use_asset(font,"font",sid)
                used.add(font)
            if kind=="label":
                b.label(row,stem,node if has_text else {**node,"text":""},fuid)
                if node.get("align")=="stretch":
                    warnings.append({"nodeId":sid,"code":"label-align-stretch",
                                     "detail":"原文字框保持宽度；Cocos Label 不支持拉伸文字，改为居中对齐"})
            if kind=="button":
                b.button(row,stem)
                if has_text:
                    subkey = "generated-button-label:"+sid
                    label = b.node(row,subkey,"Label",0,0,w,h)
                    b.label(label,subkey,node,fuid)
            if kind!="label" and node.get("align"):
                warnings.append({"nodeId":sid,"code":"nonlabel-align",
                                 "detail":"几何位置已保留；未生成额外的跨轴对齐、拉伸约束或 Widget"})
            descendants = children.get(sid,[])
            if kind=="layout" and b.layout(row,stem,node,descendants):
                warnings.append({"nodeId":sid,"code":"layout-reflow",
                                 "detail":"Creator 按节点顺序、显式方向与间距沿主轴排列；以首个子节点的原始偏移作为起始内边距，主轴可与原坐标不同"})
            for child in descendants:
                add(child,row,node)

        for node in children.get(None,[]):
            add(node,root_node,{"x":0,"y":0,"width":plan["width"],"height":plan["height"]})
        register(uid,path)
        todo = list(b.rows)
        while todo:
            item = todo.pop()
            if isinstance(item,dict):
                if "__uuid__" in item and item["__uuid__"] not in uuids:
                    raise ValueError(f"预制体 {jid} 的资源引用未打包")
                if "__id__" in item and not 0 <= item["__id__"] < len(b.rows):
                    raise ValueError(f"预制体 {jid} 的内部引用无效")
                todo.extend(item.values())
            elif isinstance(item,list):
                todo.extend(item)
        put(path,json_bytes(b.rows))
        put(path+".meta",json_bytes(meta("1.1.45","prefab",uid,[".json"],{"syncNodeName":title})))
        screens.append({"id":jid,"name":title,"path":path,"uuid":uid,"assets":sorted(used),"warnings":warnings,"reviewIssues":plan.get("issues",[])})
    excluded = []
    if include_all_assets:
        for aid, asset in sorted(assets.items()):
            if aid in asset_index:
                continue
            if asset.get("kind")=="image" and asset.get("mime")=="image/png":
                use_asset(aid,"image","项目资源库")
            elif asset.get("kind")=="font" and asset.get("mime")=="font/ttf":
                use_asset(aid,"font","项目资源库")
            else:
                excluded.append({"id":aid,"name":name(asset.get("name"),aid),"reason":"格式暂无 Creator 3.8.8 导出支持"})
    manifest = {"excludedAssets":excluded,"format":"figma2gameui-cocos-export-v1","cocosVersion":VERSION,
                "project":{"id":pid,"name":name(project.get("name"),pid)},"assetRoot":root,
                "screens":sorted(screens,key=lambda x:x["id"]),"assets":[asset_index[k] for k in sorted(asset_index)],
                "bundles":[{"name":k,"cocosBundle":v,"path":bundle_root+"/"+v} for k,v in sorted(bundle_names.items())],
                "manualVerification":["用 Creator 3.8.8 实际导入、预览并重导检查 UUID",
                                      "不生成按钮业务回调、图集、动画、遮罩或适配约束"]}
    put("manifest.json",json_bytes(manifest))
    out = io.BytesIO()
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as archive:
        for path,data in sorted(files.items()):
            entry = zipfile.ZipInfo(path,(1980,1,1,0,0,0))
            entry.create_system,entry.external_attr = 3,0o100644<<16
            archive.writestr(entry,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
    return out.getvalue()
