import {createHash} from 'node:crypto';

export const TOOL_ID='responsive-route-snapshotter';
export const LIMITS=Object.freeze({manifestBytes:1_048_576,screenshotBytes:8_388_608,routes:1000,depth:16,milliseconds:5000});
const severity=Object.freeze({'input-unreadable':'warning','input-invalid':'warning','export-incomplete':'warning','byte-limit':'warning','record-limit':'warning','depth-limit':'warning','time-limit':'warning','capture-mismatch':'warning','route-invalid':'warning','route-duplicate':'warning','route-missing':'warning','route-failed':'warning','route-unfinished':'warning','font-not-ready':'warning','screenshot-unavailable':'warning','screenshot-hash-mismatch':'warning','snapshot-changed':'error'});
const messages=Object.freeze({'input-unreadable':'Manifest could not be read, decoded, or parsed.','input-invalid':'Expected a supported version 1 capture manifest.','export-incomplete':'Capture manifest explicitly declares incomplete coverage.','byte-limit':'Manifest or screenshot exceeds its declared byte limit.','record-limit':'Route count exceeds 1000.','depth-limit':'JSON nesting exceeds depth 16.','time-limit':'Evaluation exceeded 5000 milliseconds.','capture-mismatch':'Capture controls differ between manifests.','route-invalid':'Route capture record is invalid.','route-duplicate':'Route identity is duplicated.','route-missing':'Route has no matching capture in the other manifest.','route-failed':'Route capture failed.','route-unfinished':'Route capture was unfinished.','font-not-ready':'Fonts were not ready for this capture.','screenshot-unavailable':'Screenshot artifact is unavailable within the root.','screenshot-hash-mismatch':'Screenshot bytes disagree with the recorded digest.','snapshot-changed':'Controlled screenshot bytes differ between captures.'});
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safe=x=>typeof x==='string'&&x.length>0&&x.length<=240&&!/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\p{Cf}]/u.test(x);
const route=x=>safe(x)&&/^\/[A-Za-z0-9/_-]*$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const capture=x=>obj(x)&&(x.complete===undefined||typeof x.complete==='boolean')&&obj(x.viewport)&&Number.isInteger(x.viewport.width)&&x.viewport.width>=1&&x.viewport.width<=4096&&Number.isInteger(x.viewport.height)&&x.viewport.height>=1&&x.viewport.height<=4096&&safe(x.locale)&&safe(x.timeZone)&&safe(x.seed);
function finding(ruleId,file,pointer=''){if(!Object.hasOwn(severity,ruleId))throw Error('unknown rule');return {ruleId,severity:severity[ruleId],message:messages[ruleId],location:{file,pointer}};}
function report(findings,checked=0){findings.sort((a,b)=>cmp(a.location.file,b.location.file)||cmp(a.location.pointer,b.location.pointer)||cmp(a.ruleId,b.ruleId));const status=findings.some(f=>f.severity==='warning')?'incomplete':findings.length?'fail':'pass';return {schemaVersion:'1',tool:TOOL_ID,status,summary:{checked,errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length},findings};}
export function incomplete(ruleId,file){return report([finding(ruleId,file)]);}
function tooDeep(value){const stack=[[value,0]];while(stack.length){const [x,d]=stack.pop();if(d>LIMITS.depth)return true;if(x&&typeof x==='object')for(const child of Object.values(x))stack.push([child,d+1]);}return false;}
function validManifest(x){return obj(x)&&x.schemaVersion==='1'&&(x.complete===undefined||typeof x.complete==='boolean')&&capture(x.capture)&&Array.isArray(x.routes)&&x.routes.length>0;}
function validRoute(x){return obj(x)&&route(x.route)&&['ready','failed','unfinished'].includes(x.status)&&typeof x.fontsReady==='boolean'&&(x.status!=='ready'||(safe(x.screenshot)&&digest(x.sha256)));}

export async function compareSnapshots(baseline,current,{readScreenshot=async()=>null,now=()=>performance.now()}={}){
  const start=now(),findings=[];
  if(!validManifest(baseline))findings.push(finding('input-invalid','@baseline'));
  if(!validManifest(current))findings.push(finding('input-invalid','@current'));
  if(findings.length)return report(findings);
  for(const [file,doc] of [['@baseline',baseline],['@current',current]]){
    if(doc.complete===false)findings.push(finding('export-incomplete',file,'/complete'));
    if(doc.capture.complete===false)findings.push(finding('export-incomplete',file,'/capture/complete'));
  }
  if(findings.length)return report(findings);
  if(tooDeep(baseline))findings.push(finding('depth-limit','@baseline'));
  if(tooDeep(current))findings.push(finding('depth-limit','@current'));
  if(baseline.routes.length>LIMITS.routes)findings.push(finding('record-limit','@baseline'));
  if(current.routes.length>LIMITS.routes)findings.push(finding('record-limit','@current'));
  if(findings.length)return report(findings);
  const a=baseline.capture,b=current.capture;
  if(a.viewport.width!==b.viewport.width||a.viewport.height!==b.viewport.height||a.locale!==b.locale||a.timeZone!==b.timeZone||a.seed!==b.seed)return report([finding('capture-mismatch','@current','/capture')]);
  const indexes=[];
  for(const [file,doc] of [['@baseline',baseline],['@current',current]]){
    const index=new Map();indexes.push(index);
    for(const [i,item] of doc.routes.entries()){
      if(now()-start>LIMITS.milliseconds)return incomplete('time-limit',file);
      if(!validRoute(item)){findings.push(finding('route-invalid',file,`/routes/${i}`));continue;}
      if(index.has(item.route)){findings.push(finding('route-duplicate',file,`/routes/${i}`));continue;}
      index.set(item.route,{item,i});
    }
  }
  if(findings.length)return report(findings);
  let checked=0;
  for(const [file,index,other] of [['@baseline',indexes[0],indexes[1]],['@current',indexes[1],indexes[0]]]){
    for(const [name,{item,i}] of index){
      if(now()-start>LIMITS.milliseconds)return incomplete('time-limit',file);
      if(!other.has(name))findings.push(finding('route-missing',file,`/routes/${i}`));
      if(item.status==='failed')findings.push(finding('route-failed',file,`/routes/${i}`));
      if(item.status==='unfinished')findings.push(finding('route-unfinished',file,`/routes/${i}`));
      if(item.status==='ready'&&!item.fontsReady)findings.push(finding('font-not-ready',file,`/routes/${i}`));
    }
  }
  const hashes=[new Map(),new Map()];
  for(const [side,index] of indexes.entries()){
    const file=side===0?'@baseline':'@current';
    for(const [name,{item,i}] of index){
      if(now()-start>LIMITS.milliseconds)return incomplete('time-limit',file);
      if(item.status!=='ready'||!item.fontsReady)continue;
      let bytes;
      try{bytes=await readScreenshot(file,i,item.screenshot);}catch{bytes=null;}
      if(!(bytes instanceof Uint8Array)){findings.push(finding('screenshot-unavailable',file,`/routes/${i}/screenshot`));continue;}
      if(bytes.byteLength>LIMITS.screenshotBytes){findings.push(finding('byte-limit',file,`/routes/${i}/screenshot`));continue;}
      const actual=createHash('sha256').update(bytes).digest('hex');
      if(actual!==item.sha256){findings.push(finding('screenshot-hash-mismatch',file,`/routes/${i}/sha256`));continue;}
      hashes[side].set(name,actual);
    }
  }
  if(now()-start>LIMITS.milliseconds)return incomplete('time-limit','@current');
  for(const [name,{i}] of indexes[1]){
    if(!hashes[0].has(name)||!hashes[1].has(name))continue;
    checked++;
    if(hashes[0].get(name)!==hashes[1].get(name))findings.push(finding('snapshot-changed','@current',`/routes/${i}`));
  }
  return report(findings,checked);
}
