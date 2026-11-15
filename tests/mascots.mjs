// Real Three.js objects, without a DOM, WebGL context or private session data.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundled=buildSync({entryPoints:[path.join(root,'web/mascots.js')],bundle:true,platform:'node',format:'esm',write:false});
const {workerMascot,codexMascot,dotMascot,disposeMascot}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const meshes=root=>{const out=[];root.traverse(o=>{if(o.isMesh)out.push(o)});return out;};

test('provider variants reuse geometry while preserving independent pivots and session data',()=>{
 for(const provider of ['codex','claude','gemini','copilot','antigravity','omp','kimi','dsh','grok','hermes','opencode']){
  for(const variant of [0,1,2]){
   const a=workerMascot(provider,variant),b=workerMascot(provider,variant+3);
   assert.equal(a.name,provider+'-mascot');assert.notEqual(a,b);
   const am=meshes(a),bm=meshes(b);assert.equal(am.length,bm.length);
   for(let i=0;i<am.length;i++)assert.equal(am[i].geometry,bm[i].geometry);
   const headA=a.getObjectByName('head'),headB=b.getObjectByName('head');
   const rest=headB.rotation.x;assert.notEqual(headA,headB);headA.rotation.x=.3;assert.equal(headB.rotation.x,rest);
   a.userData.sessionKey='first';b.userData.sessionKey='second';assert.equal(a.userData.sessionKey,'first');
   assert.ok(a.getObjectByName('label-anchor'));assert.ok(a.getObjectByName('arm-right'));
   disposeMascot(a);disposeMascot(b);
  }
 }
 const a=workerMascot('kimi',1),b=workerMascot('hermes',1);
 assert.equal(meshes(a)[0].geometry,meshes(b)[0].geometry,'identical generic provider styles share one bounded template');
 disposeMascot(a);disposeMascot(b);
});

test('Dot stays three tiers with six independently owned status lights',()=>{
 const a=dotMascot(),b=dotMascot(),signals=meshes(a).filter(o=>o.userData.signal),other=meshes(b).filter(o=>o.userData.signal);
 assert.equal(signals.length,6);assert.equal(other.length,6);
 for(const name of ['tier-0','tier-1','head','label-anchor'])assert.ok(a.getObjectByName(name));
 for(let i=0;i<signals.length;i++){
  assert.notEqual(signals[i].material,other[i].material);assert.equal(signals[i].geometry,other[i].geometry);
  const color=other[i].material.color.getHex();signals[i].material.color.setHex(0xff0000);assert.equal(other[i].material.color.getHex(),color);
 }
 disposeMascot(a);disposeMascot(b);
});

test('cloned silhouettes stay excluded from picking and outline visibility is per actor',()=>{
 for(const factory of [codexMascot,dotMascot,()=>workerMascot('claude',2)]){
  const a=factory(),b=factory(),outlines=meshes(a).filter(o=>o.userData.outline),other=meshes(b).filter(o=>o.userData.outline);
  assert.ok(outlines.length);
  for(let i=0;i<outlines.length;i++){
   const hits=[];outlines[i].raycast({},hits);assert.deepEqual(hits,[]);
   assert.equal(outlines[i].geometry,outlines[i].parent.geometry);
   outlines[i].visible=false;assert.equal(other[i].visible,true);
  }
  disposeMascot(a);disposeMascot(b);
 }
});

test('removing one actor retires its signal materials without disposing shared template resources',()=>{
 const a=dotMascot(),b=dotMascot();let geometryDisposals=0,staticDisposals=0,signalDisposals=0;
 const geometries=new Set(),materials=new Set();
 for(const mesh of meshes(a)){
  if(!geometries.has(mesh.geometry)){geometries.add(mesh.geometry);mesh.geometry.addEventListener('dispose',()=>geometryDisposals++);}
  if(mesh.userData.signal)mesh.material.addEventListener('dispose',()=>signalDisposals++);
  else if(!materials.has(mesh.material)){materials.add(mesh.material);mesh.material.addEventListener('dispose',()=>staticDisposals++);}
 }
 disposeMascot(a);assert.equal(signalDisposals,6);assert.equal(geometryDisposals,0);assert.equal(staticDisposals,0);
 const c=dotMascot();assert.equal(meshes(c)[0].geometry,meshes(b)[0].geometry);
 disposeMascot(b);disposeMascot(c);assert.equal(geometryDisposals,0);assert.equal(staticDisposals,0);
});

test('repeated construction and removal does not allocate fresh merged geometry',()=>{
 const seen=new Set();
 for(let cycle=0;cycle<4;cycle++){
  const roots=Array.from({length:25},(_,i)=>i===0?dotMascot():workerMascot(i%3===0?'codex':i%3===1?'claude':'gemini',i%3));
  const current=new Set(roots.flatMap(meshes).map(m=>m.geometry));
  if(cycle)assert.equal(current.size,[...current].filter(g=>seen.has(g)).length);
  for(const g of current)seen.add(g);
  roots.forEach(disposeMascot);
 }
});
