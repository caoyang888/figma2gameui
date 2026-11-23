import base64, json, tempfile, threading, time, unittest
from io import BytesIO
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from PIL import Image
from app import Handler, Studio, ThreadingHTTPServer
from provider import ProviderError

def png(w=12,h=12,level=1):
    f=BytesIO()
    Image.new("RGBA",(w,h),(73,169,158,255)).save(f,format="PNG",compress_level=level)
    return base64.b64encode(f.getvalue()).decode()

def produce(_url,_key,_model,images,context):
    w,h=context["width"] or 360,context["height"] or 600
    return {"width":w,"height":h,"nodes":[
        {"id":"root","kind":"container","name":"界面","parentId":None,"x":0,"y":0,"width":w,"height":h},
        {"id":"image","kind":"sprite","name":"图标","parentId":"root","x":2,"y":2,"width":10,"height":10,
         "assetId":next(a["id"] for a in context["assets"] if a["kind"]=="image")}
    ],"issues":[]}

class TestStudio(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.app=Studio(self.tmp.name)
        self.app.password="a-workspace-pass-for-unit-tests"
        self.server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        self.server.studio=self.app
        self.app.start()
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.app.worker_stop.set()
        self.app.worker_wake.set()
        self.server.shutdown()
        self.server.server_close()
        self.app.thread.join(10)
        self.thread.join(2)
        self.tmp.cleanup()

    def req(self,path,body=None,auth=True,origin=None):
        headers={}
        if auth:
            headers["Authorization"]="Basic "+base64.b64encode(("studio:"+self.app.password).encode()).decode()
        if body is not None:headers["Content-Type"]="application/json"
        if origin:headers["Origin"]=origin
        r=Request("http://127.0.0.1:"+str(self.server.server_port)+path,
                  None if body is None else json.dumps(body).encode(),headers=headers)
        try:res=urlopen(r,timeout=3)
        except HTTPError as e:res=e
        with res:
            raw=res.read()
            return res.status,json.loads(raw) if res.headers.get_content_type()=="application/json" else raw

    def wait(self,jid,status):
        for _ in range(40):
            data=self.req("/api/jobs/"+jid)[1]
            if data["status"]==status:return data
            time.sleep(.05)
        self.fail(data)

    @patch("app.list_models",return_value=["vision-id","text-id"])
    @patch("app.probe_vision")
    def test_listing_is_not_activation_and_bad_switch_keeps_last_model(self,probe,models):
        base={"baseUrl":"https://example.invalid/v1","apiKey":"test-secret"}
        self.assertEqual(self.req("/api/settings",auth=False)[0],401)
        self.assertEqual(self.req("/api/settings/models",base),(200,{"models":["vision-id","text-id"]}))
        self.assertFalse(self.req("/api/settings")[1]["configured"])
        probe.return_value={"ok":True,"vision":True}
        code,public=self.req("/api/settings/default",{**base,"model":"vision-id"})
        self.assertEqual(code,200)
        self.assertNotIn("test-secret",json.dumps(public))
        self.assertNotIn(b"test-secret",self.app.store.path.read_bytes())
        self.app.probe_next=0
        probe.side_effect=ProviderError("vision_not_verified")
        self.assertEqual(self.req("/api/settings/default",{**base,"model":"text-id"})[0],400)
        self.assertEqual(self.req("/api/settings")[1]["model"],"vision-id")
        self.assertEqual(probe.call_count,2)
        self.assertEqual(models.call_count,1)
        self.assertEqual(self.req("/api/projects",{"name":"不应创建"},origin="https://other.invalid")[0],403)

    @patch("app.analyze",side_effect=produce)
    def test_submit_reuse_review_and_stable_assets(self,analyzer):
        self.app.store.set_model("https://example.invalid/v1","test-key","vision")
        pid=self.req("/api/projects",{"name":"同一项目"})[1]["id"]
        p="/api/projects/"+pid
        body={"name":"第一界面","files":[{"name":"art.png","content":png()}],
              "reference":{"name":"preview.PNG","content":png(80,90)}}
        status,job=self.req(p+"/jobs",body)
        self.assertEqual(status,202,job)
        jid=job["id"]
        result=self.wait(jid,"review")
        self.assertEqual(result["plan"]["width"],80)
        self.assertEqual(result["plan"]["height"],90)
        self.assertTrue(result["hasReference"])
        self.assertEqual(self.req(f"/api/jobs/{jid}/reference")[1][:8],b"\x89PNG\r\n\x1a\n")
        assert analyzer.call_args.args[3][0]["id"]=="reference"
        self.assertEqual(self.req(p+"/jobs",{**body,"files":[{"name":"alias.png","content":png(level=9)}]})[1]["id"],jid)
        assets=self.req(p)[1]["assets"]
        self.assertEqual(len(assets),1)
        self.assertEqual(set(assets[0]["aliases"]),{"art.png","alias.png"})
        self.assertEqual(analyzer.call_count,1)
        self.assertEqual(self.req("/api/jobs/"+jid+"/approve",{"plan":result["plan"]})[0],200)
        self.assertEqual(len(self.req("/api/jobs/"+jid+"/revisions")[1]["revisions"]),2)
        recent=self.req("/api/jobs")[1]["jobs"]
        self.assertEqual((recent[0]["id"],recent[0]["projectId"],recent[0]["status"]),(jid,pid,"approved"))
        self.assertNotIn("plan",recent[0])
        self.assertEqual(self.req("/api/jobs/"+jid+"/approve",{"plan":result["plan"]})[0],400)
        self.assertEqual(self.req(p)[1]["assets"][0]["tags"],["图标"])
        other=self.req(p+"/jobs",{**body,"name":"第二界面","files":[{"name":"letter.png","content":png(13,12)}]})[1]
        self.wait(other["id"],"review")
        self.assertEqual(len(self.req(p)[1]["assets"]),2)
        self.assertEqual(self.req("/api/projects/"+("f"*32)+"/assets/"+assets[0]["id"])[0],404)
        self.assertEqual(self.req(p+"/assets/"+assets[0]["id"])[1][:8],b"\x89PNG\r\n\x1a\n")

    @patch("app.analyze",side_effect=[ProviderError("vision_not_verified"),])
    def test_analysis_retry_does_not_duplicate_job(self,analyzer):
        self.app.store.set_model("https://example.invalid/v1","test-key","vision")
        pid=self.req("/api/projects",{"name":"可重试项目"})[1]["id"]
        jid=self.req(f"/api/projects/{pid}/jobs",{"name":"重试用","files":[{"name":"one.png","content":png()}]})[1]["id"]
        self.wait(jid,"failed")
        analyzer.side_effect=produce
        self.assertEqual(self.req(f"/api/jobs/{jid}/retry",{})[0],202)
        result=self.wait(jid,"review")
        self.assertEqual(result["attempt"],2)

if __name__=="__main__":unittest.main()
