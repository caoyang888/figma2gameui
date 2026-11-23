"""Single-volume SQLite store. All asset identities are scoped to a project."""
import hashlib
import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet

SCHEMA = """
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
"""

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

def clean_name(s, n=80):
    if not isinstance(s,str) or not s.strip() or len(s.strip())>n or any(ord(c)<32 for c in s):
        raise ValueError(f"请填写 1–{n} 字的有效名称。")
    return s.strip()

def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:36] or "asset"

def analysis_fingerprint(name,spec,model_version):
    return hashlib.sha256(json.dumps([name,spec,model_version],sort_keys=True).encode()).hexdigest()

def new_id():
    return uuid.uuid4().hex

class Store:
    def __init__(self, root):
        self.root=Path(root)
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        secret=self.root/"settings.key"
        try:
            fd=os.open(secret,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,"wb") as f:
                f.write(Fernet.generate_key())
        except FileExistsError:
            pass
        self.crypto=Fernet(secret.read_bytes())
        self.path=self.root/"studio.sqlite"
        with self.db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)

    @contextmanager
    def db(self):
        db=sqlite3.connect(self.path,timeout=15)
        db.row_factory=sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def project_row(row):
        if not row: raise KeyError
        return {"id":row["id"],"name":row["name"],"createdAt":row["created"],
                "cocosVersion":"3.8.8","bundles":["common","gameResource"]}

    def project(self, pid):
        with self.db() as d:
            return self.project_row(d.execute("SELECT * FROM projects WHERE id=?",(pid,)).fetchone())

    def projects(self):
        with self.db() as d:
            return [self.project_row(r) for r in d.execute("SELECT * FROM projects ORDER BY created DESC")]

    def create_project(self,name):
        pid=new_id()
        with self.db() as d:
            d.execute("INSERT INTO projects VALUES(?,?,?)",(pid,clean_name(name),stamp()))
        return self.project(pid)

    def _asset(self,d,pid,a):
        row=d.execute("SELECT id FROM assets WHERE project=? AND kind=? AND pixel_hash=?",
                      (pid,a["kind"],a["pixel_hash"])).fetchone()
        if row:
            aid=row["id"]
        else:
            aid=new_id()
            bundle="common" if a["kind"]=="font" else "gameResource"
            folder="fonts" if a["kind"]=="font" else "textures"
            ext=Path(a["name"]).suffix.lower() if a["kind"]=="font" else ".png"
            path=f"{folder}/{slug(Path(a['name']).stem)}-{a['pixel_hash'][:12]}{ext}"
            d.execute("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (aid,pid,a["name"],a["mime"],a["kind"],a["width"],a["height"],a["pixel_hash"],
                      str(uuid.uuid4()),bundle,path,a["data"],stamp()))
        d.execute("INSERT OR IGNORE INTO aliases VALUES(?,?,?)",(aid,a["name"],a["file_hash"]))
        return aid

    def assets(self,pid):
        with self.db() as d:
            rows=d.execute("""SELECT id,name,mime,kind,width,height,uuid,bundle,path,
                       pixel_hash AS pixelHash FROM assets WHERE project=? ORDER BY name,id""",(pid,)).fetchall()
            result=[]
            for r in rows:
                a=dict(r)
                a["aliases"]=[x[0] for x in d.execute("SELECT DISTINCT name FROM aliases WHERE asset=? ORDER BY name",(a["id"],))]
                a["tags"]=[x[0] for x in d.execute("SELECT DISTINCT label FROM asset_usage WHERE asset=? ORDER BY label LIMIT 30",(a["id"],))]
                a["usedBy"]=[x[0] for x in d.execute("SELECT DISTINCT job FROM asset_usage WHERE asset=? ORDER BY job",(a["id"],))]
                result.append(a)
            return result

    def asset_bytes(self,pid,aid):
        with self.db() as d:
            row=d.execute("SELECT mime,data FROM assets WHERE project=? AND id=?",(pid,aid)).fetchone()
        if not row:raise KeyError
        return row["mime"],row["data"]

    def set_model(self,url,key,model):
        with self.db() as d:
            d.execute("""INSERT INTO settings VALUES(1,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET url=excluded.url,key=excluded.key,
                    model=excluded.model,verified=excluded.verified,version=excluded.version""",
                    (url,self.crypto.encrypt(key.encode()),model,stamp(),new_id()))

    def settings(self, private=False):
        with self.db() as d:
            row=d.execute("SELECT * FROM settings WHERE id=1").fetchone()
        if not row:return {"configured":False,"baseUrl":"","model":"","verifiedAt":None}
        result={"configured":True,"baseUrl":row["url"],"model":row["model"],"verifiedAt":row["verified"]}
        if private:
            result.update(key=self.crypto.decrypt(row["key"]).decode(),version=row["version"])
        return result

    def submit(self,pid,name,raw_assets,reference,width,height,model_version):
        self.project(pid)
        name=clean_name(name)
        with self.db() as d:
            d.execute("BEGIN IMMEDIATE")
            aids=sorted(set(self._asset(d,pid,a) for a in raw_assets))
            spec={"assetIds":aids,"width":width,"height":height,
                  "referenceMime":reference["mime"] if reference else None,
                  "referenceDigest":reference["pixel_hash"] if reference else None}
            fingerprint=analysis_fingerprint(name,spec,model_version)
            prior=d.execute("SELECT id FROM jobs WHERE project=? AND fingerprint=? ORDER BY created DESC LIMIT 1",(pid,fingerprint)).fetchone()
            if prior: jid=prior["id"]
            else:
                jid=new_id()
                d.execute("""INSERT INTO jobs(id,project,name,status,fingerprint,model_version,spec,reference,created,updated)
                             VALUES(?,?,?,'queued',?,?,?,?,?,?)""",
                          (jid,pid,name,fingerprint,model_version,json.dumps(spec),reference["data"] if reference else None,stamp(),stamp()))
        return self.job(jid)

    @staticmethod
    def job_row(r):
        if not r:raise KeyError
        return {"id":r["id"],"projectId":r["project"],"name":r["name"],"status":r["status"],
                "plan":json.loads(r["plan"]) if r["plan"] is not None else None,
                "error":r["error"],"hasReference":bool(r["has_reference"]),"createdAt":r["created"],"updatedAt":r["updated"],"attempt":r["attempt"]}

    def job(self,jid):
        with self.db() as d:
            return self.job_row(d.execute("SELECT id,project,name,status,plan,error,created,updated,attempt,reference IS NOT NULL AS has_reference FROM jobs WHERE id=?",(jid,)).fetchone())

    def reference(self,jid):
        with self.db() as d:
            r=d.execute("SELECT reference FROM jobs WHERE id=?",(jid,)).fetchone()
        if not r or r[0] is None:raise KeyError
        return r[0]

    def project_jobs(self,pid):
        with self.db() as d:
            return [self.job_row(r) for r in d.execute("SELECT id,project,name,status,plan,error,created,updated,attempt,reference IS NOT NULL AS has_reference FROM jobs WHERE project=? ORDER BY created DESC",(pid,))]

    def recent_tasks(self):
        with self.db() as d:
            rows=d.execute("""SELECT j.id,j.project,j.name,j.status,j.error,j.updated,p.name AS projectName
                    FROM jobs j JOIN projects p ON j.project=p.id
                    ORDER BY j.updated DESC,j.id LIMIT 100""").fetchall()
        return [{"id":r["id"],"projectId":r["project"],"projectName":r["projectName"],"name":r["name"],
                 "status":r["status"],"updatedAt":r["updated"]} for r in rows]

    def reset_interrupted(self):
        with self.db() as d:
            d.execute("""UPDATE jobs SET status='failed',error=?,updated=? WHERE status='running'""",
                      ("服务重启中断了分析，可重试。",stamp()))

    def next_job(self):
        with self.db() as d:
            d.execute("BEGIN IMMEDIATE")
            row=d.execute("SELECT *,reference IS NOT NULL AS has_reference FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if not row: return None
            d.execute("UPDATE jobs SET status='running',attempt=attempt+1,updated=? WHERE id=?",(stamp(),row["id"]))
            result=self.job_row(row)
            result.update(spec=json.loads(row["spec"]),reference=row["reference"],modelVersion=row["model_version"])
            return result

    def set_outcome(self,jid,plan=None,error=None):
        with self.db() as d:
            now=stamp()
            raw=json.dumps(plan,ensure_ascii=False) if plan else None
            status="review" if plan else "failed"
            result=d.execute("UPDATE jobs SET status=?,plan=?,error=?,updated=? WHERE id=? AND status='running'",
                             (status,raw,error,now,jid))
            if raw and result.rowcount: d.execute("INSERT INTO revisions VALUES(?,?,?,?)",(jid,now,status,raw))

    def job_asset_ids(self,jid):
        with self.db() as d:
            r=d.execute("SELECT spec FROM jobs WHERE id=?",(jid,)).fetchone()
        if not r:raise KeyError
        return set(json.loads(r[0])["assetIds"])

    def revisions(self,jid):
        self.job(jid)
        with self.db() as d:
            return [{"createdAt":r[0],"status":r[1],"plan":json.loads(r[2])} for r in
                    d.execute("SELECT created,status,plan FROM revisions WHERE job=? ORDER BY created DESC",(jid,))]

    def retry(self,jid,model_version):
        with self.db() as d:
            d.execute("BEGIN IMMEDIATE")
            row=d.execute("SELECT name,spec,project,status FROM jobs WHERE id=?",(jid,)).fetchone()
            if not row or row["status"]!="failed":raise ValueError("只能重试失败的任务。")
            fp=analysis_fingerprint(row["name"],json.loads(row["spec"]),model_version)
            prior=d.execute("SELECT id FROM jobs WHERE project=? AND fingerprint=? AND id<>? AND status<>'failed' ORDER BY created DESC LIMIT 1",(row["project"],fp,jid)).fetchone()
            if prior:
                winner=prior["id"]
            else:
                winner=jid
                d.execute("UPDATE jobs SET status='queued',model_version=?,fingerprint=?,error=NULL,updated=? WHERE id=?",
                          (model_version,fp,stamp(),jid))
        return self.job(winner)

    def approve(self,jid,plan):
        raw=json.dumps(plan,ensure_ascii=False)
        with self.db() as d:
            now=stamp()
            updated=d.execute("UPDATE jobs SET status='approved',plan=?,error=NULL,updated=? WHERE id=? AND status='review'",
                              (raw,now,jid))
            if not updated.rowcount:raise ValueError("任务尚不可确认。")
            d.execute("INSERT INTO revisions VALUES(?,?,?,?)",(jid,now,"approved",raw))
            d.execute("DELETE FROM asset_usage WHERE job=?",(jid,))
            for node in plan["nodes"]:
                for aid in (node.get("assetId"),node.get("fontAssetId")):
                    if aid:
                        d.execute("INSERT OR IGNORE INTO asset_usage VALUES(?,?,?)",(aid,jid,node["name"]))
        return self.job(jid)
