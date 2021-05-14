#!/usr/bin/env node
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {compareSnapshots,incomplete,LIMITS} from '../src/index.mjs';

const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
  process.stdout.write('Usage: responsive-route-snapshotter --root DIR --baseline FILE --current FILE [--human]\nCompares pre-captured local manifests and screenshot bytes; never drives a browser.\n');
}else{
  let root,baseline,current,human=false;
  try{
    for(let i=0;i<args.length;i++){
      const key=args[i];
      if(key==='--human'){if(human)throw Error('duplicate');human=true;continue;}
      if(!['--root','--baseline','--current'].includes(key)||i+1>=args.length)throw Error('option');
      const value=args[++i];
      if(key==='--root'){if(root)throw Error('duplicate');root=value;}
      if(key==='--baseline'){if(baseline)throw Error('duplicate');baseline=value;}
      if(key==='--current'){if(current)throw Error('duplicate');current=value;}
    }
    if(!root||!baseline||!current||isAbsolute(baseline)||isAbsolute(current))throw Error('usage');
    root=await realpath(root);
    if(!(await stat(root)).isDirectory())throw Error('root');
    const first=await realpath(resolve(root,baseline)).catch(()=>null);
    const second=await realpath(resolve(root,current)).catch(()=>null);
    if(first&&first===second)throw Error('same manifest');
  }catch{process.stderr.write('Invalid configuration. Use --help.\n');process.exit(2);}
  const inside=path=>{const rel=relative(root,path);return rel!==''&&rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);};
  async function readManifest(name,file){
    try{
      const path=await realpath(resolve(root,name));
      if(!inside(path)||!(await stat(path)).isFile())throw Error('unreadable');
      const info=await stat(path);
      if(info.size>LIMITS.manifestBytes)return {error:incomplete('byte-limit',file)};
      const bytes=await readFile(path,{signal:AbortSignal.timeout(LIMITS.milliseconds)});
      if(bytes.length>LIMITS.manifestBytes)return {error:incomplete('byte-limit',file)};
      return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
    }catch{return {error:incomplete('input-unreadable',file)};}
  }
  const a=await readManifest(baseline,'@baseline'),b=await readManifest(current,'@current');
  let result;
  if(a.error||b.error)result=a.error||b.error;
  else{
    const cache=new Map();
    const readScreenshot=async(_file,_ordinal,name)=>{
      if(typeof name!=='string'||isAbsolute(name))return null;
      const path=await realpath(resolve(root,name));
      if(!inside(path)||!(await stat(path)).isFile())return null;
      const info=await stat(path);
      if(info.size>LIMITS.screenshotBytes)return new Uint8Array(LIMITS.screenshotBytes+1);
      if(!cache.has(path))cache.set(path,readFile(path,{signal:AbortSignal.timeout(LIMITS.milliseconds)}));
      return cache.get(path);
    };
    result=await compareSnapshots(a.value,b.value,{readScreenshot});
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if(human)process.stderr.write(`Route snapshots: ${result.status}; ${result.summary.checked} routes compared; ${result.findings.length} findings.\n`);
  process.exitCode=result.status==='pass'?0:result.status==='fail'?1:2;
}
