'use strict';
// Full local pipeline: new isolated Codex JSONL → Watcher → SSE → Three.js.
// Never writes user journals and never submits a model turn.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const {chromium}=require('playwright');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'bureau-lifecycle-'));
const env={...process.env,HOME:home,CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),GEMINI_CLI_HOME:home,BUREAU_PORT:'0',WMAD_NO_UPDATE_CHECK:'1'};
const snapshot=path.join(home,'.local/state/agent-office/dot-snapshot.json');fs.mkdirSync(path.dirname(snapshot),{recursive:true});
fs.writeFileSync(snapshot,JSON.stringify({version:1,observedAt:Date.now()-180000,agents:Array.from({length:7},(_,i)=>({id:'/fixture/'+i,title:'Снимок Dot '+i,status:'running'}))}));
let browser,server;const errors=[];let stderr='';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const logs=new Map();
function event(type,payload){return JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\n'}
function add(n){const name=path.join(env.CODEX_HOME,'sessions',new Date().toISOString().slice(0,10).replaceAll('-','/'),'rollout-'+id(n)+'.jsonl');fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,event('session_meta',{id:id(n),cwd:'/fixture/live-test'})+event('turn_context',{model:'fixture-model'})+event('event_msg',{type:'user_message',message:'Проверить новую задачу '+n})+event('event_msg',{type:'task_started'}));logs.set(n,name)}
async function until(page,fn,arg,timeout=30000){await page.waitForFunction(fn,arg,{timeout})}
for(let n=1;n<=7;n++)add(n);
(async()=>{
 server=spawn(process.execPath,[path.join(__dirname,'../bin/desktop-server.js')],{env,stdio:['ignore','pipe','pipe']});server.stderr.on('data',s=>stderr+=s);
 const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('server startup timeout '+stderr)),15000);server.stdout.on('data',s=>{output+=s;try{const v=JSON.parse(output.split('\n')[0]);clearTimeout(timer);resolve(v.port)}catch{}});server.on('error',reject)});
 browser=await chromium.launch({headless:true,executablePath:process.env.WMAD_CHROMIUM||chromium.executablePath(),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const p=await browser.newPage({viewport:{width:1100,height:740}});p.on('pageerror',e=>errors.push(e.stack));
 await p.addInitScript(()=>{const E=EventSource;window.streams=[];window.EventSource=class extends E{constructor(...a){super(...a);streams.push(this)}}});
 await p.goto(`http://127.0.0.1:${port}/?dotOffice=1`);await until(p,()=>typeof office!=='undefined'&&office?.framesShown>=5,null,60000);
 assert.equal(await p.evaluate(()=>office.actors.size),8);assert.equal(await p.evaluate(()=>office.plan.desks.length),12);
 const before=await p.evaluate(()=>{window.originalActors=new Map(office.actors);office.camera.zoom=1.15;office.camera.updateProjectionMatrix();return office.framesShown});
 const started=Date.now();add(8);await until(p,k=>state.data.sessions.some(s=>s.id===k),id(8));
 await until(p,f=>office.framesShown>f+4,before);
 assert.equal(errors.length,0,errors.join('\n'));
 const first=await p.evaluate(k=>{const a=[...office.people.values()].find(p=>p.s.id===k);return {frames:office.framesShown,cap:office.plan.desks.length,rods:office.rods.length,doorAngle:office.doorPivot.rotation.y,zoom:office.camera.zoom,arriving:a.arriving,path:a.path.length,distance:Math.hypot(a.x-office.plan.door.x,a.y-office.plan.door.y),identity:[...originalActors].every(([key,a])=>office.actors.get(key)===a),memory:{...office.gl.info.memory}}},id(8));
 assert.equal(first.cap,12);assert.equal(first.rods,0);assert.equal(first.identity,true);assert.equal(first.zoom,1.15);assert.equal(first.arriving,true);assert.ok(first.doorAngle>.02,'door visibly opens for new arrival');assert.ok(first.path>0,'new actor enters via a real path');
 console.log('PASS initial 8→9 discovery, continued frames, retained actors, door path',JSON.stringify({discoveryMs:Date.now()-started,...first}));
 // Add enough simultaneous sessions to cross two more capacity boundaries.
 for(let n=9;n<=16;n++)add(n);await until(p,()=>state.data.sessions.filter(s=>s.agent==='codex').length===16,null);
 const frames=await p.evaluate(()=>office.framesShown);await until(p,f=>office.framesShown>f+4,frames);
 assert.equal(await p.evaluate(()=>office.deskOf.size),17);assert.equal(await p.evaluate(()=>office.plan.desks.length),20);
 fs.appendFileSync(logs.get(8),event('event_msg',{type:'task_complete',last_agent_message:'Fixture complete'}));
 await until(p,k=>state.data.sessions.find(s=>s.id===k)?.status==='done',id(8));
 await until(p,k=>![...office.people.values()].some(person=>person.s.id===k)&&!office.actors.has('codex:'+k),id(8));
 // Grow/shrink repeated plans, preserving actors and bounded GPU allocation.
 await p.evaluate(()=>{streams.forEach(s=>s.close());window.fullFixture=state.data});
 const memory=[];for(let cycle=0;cycle<3;cycle++){
  await p.evaluate(()=>{onData({...fullFixture,sessions:fullFixture.sessions.filter(s=>s.agent==='dot')})});
  const f=await p.evaluate(()=>office.framesShown);await until(p,f=>office.framesShown>f+2,f);assert.equal(await p.evaluate(()=>office.plan.desks.length),8);
  await p.evaluate(()=>onData(fullFixture));const g=await p.evaluate(()=>office.framesShown);await until(p,f=>office.framesShown>f+2,g);assert.equal(await p.evaluate(()=>office.plan.desks.length),20);memory.push(await p.evaluate(()=>({...office.gl.info.memory})));
 }
 assert.ok(memory.at(-1).geometries<=memory[0].geometries+8,JSON.stringify(memory));assert.ok(memory.at(-1).textures<=memory[0].textures+1,JSON.stringify(memory));
 // Removed sessions disappear even with animation disabled; neither mode may
 // leave permanent ghost actors. Re-adding places actors without an entrance.
 for(const mode of ['motionPaused','reducedMotion']){
  await p.evaluate(mode=>{office[mode]=true;onData({...fullFixture,sessions:[]})},mode);
  await until(p,()=>office.people.size===0&&office.actors.size===0);
  await p.evaluate(()=>onData(fullFixture));await until(p,()=>office.actors.size===fullFixture.sessions.filter(inScene).length);
  assert.equal(await p.evaluate(()=>[...office.people.values()].some(p=>p.arriving)),false);
  await p.evaluate(mode=>office[mode]=false,mode);
 }
 console.log('PASS paused/reduced-motion removal and re-add');
 // The actual 3D label setting changes the rendered labels, not only storage.
 await p.evaluate(()=>{office.showAgent=false;office.hoverKey=null;office.selectedKey=null});
 const lf=await p.evaluate(()=>office.framesShown);await until(p,f=>office.framesShown>f+2,lf);
 assert.ok(await p.evaluate(()=>office.labels.length>0&&office.labels.every(r=>r.x1-r.x0<=18)));
 await p.evaluate(()=>office.showAgent=true);
 console.log('PASS 3D label visibility setting');
 // Interaction remains live after discovery, not merely server JSON.
 await p.locator('#agentSearch').fill('новую задачу');await p.locator('#agentSearch').fill('');await p.keyboard.press('m');await p.keyboard.press('m');
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS burst discovery, completion, repeat growth/shrink, bounded GPU resources, interactive UI',JSON.stringify(memory));
 await p.screenshot({path:path.join(os.tmpdir(),'bureau-lifecycle.png')});
})().catch(e=>{console.error(e);if(stderr)console.error(stderr);process.exitCode=1}).finally(async()=>{await browser?.close();server?.kill('SIGTERM');fs.rmSync(home,{recursive:true,force:true});});
