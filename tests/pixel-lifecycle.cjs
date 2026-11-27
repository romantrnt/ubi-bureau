'use strict';
// Isolated Codex journals → production watcher → SSE → pixel renderer. No model call.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'bureau-pixel-life-'));
const inherited={...process.env};
for(const key of Object.keys(inherited))if(key.startsWith('WMAD_')||key.startsWith('BUREAU_')||["CODEX_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME", "ANTIGRAVITY_HOME", "ANTIGRAVITY_APP_HOME", "ANTIGRAVITY_IDE_HOME", "KIMI_CODE_HOME", "DSH_HOME", "GROK_HOME", "HERMES_HOME", "OPENCODE_DB", "LOCALAPPDATA", "PI_CODING_AGENT_SESSION_DIR", "PI_CODING_AGENT_DIR", "WMAD_OMP_SESSIONS_DIR", "OMP_CONFIG_DIR", "OMP_HOME"].includes(key))delete inherited[key];
const env={...inherited,HOME:home,CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),GEMINI_CLI_HOME:home,BUREAU_PORT:'0',WMAD_NO_UPDATE_CHECK:'1',XDG_DATA_HOME:path.join(home,'data'),HERMES_HOME:path.join(home,'.hermes')};
let browser,server,stderr='';const errors=[],logs=new Map();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const event=(type,payload)=>JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\n';
function add(n){const file=path.join(env.CODEX_HOME,'sessions','2026','11','27','rollout-'+id(n)+'.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,event('session_meta',{id:id(n),cwd:'/fixture/pixel-release'})+event('turn_context',{model:'fixture-model'})+event('event_msg',{type:'user_message',message:'Verify pixel workspace '+n})+event('event_msg',{type:'task_started'}));logs.set(n,file)}
for(let i=1;i<=7;i++)add(i);
(async()=>{
 server=spawn(process.execPath,[path.join(__dirname,'../bin/desktop-server.js')],{env,stdio:['ignore','pipe','pipe']});server.stderr.on('data',s=>stderr+=s);
 const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('server startup timeout '+stderr)),15000);server.stdout.on('data',s=>{output+=s;try{const v=JSON.parse(output.split('\n')[0]);clearTimeout(timer);resolve(v.port)}catch{}});server.once('error',reject)});
 browser=await chromium.launch({headless:true,executablePath:process.env.WMAD_CHROMIUM||chromium.executablePath(),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:820},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__streams=[];const E=EventSource;window.EventSource=class extends E{constructor(...args){super(...args);__streams.push(this)}}});
 await page.goto(`http://127.0.0.1:${port}/?native=1`);
 await page.waitForFunction(()=>typeof office!=='undefined'&&!!office?.gl && !!office?.camera&&office.framesShown>4);
 assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');
 assert.equal(await page.evaluate(()=>office.people.size),8);
 const original=await page.evaluate(()=>{window.__people=new Map(office.people);office.camera.zoom=1.2;office.camera.updateProjectionMatrix();return office.camera?.zoom||office.cam?.zoom||office.cam?.z});
 const start=Date.now();add(8);
 await page.waitForFunction(k=>state.data.sessions.some(s=>s.id===k)&&office.people.has('codex:'+k),id(8));
 const discoveryMs=Date.now()-start;
 assert(await page.evaluate(()=>[...__people].every(([k,v])=>office.people.get(k)===v)),'new sessions preserve existing actor identities');
 assert.equal(await page.evaluate(()=>office.camera?.zoom||office.cam?.zoom||office.cam?.z),original,'discovery preserves camera zoom');
 await page.locator('#bureauPause').click();
 fs.appendFileSync(logs.get(8),event('event_msg',{type:'task_complete',last_agent_message:'Pixel fixture complete'}));
 await page.waitForFunction(k=>state.data.sessions.find(s=>s.id===k)?.status==='done'&&!office.people.has('codex:'+k),id(8));
 for(let n=9;n<=30;n++)add(n);
 await page.waitForFunction(()=>state.data.sessions.filter(s=>s.agent==='codex').length===30&&office.people.size===30);
 const frame=await page.evaluate(()=>office.framesShown);await page.waitForFunction(f=>office.framesShown>f+3,frame);
 assert(await page.evaluate(()=>office.plan.desks.length>=office.people.size),'room fits every current agent');
 const dot=await page.evaluate(()=>{const rows=state.data.sessions.filter(s=>s.agent==='dot');return{count:rows.length,status:rows[0].status,workers:rows[0].activeSubagents}});
 assert.deepEqual(dot,{count:1,status:'unknown',workers:null});
 // A transport failure must immediately retire unconfirmed work, even paused.
 server.kill('SIGTERM'); // Close the real SSE socket, rather than dispatching a synthetic error.
 await page.waitForFunction(()=>!state.connected);
 assert.equal(await page.evaluate(()=>[...office.people.values()].filter(p=>['thinking','tool','typing','waiting'].includes(p.s.status)).length),0);
 assert.equal(errors.length,0,errors.join('\n'));
 await page.screenshot({path:'/tmp/ubi-pixel-lifecycle.png'});
 console.log('PASS pixel lifecycle: production discovery, identity, zoom, paused completion, 30 journals, one unknown Dot, disconnect; discoveryMs='+discoveryMs);
})().catch(e=>{console.error(e);if(stderr)console.error(stderr);process.exitCode=1}).finally(async()=>{await browser?.close();if(server){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,3000).unref()})}fs.rmSync(home,{recursive:true,force:true});});
