const a=JSON.parse(document.querySelector('#payload').textContent),nodes=a.nodes;
const by=Object.fromEntries(nodes.map(n=>[n.id,n]));nodes.forEach(n=>{if(n.asset)n.num=String(n.displayId).padStart(2,'0')});document.querySelector('#fit-hero').src=a.hud;
const S=document.querySelector('#source');S.src=a.source;
const scr=document.querySelector('#screen'),tree=document.querySelector('#tree'),details=document.querySelector('#details'),gallery=document.querySelector('#gallery');
let state={id:nodes.find(n=>n.asset).id,filter:'all',raw:false};const mk=(tag,cls='',txt='')=>{let z=document.createElement(tag);z.className=cls;if(txt)z.textContent=txt;return z};
const path=n=>n.parent?[...path(by[n.parent]),n]:[n];
const yes=n=>state.filter==='all' || (state.filter==='cut'?!!n.asset:['blocked','data','rebuild','occluded'].includes(n.status));
function keep(n){return state.filter==='all'||(n.status==='group'?nodes.some(x=>x.parent===n.id&&keep(x)):yes(n))}
function pick(n){if(!n)return;state.id=n.id;state.raw=false;if(!keep(n)){state.filter=n.asset?'cut':'all';for(const el of document.querySelectorAll('[data-filter]'))el.setAttribute('aria-pressed',String(el.dataset.filter===state.filter));filter();}else live();const t=tree.querySelector('.row.sel');if(t){const y=t.getBoundingClientRect(),b=tree.getBoundingClientRect();if(y.top<b.top)tree.scrollTop-=b.top-y.top+6;if(y.bottom>b.bottom)tree.scrollTop+=y.bottom-b.bottom+6;}}
function live(){
  let z=by[state.id];
  for(let e of document.querySelectorAll('[data-node]'))e.classList.toggle('sel',e.dataset.node===z.id);
  details.replaceChildren();const h=mk('h3','',(z.num?z.num+' · ':'')+z.name);details.append(h,mk('div','path',path(z).map(x=>x.name).join(' › ')),mk('span','tag '+z.status,a.status[z.status]));
  const sc=mk('div','check');const span=mk('div','empty',z.status==='group'?'结构节点，无贴图':'无独立切图'); if(z.asset){const im=mk('img');im.src=z.image;im.alt=z.name;sc.append(im);}else sc.append(span);details.append(sc);
  const ctr=mk('div','control');if(z.elementSizeDU)details.append(mk('p','sizeinfo','元素尺寸：'+z.elementSizeDU.join(' × ')+' DU（设计单位）'));if(z.sizeRule)details.append(mk('p','muted',(z.elementSizeDU?'':'元素尺寸：')+z.sizeRule));if(z.layout)details.append(mk('p','facts','布局：'+z.layout));if(z.status==='group')drawBounds(z);if(z.framePx){details.append(mk('p','sizeinfo','统一 PNG '+z.framePx.join(' × ')+' px'+(z.hitAreaPx?' · 点击区 '+z.hitAreaPx.join(' × ')+' px':'')+(z.visibleCropPx?' · 源裁框 '+z.visibleCropPx.join(' × ')+' px':'')));}if(z.input)details.append(mk('p','sizeinfo','独立触摸区：模板 '+z.input.design.join(' × ')+' DU · 预览最小 44×44'));if(z.collection)details.append(mk('p','sizeinfo','列表：'+z.collection.template+' · '+z.collection.items.length+' 项 · '+z.collection.overflow));if(z.edgeRisk)details.append(mk('p','muted',z.edgeRisk));if(z.edgeReview)details.append(mk('p','sizeinfo','边缘复核：补抓色芯 '+z.edgeReview.recoveredColorCorePx+' px；原裁框外检查带 4 px'));if(z.binding)details.append(mk('p','sizeinfo','动态数据：'+z.binding));if(z.asset){const link=mk('a','button','下载透明 PNG');link.href=z.image;link.download=z.asset;ctr.append(link);}if(z.box){const b=mk('button','','看原图区域');b.onclick=()=>{state.raw=!state.raw;b.textContent=state.raw?'返回切图结果':'看原图区域';if(!state.raw){live();return;}sc.replaceChildren();const [x,y,X,Y]=z.box;const zoom=Math.min(280/(X-x),290/(Y-y));const crop=mk('div');crop.style.width=(X-x)*zoom+'px';crop.style.height=(Y-y)*zoom+'px';crop.style.backgroundImage='url('+a.source+')';crop.style.backgroundSize=a.sourceSize.map(v=>v*zoom+'px').join(' ');crop.style.backgroundPosition=(-x*zoom)+'px '+(-y*zoom)+'px';crop.style.backgroundRepeat='no-repeat';sc.append(crop);};ctr.append(b);}details.append(ctr,mk('p','facts',z.type+(z.box?' · '+z.box.join(', ')+' px':'')+(z.size?' · PNG '+z.size.join(' × '):'')),mk('p','muted',z.note||'建议组织成独立容器，便于管理布局和点击区。'));
}
function filter(){
  const old=tree.scrollTop; tree.replaceChildren();
  scr.querySelectorAll('.spot').forEach(el=>el.remove());
  for(const n of nodes){
    if(!keep(n))continue;
    const row=mk('button','row');row.dataset.node=n.id;row.style.setProperty('--d',path(n).length-1);
    row.append(mk('span','word',(n.num?n.num+' · ':'')+n.name));if(n.status!=='group')row.append(mk('span','tag '+n.status,a.status[n.status]));row.onclick=()=>pick(n);tree.append(row);
    if(n.status==='group'||!n.box)continue;const [x,y,X,Y]=n.box, [w,h]=a.sourceSize;
    const q=mk('button','spot '+n.status+((X-x)<36?' dotspot':''));q.dataset.node=n.id;q.style.cssText='left:'+100*x/w+'%;top:'+100*y/h+'%;width:'+100*(X-x)/w+'%;height:'+100*(Y-y)/h+'%';q.title=path(n).map(x=>x.name).join(' / ');q.setAttribute('aria-label',q.title);q.append(mk('b','',n.num|| (n.status==='blocked'?'×':n.status==='data'?'L':'△')));q.onclick=()=>pick(n);scr.append(q);
  } tree.scrollTop=old;live();
}
for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{state.filter=b.dataset.filter;for(const x of document.querySelectorAll('[data-filter]'))x.setAttribute('aria-pressed',String(x===b));if(!yes(by[state.id]))state.id=nodes.find(n=>n.status!=='group'&&yes(n))?.id||nodes[0].id;filter();};
for(const n of nodes.filter(n=>n.asset).sort((a,b)=>a.displayId-b.displayId)){
 const b=mk('button','tile');b.dataset.node=n.id;const c=mk('span','check'),i=mk('img'); i.src=n.image;i.alt=n.name;i.loading='lazy';c.append(i);
 b.append(c,mk('span','',n.num+' · '+((n.name==='图标＋文案 Sprite'||n.name==='Artwork')?by[n.parent].name:n.name==='BuildingArtwork'||n.name==='EnterButton'?by[n.parent].name+' / '+n.name:n.name)),mk('small',n.status,a.status[n.status]+(n.size?' · '+n.size.join('×'):'')));b.onclick=()=>{pick(n);document.querySelector('#inspect').scrollIntoView({block:'nearest',behavior:'smooth'});};gallery.append(b);
}
document.querySelector('#save-tree').onclick=()=>{const payload={sourceSize:a.sourceSize,contentViewport:a.contentViewport,sizeFamilies:a.sizeFamilies,layoutContract:a.layoutContract,nodes:nodes.map(({image,...n})=>n)};const u=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const l=document.createElement('a');l.href=u;l.download='screenshot-ui-tree.json';l.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
function fitLobby(data,W,H,top,bottom,left=0,right=0){
const M=Object.fromEntries(data.nodes.map(n=>[n.id,n]));
const b=n=>M[n].box;
const dims=n=>[b(n)[2]-b(n)[0],b(n)[3]-b(n)[1]];
const gap=8,margin=12, span=W-left-right, lx=left+margin, rx=W-right-margin, cx=left+span/2;
const dw=data.layoutContract.designWidthDU||data.sourceSize[0];
const dh=data.layoutContract.designHeightDU||data.sourceSize[1];
let s=Math.min((span-2*margin)/dw,(H-top-bottom)/dh,1);
let p,pass=false;
const safeTop=top+gap,safeBottom=H-bottom-gap;
for(let i=0;i<24;i++){
 const sz=n=>dims(n).map(v=>v*s);
 const [aW,aH]=sz('profile'),[wW,wH]=sz('wallet'),[mW,mH]=sz('member'),[uW,uH]=sz('utility'),[lW,lH]=sz('left'),[cW,cH]=sz('monetize'),[eW,eH]=sz('entries'),[nW,nH]=sz('nav');
 const next=safeTop+Math.max(aH,wH)+gap;
 const side=next+Math.max(mH,uH)+gap;
 const ny=safeBottom-nH;
 const ey=ny-gap-eH;
 const sideR=side+8;
 p={profile:[lx,safeTop,aW,aH],wallet:[rx-wW,safeTop+Math.max(0,(aH-wH)/2),wW,wH],member:[lx,next,mW,mH],utility:[rx-uW,next,uW,uH],left:[lx,side,lW,lH],monetize:[rx-cW,sideR,cW,cH],entries:[cx-eW/2,ey,eW,eH],nav:[cx-nW/2,ny,nW,nH]};
 pass=lx+aW+gap<=rx-wW && lx+mW+gap<=rx-uW && lx+lW+gap<=rx-cW && Math.max(side+lH,sideR+cH)+gap<=ey;
 if(pass)break;s*=0.94;
}
return {rects:p,scale:s,passed:pass,sideClearance:p.entries[1]-Math.max(p.left[1]+p.left[3],p.monetize[1]+p.monetize[3]),safeTop,safeBottom};
}


document.querySelector('#building-compare').src=a.buildingComparison;
function drawBounds(z){
 if(!activePreset)return;
 const [,W,H,T,B]=activePreset,{rects}=fitLobby(a,W,H,T,B);
 const rect=rects[z.id]||(z.id==='safeArea'?[0,T,W,H-T-B]:null);
 if(!rect)return;
 const [x,y,w,h]=rect, label=mk('p','sizeinfo','视口区域：'+Math.round(w)+' × '+Math.round(h)+'；左上 ('+Math.round(x)+', '+Math.round(y)+')');
 const box=mk('div','mini-map'), outline=mk('div','mini-rect');
 outline.style.cssText='left:'+x/W*100+'%;top:'+y/H*100+'%;width:'+w/W*100+'%;height:'+h/H*100+'%';
 box.append(outline);details.append(label,box);
}
const scenarios=document.querySelector('#scenarios'), fv=document.querySelector('#fit-view'),fs=document.querySelector('#fit-summary');
let activePreset;
function renderFit(set){
 activePreset=set;const [name,W,H,T,B]=set;
 const L=fitLobby(a,W,H,T,B), hs=planHits(a,L,W,H,T,B), delta=Object.fromEntries(hs.map(x=>[x.id,x])), u=Math.min(1,270/W,Math.max(1,fv.parentElement.clientWidth-18)/W);
 fv.style.width=W*u+'px';fv.style.height=H*u+'px'; fv.replaceChildren();
 fs.textContent=W+' × '+H+' · 安全边距 '+T+'/'+B+' · '+(L.passed?'顶/侧/底检查通过':'空间不足')+' · 两侧到玩法组 '+L.sideClearance.toFixed(1);
 const bounds=mk('div');bounds.style.cssText='position:absolute;pointer-events:none;top:'+T*u+'px;left:0;right:0;height:'+(H-T-B)*u+'px;border:1px dashed #76b9ca';fv.append(bounds);
 for(const [id,R] of Object.entries(L.rects)){
   for(const n of nodes.filter(x=>path(x).some(z=>z.id===id)&&(x.asset||x.previewText))){
     const b=n.placementBox||n.box, entry=n.asset?mk('img'):mk('span','',n.previewText);
     const bbox=by[id].box;
     const off=path(n).map(k=>delta[k.id]).find(Boolean)||{dx:0,dy:0};const x=R[0]+(b[0]-bbox[0])*L.scale+off.dx, y=R[1]+(b[1]-bbox[1])*L.scale+off.dy;
     entry.style.cssText='position:absolute;left:'+x*u+'px;top:'+y*u+'px;'+(n.asset?'width:'+n.size[0]*L.scale*u+'px;height:'+n.size[1]*L.scale*u+'px;':'white-space:nowrap;color:'+(n.id==='balance'?'white':'#32201c')+';font-weight:700;font-size:'+n.style.fontPx*L.scale*u+'px;');
     if(n.asset){entry.src=n.image;entry.alt=n.name;}fv.append(entry);
   }
 }
 if(document.querySelector('#toggle-hits').checked)for(const t of hs){
    const e=mk('button');const [x,y,w,h]=t.rect;e.style.cssText='position:absolute;left:'+x*u+'px;top:'+y*u+'px;width:'+w*u+'px;height:'+h*u+'px;border:1px solid #ffb568;background:#ffce7a25;padding:0;border-radius:4px';e.title=by[t.id].name+' · '+w.toFixed(0)+' × '+h.toFixed(0);e.setAttribute('aria-label',e.title);e.onclick=()=>{pick(by[t.id]);document.querySelector('#inspect').scrollIntoView({block:'nearest'});};fv.append(e);
 }
 fs.textContent+=' · '+hs.length+' 个命中区';
}
for(const set of a.presets){const e=mk('button','',set[0]+' '+set[1]+'×'+set[2]);e.onclick=()=>{for(const c of scenarios.children)c.setAttribute('aria-pressed',String(c===e));renderFit(set);live();};scenarios.append(e);}
document.querySelector('#toggle-hits').onchange=()=>renderFit(activePreset);scenarios.children[1].click();filter();document.querySelector('#fit-fold').addEventListener('toggle',()=>renderFit(activePreset));window.addEventListener('resize',()=>renderFit(activePreset));
function planHits(data,layout,W,H,T,B,L=0,R=0){
const by=Object.fromEntries(data.nodes.map(n=>[n.id,n]));
const s=layout.scale, groups=layout.rects;
const items=data.nodes.filter(n=>n.input).map(n=>{
 const cfg=n.input,ref=by[cfg.visual].box,b=by[cfg.dock].box,r=groups[cfg.dock];
 const w=Math.max(44,cfg.design[0]*s),h=Math.max(44,cfg.design[1]*s);
 const x=r[0]+((ref[0]+ref[2])/2-b[0])*s,y=r[1]+((ref[1]+ref[3])/2-b[1])*s;
 return {id:n.id,dock:cfg.dock,kind:cfg.kind,ox:x,oy:y,x,y,w,h};
});
const low=L+10, high=W-R-10;
for(const [group,axis] of Object.entries({member:'x',utility:'x',left:'y',monetize:'y',nav:'equal'})){
 const a=items.filter(x=>x.dock===group);
 if(axis==='equal'){
  const slot=(high-low)/a.length;a.forEach((x,i)=>{x.x=low+(i+.5)*slot;x.w=Math.min(x.w,slot-4);});continue;
 }
 a.sort((x,y)=>x[axis]-y[axis]);
 if(axis==='y'){for(let j=1;j<a.length;j++)a[j].y=Math.max(a[j].y,a[j-1].y+(a[j].h+a[j-1].h)/2+6);continue;}
 if(a.length<2)continue;
 const space=(a[0].w+a[1].w)/2+6;
 if(a[1].x-a[0].x<space){const half=(space-a[1].x+a[0].x)/2;a[0].x-=half;a[1].x+=half;}
 const d1=Math.max(0,low+a[0].w/2-a[0].x),d2=Math.max(0,a[1].x+a[1].w/2-high);
 a.forEach(n=>{n.x+=d1-d2;});
}
const keys=[['wallet','utility'],['member','left'],['utility','monetize']];
for(const [above,below] of keys){
 const A=items.filter(x=>x.dock===above),B=items.filter(x=>x.dock===below);
 if(!A.length||!B.length)continue;
 const distance=Math.max(0,Math.max(...A.map(x=>x.y+x.h/2))+6-Math.min(...B.map(x=>x.y-x.h/2)));
 B.forEach(x=>x.y+=distance);
}
for(const i of items){i.x=Math.max(L+i.w/2,Math.min(W-R-i.w/2,i.x));i.y=Math.max(T+i.h/2,Math.min(H-B-i.h/2,i.y));i.dx=i.x-i.ox;i.dy=i.y-i.oy;i.rect=[i.x-i.w/2,i.y-i.h/2,i.w,i.h];}
return items;
}
