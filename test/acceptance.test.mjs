import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const cli=new URL('../bin/responsive-route-snapshotter.mjs',import.meta.url).pathname;
const shot='<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>';
const digest=s=>createHash('sha256').update(s).digest('hex');
const capture={complete:true,viewport:{width:1280,height:720},locale:'en-US',timeZone:'UTC',seed:'fixture-1'};
function manifest(routes=[{route:'/home',status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)}]){return {schemaVersion:'1',complete:true,capture:structuredClone(capture),routes};}
function run(base=manifest(),current=manifest(),baseShot=shot,currentShot=shot){
  const root=mkdtempSync(join(tmpdir(),'route-snapshot-'));
  try{
    writeFileSync(join(root,'base.json'),JSON.stringify(base));writeFileSync(join(root,'current.json'),JSON.stringify(current));
    if(baseShot!==null)writeFileSync(join(root,'shot.svg'),baseShot);
    if(currentShot!==null&&currentShot!==baseShot)writeFileSync(join(root,'current.svg'),currentShot);
    const p=spawnSync(process.execPath,[cli,'--root',root,'--baseline','base.json','--current','current.json'],{encoding:'utf8'});
    return {...p,report:p.stdout?JSON.parse(p.stdout):null};
  }finally{rmSync(root,{recursive:true,force:true});}
}

test('two controlled local captures with verified image hashes match deterministically',()=>{
  const a=run(),b=run();
  assert.equal(a.status,0);assert.equal(a.stdout,b.stdout);
  assert.equal(a.report.status,'pass');assert.equal(a.report.summary.checked,1);
  assert.deepEqual(a.report.findings,[]);
  assert.doesNotMatch(a.stdout,/\/home|fixture-1|shot\.svg/);
});

test('changed captured image is a failed comparison at current route ordinal',()=>{
  const changed='<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
  const c=manifest([{route:'/home',status:'ready',fontsReady:true,screenshot:'current.svg',sha256:digest(changed)}]);
  const r=run(manifest(),c,shot,changed);
  assert.equal(r.status,1);assert.equal(r.report.findings[0].ruleId,'snapshot-changed');
  assert.equal(r.report.findings[0].location.pointer,'/routes/0');
});

test('missing font and unfinished route are isolated incomplete capture errors',()=>{
  const b=manifest([{route:'/home',status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)},{route:'/about',status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)}]);
  const c=manifest([{route:'/home',status:'ready',fontsReady:false,screenshot:'shot.svg',sha256:digest(shot)},{route:'/about',status:'unfinished',fontsReady:true}]);
  const r=run(b,c);
  assert.equal(r.status,2);
  assert.deepEqual(r.report.findings.map(f=>f.ruleId),['font-not-ready','route-unfinished']);
});

test('metadata mismatch cannot be presented as visual change or pass',()=>{
  const c=manifest();c.capture.viewport.width=375;
  const r=run(manifest(),c);
  assert.equal(r.status,2);assert.equal(r.report.findings[0].ruleId,'capture-mismatch');
});

test('explicitly partial capture coverage cannot pass at either marker',()=>{
  const a=manifest();a.complete=false;
  const first=run(a,manifest());
  assert.equal(first.status,2);assert.equal(first.report.findings[0].ruleId,'export-incomplete');
  const c=manifest();c.capture.complete=false;
  const second=run(manifest(),c);
  assert.equal(second.status,2);assert.equal(second.report.findings[0].ruleId,'export-incomplete');
});

test('missing completeness assertions cannot certify a capture comparison',()=>{
  const a=manifest();delete a.complete;
  const first=run(a,manifest());
  assert.equal(first.status,2);assert.equal(first.report.findings[0].ruleId,'export-incomplete');
  const c=manifest();delete c.capture.complete;
  const second=run(manifest(),c);
  assert.equal(second.status,2);assert.equal(second.report.findings[0].ruleId,'export-incomplete');
});

test('equivalent capture controls with reordered JSON fields still compare',()=>{
  const c=manifest();c.capture={seed:'fixture-1',timeZone:'UTC',locale:'en-US',viewport:{height:720,width:1280},complete:true};
  assert.equal(run(manifest(),c).status,0);
});

test('safe URL paths with a dot and encoded space compare as captured routes',()=>{
  for(const name of ['/guide.v1','/en%20us']){
    const a=manifest([{route:name,status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)}]);
    const r=run(a,structuredClone(a));
    assert.equal(r.status,0,name);
    assert.equal(r.report.summary.checked,1);
  }
});

test('encoded traversal, controls, and bidi are not accepted as route identities',()=>{
  for(const name of ['/guide/%2e%2e/private','/path%00','/path%E2%80%AE']){
    const a=manifest([{route:name,status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)}]);
    const r=run(a,structuredClone(a));
    assert.equal(r.status,2,name);
    assert.equal(r.report.findings[0].ruleId,'route-invalid');
  }
});

test('failed route does not hide a different healthy route',()=>{
  const changed='<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
  const b=manifest([{route:'/home',status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)},{route:'/about',status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)}]);
  const c=manifest([{route:'/home',status:'failed',fontsReady:false},{route:'/about',status:'ready',fontsReady:true,screenshot:'current.svg',sha256:digest(changed)}]);
  const r=run(b,c,shot,changed);
  assert.equal(r.status,2);
  assert.deepEqual(r.report.findings.map(f=>f.ruleId),['route-failed','snapshot-changed']);
});

test('missing or unverified screenshot prevents a pass',()=>{
  const r=run(manifest(),manifest(),null,null);
  assert.equal(r.status,2);assert.equal(r.report.findings[0].ruleId,'screenshot-unavailable');
});

test('manifest record bound accepts 1000 routes and rejects 1001',()=>{
  const routes=Array.from({length:1000},(_,i)=>({route:`/r${i}`,status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)}));
  const b=manifest(routes);
  assert.equal(run(b,structuredClone(b)).status,0);
  b.routes.push({route:'/extra',status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(shot)});
  const r=run(b,structuredClone(b));assert.equal(r.status,2);assert.equal(r.report.findings[0].ruleId,'record-limit');
});

test('manifest byte boundary accepts N and refuses N+1',()=>{
  const root=mkdtempSync(join(tmpdir(),'route-bytes-'));
  try{
    const base=JSON.stringify(manifest());
    writeFileSync(join(root,'base.json'),base+' '.repeat(1_048_576-Buffer.byteLength(base)));
    writeFileSync(join(root,'current.json'),base);
    writeFileSync(join(root,'shot.svg'),shot);
    const invoke=()=>spawnSync(process.execPath,[cli,'--root',root,'--baseline','base.json','--current','current.json'],{encoding:'utf8'});
    assert.equal(invoke().status,0);
    writeFileSync(join(root,'base.json'),base+' '.repeat(1_048_577-Buffer.byteLength(base)));
    const over=invoke();assert.equal(over.status,2);assert.equal(JSON.parse(over.stdout).findings[0].ruleId,'byte-limit');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('JSON depth 16 is allowed and 17 is incomplete',async()=>{
  const {compareSnapshots}=await import('../src/index.mjs');
  const a=manifest(),b=manifest();let x=a;
  for(let i=0;i<16;i++){x.extra={};x=x.extra;}
  assert.equal((await compareSnapshots(a,b,{readScreenshot:async()=>Buffer.from(shot)})).status,'pass');
  x.extra={};
  const over=await compareSnapshots(a,b,{readScreenshot:async()=>Buffer.from(shot)});
  assert.equal(over.status,'incomplete');assert.equal(over.findings[0].ruleId,'depth-limit');
});

test('screenshot byte boundary accepts N and refuses N+1',async()=>{
  const {compareSnapshots,LIMITS}=await import('../src/index.mjs');
  const bytes=Buffer.alloc(LIMITS.screenshotBytes,42),large=Buffer.alloc(LIMITS.screenshotBytes+1,42);
  const a=manifest([{route:'/home',status:'ready',fontsReady:true,screenshot:'shot.svg',sha256:digest(bytes)}]);
  assert.equal((await compareSnapshots(a,structuredClone(a),{readScreenshot:async()=>bytes})).status,'pass');
  const over=await compareSnapshots(a,structuredClone(a),{readScreenshot:async()=>large});
  assert.equal(over.status,'incomplete');assert.equal(over.findings[0].ruleId,'byte-limit');
});

test('injected elapsed clock accepts 5000ms and refuses 5001ms',async()=>{
  const {compareSnapshots}=await import('../src/index.mjs');
  let first=true;const at=()=>{if(first){first=false;return 0;}return 5000;};
  assert.equal((await compareSnapshots(manifest(),manifest(),{now:at,readScreenshot:async()=>Buffer.from(shot)})).status,'pass');
  first=true;const over=()=>{if(first){first=false;return 0;}return 5001;};
  const r=await compareSnapshots(manifest(),manifest(),{now:over,readScreenshot:async()=>Buffer.from(shot)});
  assert.equal(r.status,'incomplete');assert.equal(r.findings[0].ruleId,'time-limit');
});

test('escaping screenshot symlink is refused without exposing target',()=>{
  const root=mkdtempSync(join(tmpdir(),'route-root-')),outside=mkdtempSync(join(tmpdir(),'route-out-'));
  try{
    const b=manifest(),c=manifest();
    writeFileSync(join(root,'base.json'),JSON.stringify(b));writeFileSync(join(root,'current.json'),JSON.stringify(c));
    writeFileSync(join(outside,'private.svg'),'PRIVATE_SENTINEL');
    symlinkSync(join(outside,'private.svg'),join(root,'shot.svg'));
    const p=spawnSync(process.execPath,[cli,'--root',root,'--baseline','base.json','--current','current.json'],{encoding:'utf8'});
    assert.equal(p.status,2);assert.equal(JSON.parse(p.stdout).status,'incomplete');assert.doesNotMatch(p.stdout,/PRIVATE_SENTINEL/);
  }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('bad usage has empty stdout',()=>{
  const p=spawnSync(process.execPath,[cli,'--unknown'],{encoding:'utf8'});
  assert.equal(p.status,2);assert.equal(p.stdout,'');
});

test('one manifest file cannot be passed as both captures',()=>{
  const root=mkdtempSync(join(tmpdir(),'route-one-'));
  try{
    writeFileSync(join(root,'only.json'),JSON.stringify(manifest()));
    writeFileSync(join(root,'shot.svg'),shot);
    const p=spawnSync(process.execPath,[cli,'--root',root,'--baseline','only.json','--current','only.json'],{encoding:'utf8'});
    assert.equal(p.status,2);assert.equal(p.stdout,'');
  }finally{rmSync(root,{recursive:true,force:true});}
});
