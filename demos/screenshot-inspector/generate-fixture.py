#!/usr/bin/env python3
"""Generate a completely synthetic prototype dataset. Uses only Python stdlib."""
import base64, binascii, json, hashlib, struct, zlib
from pathlib import Path

W,H=608,1136
CLEAR=(0,0,0,0)
INK=(17,25,44,255); EDGE=(56,77,105,255)
WHITE=(230,241,247,255)
palette=[(125,217,190,255),(250,172,100,255),(175,170,247,255),(117,191,235,255),(245,136,168,255)]
class Canvas:
    def __init__(self,w,h,color=CLEAR):self.w,self.h,self.rows=w,h,[bytearray(color*w) for _ in range(h)]
    def rectangle(self,x,y,X,Y,c):
        x,X=max(0,x),min(self.w,X);y,Y=max(0,y),min(self.h,Y)
        if X<=x:return
        buf=bytes(c*(X-x))
        for j in range(y,Y):self.rows[j][4*x:4*X]=buf
    def polygon(self,points,c):
        for y in range(max(0,min(p[1] for p in points)),min(self.h,max(p[1] for p in points))):
            xs=[]
            for (x1,y1),(x2,y2) in zip(points,points[1:]+points[:1]):
                if min(y1,y2)<=y+.5<max(y1,y2):xs.append(x1+(y+.5-y1)*(x2-x1)/(y2-y1))
            xs.sort()
            for l,r in zip(xs[::2],xs[1::2]):self.rectangle(round(l),y,round(r),y+1,c)
    def paste(self,s,x,y):
        assert 0<=x<=self.w-s.w and 0<=y<=self.h-s.h
        for j,row in enumerate(s.rows):
            dest=self.rows[y+j]
            for i in range(s.w):
                k=i*4
                if row[k+3]:dest[4*x+k:4*x+k+4]=row[k:k+4]
    def crop(self,x,y,X,Y):
        c=Canvas(X-x,Y-y)
        for j in range(Y-y):c.rows[j][:]=self.rows[y+j][4*x:4*X]
        return c
    def url(self):
        # Pure indexed image with explicit transparent palette entry.
        colors=list(dict.fromkeys(tuple(row[i:i+4]) for row in self.rows for i in range(0,len(row),4)))
        assert 0<len(colors)<=256
        lookup={c:i for i,c in enumerate(colors)}
        bits=1 if len(colors)<=2 else 2 if len(colors)<=4 else 4 if len(colors)<=16 else 8
        span=8//bits
        rows=[];previous=bytes((self.w+span-1)//span)
        for row in self.rows:
            pixels=[lookup[tuple(row[i:i+4])] for i in range(0,len(row),4)]
            pixels.extend([0]*(-len(pixels)%span))
            packed=bytes(sum(pixels[i+j]<<((span-1-j)*bits) for j in range(span)) for i in range(0,len(pixels),span))
            up=bytes((v-prev)&255 for v,prev in zip(packed,previous))
            left=bytes((v-prev)&255 for v,prev in zip(packed,b'\0'+packed))
            tag,res=min(enumerate([packed,left,up]),key=lambda item:len(item[1])-item[1].count(0))
            rows.append(bytes([tag])+res)
            previous=packed
        data=b''.join(rows)
        def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',binascii.crc32(t+b)&0xffffffff)
        sig=b'\x89PNG\r\n\x1a\n'
        img=sig+chunk(b'IHDR',struct.pack('>IIBBBBB',self.w,self.h,bits,3,0,0,0))
        img+=chunk(b'PLTE',bytes(v for c in colors for v in c[:3]))+chunk(b'tRNS',bytes(c[3] for c in colors))
        img+=chunk(b'IDAT',zlib.compress(data,9))+chunk(b'IEND',b'')
        return 'data:image/png;base64,'+base64.b64encode(img).decode()
def rim(c,x,y,X,Y,color):
    h=8
    c.polygon([(x+h,y),(X-h,y),(X,y+h),(X,Y-h),(X-h,Y),(x+h,Y),(x,Y-h),(x,y+h)],color)
def icon(w,h,c,mode):
    s=Canvas(w,h);rim(s,3,3,w-1,h-1,EDGE);rim(s,2,2,w-4,h-4,INK)
    s.rectangle(9,h-13,w-11,h-10,EDGE)
    x,y=w//2-1,h//2-3
    if mode%3==0:
        s.polygon([(x,y-13),(x+13,y),(x,y+13),(x-13,y)],c)
        s.polygon([(x,y-5),(x+5,y),(x,y+5),(x-5,y)],INK)
    elif mode%3==1:
        s.rectangle(x-11,y-9,x+12,y+10,c);s.rectangle(x-4,y-4,x+5,y+5,INK)
        s.rectangle(x-15,y-3,x-11,y+4,c);s.rectangle(x+12,y-3,x+16,y+4,c)
    else:
        s.polygon([(x-15,y+8),(x,y-10),(x+15,y+8)],c)
        s.rectangle(x-2,y-1,x+2,y+8,INK)
    s.rectangle(x-8,h-12,x+8,h-9,c)
    return s
def strip(w,h,c):
    s=Canvas(w,h);rim(s,3,3,w-1,h-1,EDGE);rim(s,2,2,w-3,h-3,INK)
    s.rectangle(12,12,35,h-14,c);s.rectangle(39,16,w-28,19,EDGE)
    return s
def building(w,h,c,k):
    s=Canvas(w,h)
    s.polygon([(0,h-35),(17,h-44),(w-17,h-44),(w,h-35),(w-8,h-15),(10,h-15)],EDGE)
    s.polygon([(16,h-35),(32,h-150),(91,h-162),(136,h-164),(215,h-123),(w-15,h-35)],INK)
    if k==0:
        s.polygon([(25,h-70),(74,h-146),(120,h-109),(154,h-149),(225,h-70)],c)
        for i in range(4):s.rectangle(36+i*46,h-66,58+i*46,h-44,WHITE)
    else:
        s.rectangle(43,h-122,w-43,h-67,c);s.rectangle(66,h-143,w-66,h-121,c)
        s.polygon([(203,h-93),(224,h-92),(204,h-62),(180,h-62)],WHITE)
        for i in range(4):s.rectangle(55+i*29,h-58,64+i*29,h-36,c)
    s.rectangle(27,h-34,w-27,h-27,c)
    # Deliberately transparent lower center slot, authored as such, not inferred hidden pixels.
    return s
def button(w,h,c):
    s=Canvas(w,h);rim(s,5,5,w-1,h-1,EDGE);rim(s,3,3,w-4,h-4,c)
    x,y=w//2,h//2
    s.polygon([(x-12,y-3),(x+1,y-3),(x+1,y-10),(x+13,y),(x+1,y+10),(x+1,y+3),(x-12,y+3)],INK)
    return s
screen=Canvas(W,H,(25,37,58,255))
# Original demo abstraction: a survey grid and layered rays, no input artwork.
for y in range(0,H,52):screen.rectangle(0,y,W,y+1,(31,48,69,255))
for x in range(0,W,38):screen.rectangle(x,0,x+1,H,(31,48,69,255))
screen.polygon([(60,730),(290,443),(360,443),(592,730)],(36,72,92,255))
screen.polygon([(119,728),(298,467),(324,467),(522,728)],(44,98,111,255))
screen.polygon([(146,734),(298,508),(314,508),(483,734)],(31,59,79,255))
for x,y,h in [(256,640,37),(287,605,54),(308,575,96),(347,620,48),(384,665,16)]:
    screen.rectangle(x,y,x+13,y+h,(85,130,145,255))
nodes=[]; paintings={};families={}
def group(id,parent,name,box=None,kind='Node',**other):
    n=dict(id=id,parent=parent,name=name,type=kind,status='group',**other)
    if box:n.update(box=box,elementSizeDU=[box[2]-box[0],box[3]-box[1]])
    nodes.append(n)
    return n
def visual(id,parent,name,xy,img,family,**add):
    x,y=xy;w,h=img.w,img.h
    n=dict(id=id,parent=parent,name=name,type='Sprite',status='cut',box=[x,y,x+w,y+h],framePx=[w,h],size=[w,h],asset=id+'.png',
           elementSizeDU=[w,h],family=family,displayId=len(paintings)+1,image=img.url(),receivesInput=False,**add)
    nodes.append(n);paintings[id]=img
    f=families.setdefault(family,dict(ids=[],framePx=[w,h]))
    assert f['framePx']==[w,h]
    f['ids'].append(id)
    screen.paste(img,x,y)
    return n
def interactive(id,parent,name,x,y,art_id,img,family,design,kind='Button'):
    w,h=img.w,img.h
    group(id,parent,name,[x,y,x+w,y+h],kind=kind,input=dict(dock=parent,visual=art_id,kind=kind,design=design,minimumViewportPx=[44,44]))
    visual(art_id,id,'Artwork',(x,y),img,family)
    group(id+'Hit',id,'命中范围',kind='HitArea',elementSizeDU=design)
group('root',None,'信标控制台',[0,0,W,H])
group('safeArea', 'root','安全区容器')
for id,name,b in [('profile','仪表 / 左上',[26,36,241,105]),('wallet','读数 / 右上',[391,41,581,108]),('member','近程仪表',[28,151,228,221]),('utility','远程仪表',[383,151,582,221]),('left','左侧工具',[27,285,124,474]),('monetize','右侧工具',[493,294,581,385]),('entries','两座信标',[34,740,574,1001]),('nav','底部仪表',[27,1023,581,1107])]:
    group(id,'safeArea',name,b)
nodes.append(dict(id='background',parent='root',name='示意网格',type='Backdrop',status='blocked',box=[125,256,465,708],note='这个区域用作参考图定位，独立资源不导出。'))
visual('profilePlate','profile','轮廓 HUD',(27,39),strip(180,60,palette[0]),'ProfileBacking')
visual('walletPlate','wallet','读数底板',(395,49),strip(178,52,palette[1]),'ReadoutBacking')
interactive('readoutAction','wallet','读数选项',513,50,'readoutArt',icon(59,49,palette[1],0),'ReadoutAction',[57,46])
nodes.append(dict(id='balance',parent='wallet',name='动态读数',type='Label',status='data',box=[444,70,501,89],previewText='128.0',style=dict(fontPx=17),binding='demo.signalStrength',note='独立运行时读数，数值为合成示例。'))
glyph={'1':['010','110','010','010','111'],'2':['111','001','111','100','111'],'8':['111','101','111','101','111'],'0':['111','101','101','101','111'],'.':['000','000','000','000','010']}
for i,g in enumerate('128.0'):
    for j,rr in enumerate(glyph[g]):
        for k,v in enumerate(rr):
            if v=='1':screen.rectangle(445+i*8+2*k,70+j*3,447+i*8+2*k,73+j*3,WHITE)
for p,id,t,x,y,k in [('member','compass','定向仪',34,154,0),('member','scope','相位镜',150,154,1),('utility','logbook','观测日志',389,154,2),('utility','beam','校准光束',505,154,3),('left','route','路径格',35,286,4),('left','prism','色散片',35,404,5),('monetize','accent','色标',502,303,6)]:
    interactive(id,p,t,x,y,'firstPayArt' if id=='accent' else id+'Art',icon(64,64,palette[k%len(palette)],k),'ConsoleIcon',[56,58])
for k,(id,t,x) in enumerate([('towerOne','晨昏信标',34),('towerTwo','蓝弧信标',328)]):
    group(id,'entries',t,[x,742,x+246,997],kind='Entry')
    visual(id+'Artwork',id,'信标图形',(x,741),building(246,208,palette[k],k),'BeaconArtwork',note='由脚本独立绘制，尺寸相同。')
    n=group(id+'Action',id,'打开信标',[x+70,940,x+176,990],kind='Button',
      input=dict(dock='entries',visual=id+'ActionArt',kind='Button',design=[100,48],minimumViewportPx=[44,44]))
    visual(id+'ActionArt',n['id'],'Artwork',(x+70,940),button(106,50,palette[k]),'BeaconAction')
    group(id+'ActionHit',n['id'],'命中范围',kind='HitArea',elementSizeDU=[100,48])
for k,(s,t,x) in enumerate([('monitor','监测',57),('journal','记录',256),('tools','工具',455)]):
    interactive(s,'nav',t,x,1028,s+'Art',icon(98,76,palette[(k+2)%5],k),'BottomTab',[94,67])
compare=Canvas(506,226,(37,49,73,255))
compare.paste(paintings['towerOneArtwork'],4,9);compare.paste(paintings['towerTwoArtwork'],256,9)
for x in [4,256]:
    compare.rectangle(x,9,x+246,10,WHITE);compare.rectangle(x,216,x+246,217,WHITE)
    compare.rectangle(x,9,x+1,217,WHITE);compare.rectangle(x+245,9,x+246,217,WHITE)
payload=dict(sourceSize=[W,H],contentViewport=[0,0,W,H],displayReference=dict(name='合成实验画板',points=[374,794],method='源图与示例素材均由本脚本原创生成。'),
  nodes=nodes,status=dict(group='预制体分组',cut='示例透明 PNG',data='运行时绑定',rebuild='待重建',blocked='仅作参考',restored='示例重建',occluded='遮挡示例'),
  sizeFamilies=families,source=screen.url(),hud=screen.crop(0,0,W,250).url(),buildingComparison=compare.url(),
  layoutContract=dict(version=2,designWidthDU=W,sourceOrigin='top-left',elementUnits='design-unit',engineVerified=False,
      safeArea=dict(space='viewport',insetsOrder=['top','right','bottom','left']),top=['profile','wallet','member','utility'],
      side=['left','monetize'],bottom=['entries','nav'],sourcesAreReferenceOnly=True,inputContract='owner and independent hit area; visual never handles input'),
  presets=[['紧凑预览',344,682,22,18],['竖屏预览',374,794,43,25],['加长预览',412,899,52,29]],layoutSpec='layout-rules.md')
out=Path(__file__).resolve().with_name('fixture.json')
out.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'{out.name}: {out.stat().st_size} bytes, {len(nodes)} nodes, {len(paintings)} transparent PNGs, sha256={hashlib.sha256(out.read_bytes()).hexdigest()}')
