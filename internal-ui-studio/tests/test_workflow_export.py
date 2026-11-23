"""From submitted images to reviewed single and whole packages over HTTP, no remote AI."""
import json
import unittest
import zipfile
from io import BytesIO
from unittest.mock import patch

import test_app as helpers

# Reuse the HTTP harness, not its independent test cases.
class WorkflowExport(unittest.TestCase):
    setUp=helpers.TestStudio.setUp
    tearDown=helpers.TestStudio.tearDown
    req=helpers.TestStudio.req
    wait=helpers.TestStudio.wait

    @patch("app.analyze",side_effect=helpers.produce)
    def test_shared_assets_exact_closure_and_full_project_resources(self,analyze):
        self.app.store.set_model("https://example.invalid/v1","test-key","vision")
        pid=self.req("/api/projects",{"name":"跨界面共享资源"})[1]["id"]
        p="/api/projects/"+pid
        ids=[]
        for i in (1,2):
            body={"name":f"界面 {i}","width":100,"height":180,
                  "files":[{"name":f"shared-{i}.png","content":helpers.png(level=i)}]}
            code, data=self.req(p+"/jobs",body)
            self.assertEqual(code,202,data)
            job=self.wait(data["id"],"review")
            self.assertEqual(self.req("/api/jobs/"+job["id"]+"/approve",{"plan":job["plan"]})[0],200)
            ids.append(job["id"])
        other=self.req(p+"/jobs",{"name":"尚未批准的第三界面","files":[{"name":"other.png","content":helpers.png(w=15)}]})[1]
        self.wait(other["id"],"review")
        self.assertEqual(self.req("/api/jobs/"+other["id"]+"/export.zip")[0],404)
        st,j1=self.req("/api/jobs/"+ids[0]+"/export.zip")
        self.assertEqual(st,200)
        st,whole=self.req(p+"/export.zip")
        self.assertEqual(st,200)
        self.assertEqual(self.req(p+"/export.zip")[1],whole)
        with zipfile.ZipFile(BytesIO(j1)) as one, zipfile.ZipFile(BytesIO(whole)) as all_:
            m=json.loads(all_.read("manifest.json"))
            n=json.loads(one.read("manifest.json"))
            self.assertEqual((len(m["screens"]),len(m["assets"])),(2,2))
            self.assertEqual((len(n["screens"]),len(n["assets"])),(1,1))
            shared=n["assets"][0]
            self.assertIn(shared,m["assets"])
            self.assertEqual(one.read(shared["path"]+".meta"),all_.read(shared["path"]+".meta"))
            for screen in m["screens"]:
                prefab=json.loads(all_.read(screen["path"]))
                self.assertTrue(any(x.get("_spriteFrame",{}).get("__uuid__")==shared["spriteFrameUuid"]
                                    for x in prefab if isinstance(x.get("_spriteFrame"),dict)))

if __name__=="__main__":unittest.main()
