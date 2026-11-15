'use strict';
// Isolated real WebGL scene: independent of in-progress application chrome/SSE.
// Every session is synthetic and no journals or user preferences are read.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let browser;
const fixture=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>html,body,#office{margin:0;width:100%;height:100%;overflow:hidden}canvas{position:absolute;inset:0;width:100%;height:100%}.office-overlay{z-index:1}</style><div id="office"></div><script src="/office.js"></script><script type="module">import{Office3D}from'/office3d.js';window.office=new Office3D(document.querySelector('#office'),{label:s=>s.title});window.fixture=(n)=>Array.from({length:n},(_,i)=>({id:'scene-'+i,key:(i?'codex:':'dot:')+i,agent:i===0?'dot':i%3===1?'codex':i%3===2?'claude':'gemini',title:'Задача '+i,status:i===0?'unknown':i%4===0?'waiting':i%4===1?'tool':'thinking',subagent:false,startedAt:Date.now()+i}));office.update(fixture(3));</script></html>`;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.WMAD_CHROMIUM||chromium.executablePath(),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const p=await browser.newPage({viewport:{width:1200,height:850},deviceScaleFactor:1});p.setDefaultTimeout(30000);const errors=[];
 p.on('pageerror',e=>{errors.push(e.stack);console.error('SCENE_ERROR',e.stack)});
 await p.route('http://scene.test/**',route=>{const file=new URL(route.request().url()).pathname.slice(1);route.fulfill(file?{contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,file.startsWith('assets/')?'..':'../public',file))}:{contentType:'text/html',body:fixture})});
 await p.goto('http://scene.test/');await p.waitForFunction(()=>window.office?.framesShown>5);
 assert.equal(await p.evaluate(()=>office.room.name),'instrument-workshop');assert.equal(await p.evaluate(()=>office.assetResources.size),0,'default workshop needs no downloaded assets');
 await p.screenshot({path:'/tmp/bureau-scene-overview.png'});
 for(const provider of ['dot','codex']){
  const key=await p.evaluate(provider=>[...office.people.values()].find(p=>p.s.agent===provider).key,provider);
  await p.evaluate(key=>office.focusAgent(key),key);await p.waitForTimeout(120);await p.screenshot({path:'/tmp/bureau-scene-'+provider+'.png'});
  for(const angle of [0,Math.PI*.65,Math.PI*1.3]){
   await p.evaluate(angle=>{const t=office.controls.target;office.camera.position.set(t.x+Math.sin(angle)*25,t.y+15,t.z+Math.cos(angle)*25);office.camera.lookAt(t);office.controls.update()},angle);
   await p.waitForTimeout(80);
   const pick=await p.evaluate(key=>{const a=office.actors.get(key),r=office.canvas.getBoundingClientRect();let hit=false;a.obj.updateMatrixWorld(true);for(const m of a.pickMeshes){m.geometry.computeBoundingBox();const q=m.geometry.boundingBox.getCenter(a.anchor.clone());m.localToWorld(q);q.project(office.camera);if(office.pickAt(r.left+(q.x+1)*.5*office.cw,r.top+(1-q.y)*.5*office.ch)===key){hit=true;break;}}return hit},key);
   assert.ok(pick,provider+' body remains selectable after orbit '+angle);
   await p.screenshot({path:'/tmp/bureau-scene-'+provider+'-orbit-'+angle.toFixed(1)+'.png'});
  }
  await p.evaluate(()=>office.resetView());
 }
 // Unknown Dot never swings a limb or pulses a server light.
 const calm=await p.evaluate(()=>{const dot=[...office.actors.values()].find(a=>a.obj.name==='dot-mascot');return dot.signals.map(m=>({color:m.material.color.getHex(),emissive:m.material.emissive.getHex()}))});
 assert.ok(calm.length===6&&calm.every(x=>x.color===0xb5bbc6&&x.emissive===0));
 // Compare the same live frame workload with outlines toggled. These are
 // software Chromium measurements, not a substitute for native GPU evidence.
 const timings=[];
 for(const count of [1,10,25]){
  await p.evaluate(n=>{office.motionPaused=true;office.update(fixture(n));office.resetView()},count);
  await p.waitForFunction(n=>office.actors.size===n,count);await p.waitForTimeout(100);
  for(const outlines of [false,true]){
   await p.evaluate(v=>office.setOutlines(v),outlines);await p.waitForTimeout(80);
   const result=await p.evaluate(async()=>{const samples=[];for(let i=0;i<6;i++){const start=performance.now();office.gl.render(office.scene,office.camera);office.gl.getContext().finish();samples.push(performance.now()-start);await new Promise(requestAnimationFrame);}return{meanMs:samples.reduce((a,b)=>a+b)/samples.length,calls:office.gl.info.render.calls,memory:{...office.gl.info.memory},programs:office.gl.info.programs.length}});
   timings.push({count,outlines,...result});
  }
 }
 // Growth/shrink must retire every merged body and room allocation, including
 // outline shells borrowing those bodies. Stable repeated cycles expose leaks.
 const memory=[];
 for(let i=0;i<3;i++){
  await p.evaluate(()=>office.update(fixture(1)));await p.waitForFunction(()=>office.actors.size===1);
  await p.evaluate(()=>office.update(fixture(25)));await p.waitForFunction(()=>office.actors.size===25);
  memory.push(await p.evaluate(()=>({...office.gl.info.memory,programs:office.gl.info.programs.length})));
 }
 assert.ok(memory.at(-1).geometries<=memory[0].geometries+2,JSON.stringify(memory));
 assert.ok(memory.at(-1).textures<=memory[0].textures,JSON.stringify(memory));
 assert.ok(memory.at(-1).programs<=memory[0].programs,JSON.stringify(memory));
 await p.screenshot({path:'/tmp/bureau-scene-25.png'});
 const labelsFrame=await p.evaluate(()=>{office.showAgent=false;office.selectedKey=null;office.hoverKey=null;return office.framesShown});
 await p.waitForFunction(frame=>office.framesShown>frame,labelsFrame);
 const labelWidths=await p.evaluate(()=>office.labels.map(r=>r.x1-r.x0));
 assert.ok(labelWidths.length>0&&labelWidths.every(width=>Math.abs(width-18)<1e-6),'all rendered labels remain compact: '+JSON.stringify(labelWidths));
 for(const mode of ['motionPaused','reducedMotion']){
  await p.evaluate(mode=>{office.motionPaused=false;office.reducedMotion=false;office[mode]=true;office.update([])},mode);
  await p.waitForFunction(()=>office.people.size===0&&office.actors.size===0);
 }
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS procedural workshop, semantic Dot, 3 orbit body picks, 1/10/25 capacity, outlines on/off, labels, paused removal, bounded resources',JSON.stringify({timings,memory}));
 await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1});
