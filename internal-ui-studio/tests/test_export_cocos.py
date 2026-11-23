import io
import json
import unittest
import zipfile
from copy import deepcopy

from PIL import Image

from export_cocos import build_zip
from plan import validate_plan


def png(w=8,h=9):
    out = io.BytesIO()
    Image.new("RGBA",(w,h),(255,0,0,120)).save(out,format="PNG")
    return out.getvalue()


def read_zip(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        assert z.testzip() is None
        return {x:z.read(x) for x in z.namelist()}


def node(id,kind,x,y,width,height,parentId=None,**kw):
    return dict(id=id,name=id,kind=kind,parentId=parentId,x=x,y=y,width=width,height=height,**kw)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.project = {"id":"p-01","name":"项目","cocosVersion":"3.8.8"}
        self.assets = {
            "pic":dict(id="pic",name="切图",mime="image/png",kind="image",width=8,height=9,bundle="gameResource",
                       path="textures/btn-123abc.png",uuid="d555c38c-494c-4346-8763-f392f4bc9ae6"),
            "font":dict(id="font",name="字体",mime="font/ttf",kind="font",bundle="common",
                        path="fonts/text-aaabcd.ttf",uuid="d0fd1d9f-09cd-4e50-a116-24e7ab30397e"),
        }
        # Export only checks the signature, after a separate importer validated TTF.
        self.blobs = {"pic":png(),"font":b"\x00\x01\x00\x00\x00\x01"+b"\0"*20}
        self.plan = validate_plan({
            "width":320,"height":640,"issues":[{"message":"确认原界面","severity":"info"}],
            "nodes":[
                node("root","container",0,0,320,640),
                node("content","layout",20,100,200,300,"root",direction="vertical",gap=8),
                node("cta","button",30,120,80,60,"content",assetId="pic"),
                node("message","label",35,181,.5,.25,"content",text="中文",fontAssetId="font",align="bottom-right"),
                node("teaser","sprite",15,13,40,36,"root",assetId="pic"),
            ]},set(self.assets))
        self.jobs = [{"id":"screen1","name":"登录","plan":self.plan},{"id":"screen2","name":"大厅","plan":self.plan}]

    def export(self,jobs=None):
        return build_zip(self.project,self.jobs if jobs is None else jobs,self.assets,self.blobs.__getitem__)

    def test_deterministic_shared_bundle_assets_and_one_screen_reexport(self):
        full = self.export()
        self.assertEqual(full,self.export())
        self.assertEqual(full,self.export(list(reversed(self.jobs))))
        joined, single = read_zip(full),read_zip(self.export([self.jobs[0]]))
        manifest = json.loads(joined["manifest.json"])
        self.assertEqual(2,len(manifest["screens"]))
        self.assertEqual(2,len(manifest["assets"]))
        for name,data in single.items():
            if name!="manifest.json":
                self.assertEqual(joined[name],data)
        for each in manifest["bundles"]:
            m = json.loads(joined[each["path"]+".meta"])
            self.assertEqual(m["userData"],dict(isBundle=True,bundleName=each["cocosBundle"],isRemoteBundle=False))
        for a in manifest["assets"]:
            self.assertTrue(a["path"].endswith(self.assets[a["id"]]["path"]))
            self.assertEqual(joined[a["path"]],self.blobs[a["id"]])
            self.assertEqual(json.loads(joined[a["path"]+".meta"])["uuid"],self.assets[a["id"]]["uuid"])
        self.assertEqual(manifest["screens"][0]["reviewIssues"],self.plan["issues"])

    def test_real_serialized_component_refs_transforms_and_uuid_closure(self):
        z = read_zip(self.export())
        manifest=json.loads(z["manifest.json"])
        idx = {a["id"]:a for a in manifest["assets"]}
        for screen in manifest["screens"]:
            rows=json.loads(z[screen["path"]])
            node_by_name={x["_name"]:x for x in rows if x["__type__"]=="cc.Node"}
            self.assertEqual(rows[0]["data"],{"__id__":1})
            self.assertEqual(rows[rows[1]["_prefab"]["__id__"]]["asset"],{"__id__":0})
            self.assertEqual(node_by_name["cta"]["_lpos"],{"__type__":"cc.Vec3","x":-50.0,"y":100.0,"z":0})
            by_type={x["__type__"]:x for x in rows}
            self.assertEqual(by_type["cc.Label"]["_string"],"中文")
            self.assertEqual((by_type["cc.Label"]["_horizontalAlign"],by_type["cc.Label"]["_verticalAlign"]),(2,2))
            label_node=node_by_name["message"]
            transform=rows[label_node["_components"][0]["__id__"]]
            self.assertEqual((transform["_contentSize"]["width"],transform["_contentSize"]["height"]),(.5,.25))
            self.assertEqual(by_type["cc.Label"]["_font"]["__uuid__"],idx["font"]["uuid"])
            self.assertEqual(by_type["cc.Sprite"]["_spriteFrame"]["__uuid__"],idx["pic"]["spriteFrameUuid"])
            self.assertEqual(by_type["cc.Sprite"]["_sizeMode"],0)
            self.assertEqual(by_type["cc.Button"]["clickEvents"],[])
            self.assertEqual(by_type["cc.Layout"]["_paddingTop"],20)
            self.assertEqual(by_type["cc.Layout"]["_spacingY"],8)
            file_ids=[x["fileId"] for x in rows if "fileId" in x]
            self.assertEqual(len(set(file_ids)),len(file_ids))
            self.assertTrue(all(len(x)==22 for x in file_ids))
            for r in rows:
                for key in ("node","_parent","__prefab","_prefab"):
                    if isinstance(r.get(key),dict):
                        self.assertLess(r[key]["__id__"],len(rows))
            imeta=json.loads(z[idx["pic"]["path"]+".meta"])
            self.assertEqual(imeta["subMetas"]["f9941"]["uuid"],idx["pic"]["spriteFrameUuid"])
            self.assertEqual(imeta["subMetas"]["f9941"]["userData"]["imageUuidOrDatabaseUri"],imeta["subMetas"]["6c48a"]["uuid"])

    def test_stale_wrong_mimetype_traversal_and_uuid_collisions_fail_loudly(self):
        original = deepcopy(self.assets)
        del self.assets["pic"]
        with self.assertRaisesRegex(ValueError,"缺失资源"):
            self.export()
        self.assets = deepcopy(original)
        self.assets["font"]["mime"]="font/otf"
        with self.assertRaisesRegex(ValueError,"TTF"):
            self.export()
        self.assets = deepcopy(original)
        self.assets["pic"]["path"]="textures/../../outside.png"
        with self.assertRaisesRegex(ValueError,"路径无效"):
            self.export()
        self.assets = deepcopy(original)
        self.assets["pic"]["uuid"]=self.assets["font"]["uuid"]
        with self.assertRaisesRegex(ValueError,"UUID 冲突"):
            self.export()
        self.assets = original
        del self.blobs["pic"]
        with self.assertRaisesRegex(ValueError,"无法读取资源"):
            self.export()

    def test_nontext_storage_path_not_used_and_only_selected_bytes_read(self):
        self.assets["pic"].pop("path")
        self.assets["unused"]={"path":"/sensitive/path","id":"unused"}
        accessed=[]
        def get(aid):
            accessed.append(aid)
            return self.blobs[aid]
        z = read_zip(build_zip(self.project,self.jobs,self.assets,get))
        self.assertCountEqual(accessed,["pic","font"])
        self.assertFalse(any("unused" in x for x in z))
        self.assertTrue(any(x.endswith("asset-"+self.assets["pic"]["uuid"]+".png") for x in z))

    def test_cycle_and_bad_canvas_abort(self):
        self.jobs[0]["plan"]=deepcopy(self.plan)
        self.jobs[0]["plan"]["nodes"][0]["parentId"]="content"
        with self.assertRaisesRegex(ValueError,"循环"):
            self.export()
        self.jobs[0]["plan"]["height"]=0
        with self.assertRaisesRegex(ValueError,"画板"):
            self.export()


if __name__=="__main__":
    unittest.main()
