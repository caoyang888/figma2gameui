import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { build_zip, type ExportAsset } from './export_cocos.ts';
import { validate_plan } from './plan.ts';

export async function create_sample() {
  const bytes = Buffer.alloc(64 * 64 * 4);
  for (let y=7; y<57; y++) for (let x=7; x<57; x++) {
    const color = Math.abs(x-31) + Math.abs(y-31) < 17 ? [244,236,188,255] : [57,157,163,255];
    bytes.set(color,(y*64+x)*4);
  }
  const shared = await sharp(bytes,{raw:{width:64,height:64,channels:4}}).png().toBuffer();
  const project = {id:'synthetic-project',name:'合成样例',cocosVersion:'3.8.8'};
  const assets = new Map<string,ExportAsset>([['signal',{id:'signal',name:'信标',kind:'image',mime:'image/png',width:64,height:64,bundle:'common',path:'textures/signal.png',uuid:'c8f2ec83-3d43-4331-ab4b-5fab33db1234'}]]);
  function plan(text: string) {
    return validate_plan({width:360,height:640,nodes:[
      {id:'root',parentId:null,kind:'container',name:'信标面板',x:0,y:0,width:360,height:640},
      {id:'list',parentId:'root',kind:'layout',name:'状态列表',x:40,y:95,width:280,height:300,direction:'vertical',gap:12},
      {id:'title',parentId:'list',kind:'label',name:'标题',x:74,y:103,width:212,height:46,text,align:'center'},
      {id:'status',parentId:'list',kind:'label',name:'动态数据',x:74,y:161,width:212,height:40,text:'128.0',align:'center'},
      {id:'button',parentId:'root',kind:'button',name:'确认触摸区',x:120,y:430,width:120,height:82},
      {id:'mark',parentId:'button',kind:'sprite',name:'信标显示',x:148,y:439,width:64,height:64,assetId:'signal'},
    ],issues:[]},new Set(assets.keys()));
  }
  return build_zip(project,[{id:'receiver',name:'接收器',plan:plan('信标接收器')},{id:'sender',name:'发射器',plan:plan('信标发射器')}],assets,()=>shared,true);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('用法：npm run sample -- /path/to/sample.zip');
    process.exitCode=1;
  } else {
    writeFileSync(process.argv[2],await create_sample());
    console.log(process.argv[2]);
  }
}
