"""Start with python3 app.py. Use one process and a persisted data volume."""
import base64
import binascii
import hashlib
import hmac
import json
import mimetypes
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from asset_import import parse_inputs, MAX_UPLOAD_BYTES
from plan import validate_plan, PLAN_INSTRUCTIONS
from provider import list_models, probe_vision, analyze, ProviderError
from store import Store, clean_name

WEB=Path(__file__).resolve().parent/"web"
ID=r"[a-f0-9]{32}"
BODY_LIMIT=(MAX_UPLOAD_BYTES*4+2)//3+512*1024
STATIC={"/":("index.html","text/html; charset=utf-8"),"/app.js":("app.js","text/javascript; charset=utf-8"),
        "/styles.css":("styles.css","text/css; charset=utf-8")}
MAX_VISION_IMAGES=24
MAX_VISION_BYTES=5*1024*1024
class AppError(ValueError):
    def __init__(self, text,status=400):
        super().__init__(text)
        self.status=status

def parse_files(rows):
    if not isinstance(rows,list) or len(rows)>256 or not rows:
        raise ValueError("请选择 1–256 个素材或 ZIP 文件。")
    pairs=[]
    for row in rows:
        if not isinstance(row,dict) or not isinstance(row.get("content"),str):
            raise ValueError("上传内容格式不正确。")
        try:
            data=base64.b64decode(row["content"],validate=True)
        except (binascii.Error,ValueError):
            raise ValueError("上传内容格式不正确。") from None
        pairs.append((clean_name(row.get("name"),255),data))
    if sum(len(x[1]) for x in pairs)>MAX_UPLOAD_BYTES:
        raise ValueError("上传总大小超过 32 MiB。")
    return parse_inputs(pairs)

def requested_dimension(v):
    if v in (None,""):return None
    if type(v) is not int or not 1<=v<=16384:raise ValueError("画布尺寸须为 1–16384 的整数。")
    return v

def wire_plan(raw,assets,width=None,height=None):
    plan=validate_plan(raw,{a["id"] for a in assets})
    if width and plan["width"]!=width or height and plan["height"]!=height:
        raise ValueError("方案画布与参考图或指定尺寸不一致。")
    by={a["id"]:a for a in assets}
    for n in plan["nodes"]:
        if "assetId" in n and by[n["assetId"]]["kind"]!="image":
            raise ValueError("贴图节点必须引用图片。")
        if "fontAssetId" in n and by[n["fontAssetId"]]["mime"]!="font/ttf":
            raise ValueError("Creator 3.8.8 导出的 Label 请绑定 TTF 字体，或使用系统字体。")
    return plan

class Studio:
    def __init__(self,path):
        self.store=Store(path)
        self.password=os.environ.get("F2_WORKSPACE_PASSWORD","")
        self.local_dev=os.environ.get("F2_DEV_LOCAL")=="1"
        self.site_origin=os.environ.get("F2_SITE_ORIGIN","").rstrip("/")
        self.worker_stop=threading.Event()
        self.worker_wake=threading.Event()
        self.probe_lock=threading.Lock()
        self.probe_next=0.0
        self.thread=None

    def start(self):
        self.store.reset_interrupted()
        self.thread=threading.Thread(target=self.worker,daemon=True)
        self.thread.start()
    
    def settings_credentials(self,body):
        url=clean_name(body.get("baseUrl"),512).rstrip("/")
        key=body.get("apiKey","")
        if not isinstance(key,str) or len(key)>4096 or any(ord(c)<32 or ord(c)>126 for c in key):
            raise ValueError("API 密钥格式无效。")
        if not key:
            cur=self.store.settings(private=True)
            if url==cur["baseUrl"] and cur["configured"]:
                key=cur["key"]
            else: raise ValueError("请填写 API 密钥。")
        return url,key

    def run_analysis(self,job,cfg,assets):
        pid=job["projectId"]
        selected={a["id"]:a for a in assets}
        from PIL import Image
        from io import BytesIO
        def preview(image_bytes):
            with Image.open(BytesIO(image_bytes)) as im:
                im.thumbnail((1024,1024))
                output=BytesIO()
                im.save(output,format="PNG",optimize=True)
                return output.getvalue()
        refs=[(aid,None) for aid in job["spec"]["assetIds"] if selected[aid]["kind"]=="image"]
        if job["reference"]: refs.insert(0,("reference",job["reference"]))
        if len(refs)>MAX_VISION_IMAGES:
            raise ValueError("每个界面的 AI 分析最多接受 24 张图（含参考图）。")
        images,total=[],0
        for aid,raw in refs:
            data=preview(raw if raw is not None else self.store.asset_bytes(pid,aid)[1])
            total+=len(data)
            if total>MAX_VISION_BYTES:
                raise ValueError("处理后的图片总大小超过 5 MiB，请按界面拆分再试。")
            images.append({"id":aid,"mime":"image/png","data":data})
        context={
            "screen":job["name"],"has_reference":bool(job["reference"]),
            "width":job["spec"]["width"],"height":job["spec"]["height"],
            "assets":[{k:a[k] for k in ("id","name","width","height","kind","tags")} for a in assets if a["kind"]!="font" or a["mime"]=="font/ttf"],
            "contract":PLAN_INSTRUCTIONS}
        plan=analyze(cfg["baseUrl"],cfg["key"],cfg["model"],images,context)
        return wire_plan(plan,assets,context["width"],context["height"])

    def worker(self):
        while not self.worker_stop.is_set():
            try:
                job=self.store.next_job()
            except Exception:
                self.worker_stop.wait(0.5)
                continue
            if not job:
                self.worker_wake.wait(0.7);self.worker_wake.clear()
                continue
            try:
                cfg=self.store.settings(private=True)
                if cfg.get("version")!=job["modelVersion"]:
                    raise ValueError("识图模型配置已变更，请使用新配置重试。")
                aids=set(job["spec"]["assetIds"])
                assets=[a for a in self.store.assets(job["projectId"]) if a["id"] in aids]
                result=self.run_analysis(job,cfg,assets)
                self.store.set_outcome(job["id"],plan=result)
            except (ProviderError,ValueError) as e:
                self.store.set_outcome(job["id"],error=str(e))
            except Exception:
                # No raw provider errors or upload data in logs.
                self.store.set_outcome(job["id"],error="分析中断，请检查服务状态后重试。")

class Handler(BaseHTTPRequestHandler):
    server_version="UIStudio"
    protocol_version="HTTP/1.0"
    def log_message(self, *_):pass

    @property
    def app(self):
        return self.server.studio
    @property
    def store(self):
        return self.app.store

    def session_ok(self):
        if not self.app.password:
            return self.app.local_dev and self.client_address[0] in {"127.0.0.1","::1"} and bool(re.fullmatch(r"(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?",self.headers.get("Host",""))) and not any(self.headers.get(h) for h in ("Forwarded","X-Forwarded-For","X-Forwarded-Host"))
        parts=self.headers.get("Authorization","").split(" ",1)
        if len(parts)!=2 or parts[0].lower()!="basic":return False
        try:
            pair=base64.b64decode(parts[1],validate=True).decode("utf-8")
        except (ValueError,UnicodeDecodeError):return False
        return hmac.compare_digest(pair.encode(),("studio:"+self.app.password).encode())

    def write(self,n,data,mime,extra=()):
        self.send_response(n)
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for k,v in extra:self.send_header(k,v)
        self.end_headers()
        self.wfile.write(data)

    def json(self,value,status=200,extra=()):
        self.write(status,json.dumps(value,ensure_ascii=False).encode(),"application/json; charset=utf-8",extra)

    def body(self):
        if self.headers.get_content_type()!="application/json":
            raise AppError("只接受 JSON 请求。",415)
        supplied_origin=self.headers.get("Origin")
        if supplied_origin:
            if self.app.site_origin:
                accepted={self.app.site_origin}
            else:
                host=self.headers.get("Host","")
                accepted={"http://"+host}
            if supplied_origin not in accepted:raise AppError("请求来源不符。",403)
        try:n=int(self.headers.get("Content-Length",""))
        except ValueError:raise AppError("请求长度无效。") from None
        if n<=0 or n>BODY_LIMIT:raise AppError("请求为空或超过上传限制。",413)
        self.connection.settimeout(45)
        try:body=json.loads(self.rfile.read(n))
        except (json.JSONDecodeError,UnicodeDecodeError):raise AppError("JSON 格式无效。") from None
        if not isinstance(body,dict):raise AppError("应传入 JSON 对象。")
        return body

    def do_GET(self): self.dispatch("GET")
    def do_POST(self): self.dispatch("POST")

    def dispatch(self,method):
        if not self.session_ok():
            self.json({"error":"请先登录工作台。"},401,[("WWW-Authenticate",'Basic realm="UI Studio", charset="UTF-8"')])
            return
        try:
            path=urlsplit(self.path).path
            self.routes(method,path)
        except AppError as e:self.json({"error":str(e)},e.status)
        except (ProviderError,ValueError) as e:self.json({"error":str(e)},400)
        except KeyError:self.json({"error":"未找到该项目、任务或资源。"},404)
        except (BrokenPipeError,ConnectionResetError):return
        except Exception:self.json({"error":"服务器暂未完成请求。"},500)

    def routes(self,method,path):
        if method=="GET" and path in STATIC:
            fname,mime=STATIC[path]
            return self.write(200,(WEB/fname).read_bytes(),mime)
        if method=="GET" and path=="/api/settings":
            return self.json(self.store.settings())
        if method=="POST" and path in {"/api/settings/models","/api/settings/default"}:
            b=self.body()
            url,key=self.app.settings_credentials(b)
            if path.endswith("/models"):return self.json({"models":list_models(url,key)})
            model=clean_name(b.get("model"),200)
            with self.app.probe_lock:
                if time.monotonic()<self.app.probe_next:
                    raise AppError("模型验证请求过于频繁，请稍后重试。",429)
                self.app.probe_next=time.monotonic()+2
                result=probe_vision(url,key,model)
                if not (result.get("vision") is True and result.get("ok") is True):
                    raise AppError("模型未通过真实识图验证。")
                self.store.set_model(url,key,model)
            return self.json(self.store.settings())
        if path=="/api/projects":
            if method=="GET":return self.json({"projects":self.store.projects()})
            return self.json(self.store.create_project(self.body().get("name")),201)
        m=re.fullmatch(f"/api/projects/({ID})(?:/(jobs|export\\.zip|assets(?:/{ID})?))?",path)
        if m:
            pid,action=m.groups()
            p=self.store.project(pid)
            if not action and method=="GET":
                return self.json({"project":p,"assets":self.store.assets(pid),"jobs":self.store.project_jobs(pid)})
            if action and action.startswith("assets/") and method=="GET":
                mime,data=self.store.asset_bytes(pid,action.split("/")[1])
                return self.write(200,data,mime)
            if action=="jobs" and method=="POST":
                b=self.body()
                cfg=self.store.settings(private=True)
                if not cfg["configured"]:raise AppError("请先在设置中验证并启用识图模型。",409)
                ref=b.get("reference")
                raw=parse_files(b.get("files")) if b.get("files") else []
                references=parse_files([ref]) if ref else []
                if references and (len(references)!=1 or references[0]["kind"]!="image" or not isinstance(ref,dict)
                                   or not re.search(r"\.(png|jpe?g|webp)$",ref["name"],re.I)):
                    raise ValueError("参考图必须是一张 PNG、JPEG 或 WebP。")
                if not any(a["kind"]=="image" for a in raw) and not references:
                    raise ValueError("至少上传一张图片用于识图。")
                ref=references[0] if references else None
                w,h=requested_dimension(b.get("width")),requested_dimension(b.get("height"))
                if (w is None)!=(h is None):raise ValueError("画布宽与高应同时填写，或留空。")
                if ref and not w:w,h=ref["width"],ref["height"]
                job=self.store.submit(pid,b.get("name"),raw,ref,w,h,cfg["version"])
                self.app.worker_wake.set()
                return self.json(job,202)
            if action=="export.zip" and method=="GET":
                return self.export(p,[j for j in self.store.project_jobs(pid) if j["status"]=="approved"],"project")
        m=re.fullmatch(f"/api/jobs/({ID})(?:/(retry|approve|revisions|reference|export\\.zip))?",path)
        if m:
            jid,action=m.groups()
            job=self.store.job(jid)
            if not action and method=="GET":return self.json(job)
            if action=="reference" and method=="GET":
                return self.write(200,self.store.reference(jid),"image/png")
            if action=="revisions" and method=="GET":return self.json({"revisions":self.store.revisions(jid)})
            if action=="retry" and method=="POST":
                self.body()
                cfg=self.store.settings(private=True)
                if not cfg["configured"]:raise AppError("请先配置识图模型。",409)
                result=self.store.retry(jid,cfg["version"])
                self.app.worker_wake.set()
                return self.json(result,202)
            if action=="approve" and method=="POST":
                b=self.body()
                plan_status=job.get("plan") or {}
                a=self.store.assets(job["projectId"])
                plan=wire_plan(b.get("plan"),a,plan_status.get("width"),plan_status.get("height"))
                unresolved=[x for x in plan["issues"] if x.get("severity")=="error"]
                if unresolved:raise AppError("还有阻塞问题；补素材、修订方案或确认替代方式后再导出。",409)
                return self.json(self.store.approve(jid,plan))
            if action=="export.zip" and method=="GET" and job["status"]=="approved":
                return self.export(self.store.project(job["projectId"]),[job],"interface")
        raise KeyError

    def export(self,project,jobs,mode):
        if not jobs:raise AppError("请先确认至少一个界面。",409)
        try:from export_cocos import build_zip
        except ImportError:raise AppError("Cocos 导出阶段尚未安装。",501) from None
        pid=project["id"]
        assets={a["id"]:a for a in self.store.assets(pid)}
        data=build_zip(project,jobs,assets,lambda aid:self.store.asset_bytes(pid,aid)[1],include_all_assets=(mode=="project"))
        return self.write(200,data,"application/zip",[("Content-Disposition",f'attachment; filename="ui-studio-{mode}.zip"')])

def serve():
    host=os.environ.get("F2_HOST","127.0.0.1")
    port=int(os.environ.get("F2_PORT","8765"))
    a=Studio(os.environ.get("F2_DATA_DIR","./studio-data"))
    if a.local_dev:
        if host not in {"localhost","127.0.0.1"}:
            sys.exit("F2_DEV_LOCAL=1 is loopback-only; never put it behind a reverse proxy.")
    else:
        origin=urlsplit(a.site_origin)
        if len(a.password)<16 or origin.scheme!="https" or not origin.hostname or origin.path or origin.username or origin.query or origin.fragment:
            sys.exit("Company mode requires F2_WORKSPACE_PASSWORD (16+ chars) and a complete HTTPS F2_SITE_ORIGIN.")
    server=ThreadingHTTPServer((host,port),Handler)
    server.studio=a
    a.start()
    print(f"UI Studio listening on {host}:{port}",flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        a.worker_stop.set();a.worker_wake.set();server.server_close()

if __name__=="__main__":serve()
