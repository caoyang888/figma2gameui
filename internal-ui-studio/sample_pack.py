"""Generate a tiny wholly synthetic two-screen Creator fixture without any AI or company assets."""
from io import BytesIO
from pathlib import Path
import sys
from PIL import Image, ImageDraw

from export_cocos import build_zip
from plan import validate_plan

def create_sample():
    image=Image.new("RGBA",(64,64),(0,0,0,0))
    pen=ImageDraw.Draw(image)
    pen.rounded_rectangle((7,7,56,56),radius=10,fill=(57,157,163,255))
    pen.polygon([(15,31),(31,15),(48,31),(31,48)],fill=(244,236,188,255))
    scratch=BytesIO()
    image.save(scratch,"PNG")
    shared=scratch.getvalue()
    project={"id":"synthetic-project","name":"合成样例","cocosVersion":"3.8.8"}
    assets={"signal":{"id":"signal","name":"信标","kind":"image","mime":"image/png",
                     "width":64,"height":64,"bundle":"common","path":"textures/signal.png",
                     "uuid":"c8f2ec83-3d43-4331-ab4b-5fab33db1234"}}
    def node(i,parent,kind,name,x,y,w,h,**fields):
        return dict(id=i,parentId=parent,kind=kind,name=name,x=x,y=y,width=w,height=h,**fields)
    def plan(value):
        return validate_plan({"width":360,"height":640,"nodes":[
            node("root",None,"container","信标面板",0,0,360,640),
            node("list","root","layout","状态列表",40,95,280,300,direction="vertical",gap=12),
            node("title","list","label","标题",74,103,212,46,text=value,align="center"),
            node("status","list","label","动态数据",74,161,212,40,text="128.0",align="center"),
            node("button","root","button","确认触摸区",120,430,120,82),
            node("mark","button","sprite","信标显示",148,439,64,64,assetId="signal")
        ],"issues":[]},set(assets))
    jobs=[{"id":"receiver","name":"接收器","plan":plan("信标接收器")},
          {"id":"sender","name":"发射器","plan":plan("信标发射器")}]
    return build_zip(project,jobs,assets,lambda aid:shared,include_all_assets=True)

if __name__=="__main__":
    if len(sys.argv)!=2:raise SystemExit("用法：python3 sample_pack.py /path/to/sample.zip")
    path=Path(sys.argv[1])
    path.write_bytes(create_sample())
    print(path)
