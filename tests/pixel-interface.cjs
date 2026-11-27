'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.WMAD_CHROMIUM||chromium.executablePath(),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:960},locale:'ru-RU'}),errors=[];page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const Original=EventSource;window.qaStreams=[];window.EventSource=class extends Original{constructor(...a){super(...a);qaStreams.push(this)}}});
  let failConnections=false;const providers=['codex','claude','gemini','hermes','dsh','antigravity-cli','antigravity-app','antigravity-ide','copilot','opencode','omp','pi','kimi','grok'].map((id,i)=>({id,agent:id.startsWith('antigravity')?'antigravity':id,name:id==='dsh'?'DeepSeek Harness':id,status:['connected','ready','missing','unreadable','unavailable'][i%5],sessions:i===0?2:0,paths:[{path:'/fixture/'+id,exists:i<2,readable:i<2}],reason:i<2?'Readable local session source.':'No session records detected.',instructions:'Start this agent locally to create a session.',live:false,docsUrl:null}));
  await page.route('**/api/connections',r=>failConnections?r.fulfill({status:503,body:'Unavailable'}):r.fulfill({json:{checkedAt:Date.now(),discoveryIntervalMs:5000,live:false,providers}}));
  const update={supported:true,status:'current',currentVersion:'0.4.0',preferences:{mode:'notify',intervalHours:24},token:'qa-token',canInstall:true};
  await page.route('**/api/updates/state',r=>r.fulfill({json:update}));
  await page.goto((process.env.BUREAU_URL||'http://127.0.0.1:38325')+'/?native=1');
  await page.waitForFunction(()=>typeof office!=='undefined'&&office?.camera&&office.framesShown>2);
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('lang'),'en','English default despite Russian browser and prompt locale');
  assert.match(await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily),/Bureau Pixel/);
  assert.equal(await page.locator('#sceneMenu').isVisible(),false);assert.equal(await page.locator('#qualSeg').isVisible(),false);
  await page.evaluate(()=>{
   qaStreams.forEach(s=>s.close());const now=Date.now();state.connected=true;
   const base={agent:'codex',status:'tool',activity:'Running regression tests',lastEventAt:now,cwd:'/fixture/atlas',presence:{kind:'recent',source:'session-log',live:false,observedAt:now,stale:false},model:'qa-model',today:{tokens:4200,turns:3},context:{used:14000,window:200000}};
   onData({now,lang:'ru',sessions:[{...base,id:'qa-a',key:'codex:qa-a',title:'Build connection inventory'},{...base,id:'qa-b',key:'claude:qa-b',agent:'claude',title:'Review source evidence',status:'waiting',cwd:'/fixture/review'},{...base,id:'qa-finished',key:'codex:qa-finished',title:'Completed task',status:'done'},{...base,id:'qa-unknown',key:'codex:qa-unknown',title:'Older source record',status:'unknown',presence:{kind:'unknown',source:'session-log',live:false,stale:true,reason:'stale-evidence'}},{id:'/root',key:'dot:/root',agent:'dot',title:'Dot',source:'dot-snapshot',status:'unknown',observedAt:now-180000,snapshotStale:true,activeSubagents:null}],dotConnection:{available:true,observedAt:now-180000,stale:true}});renderNow();
  });
  assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('.srow').count(),4);
  assert.equal(await page.locator('#historyCount').innerText(),'1');
  await page.locator('#historyScope').click();assert.equal(await page.locator('.srow').count(),1);assert.equal(await page.evaluate(()=>office.people.has('codex:qa-finished')),false);
  await page.locator('#currentScope').click();await page.locator('[data-filter=unknown]').click();assert.equal(await page.locator('.srow').count(),2);
  await page.locator('.srow[data-key="dot:/root"]').click();assert.match(await page.locator('#detailBody').innerText(),/Live status and active subagent count are unavailable/);assert.equal(await page.locator('#detailBody .dmeta').count(),0);
  await page.keyboard.press('Escape');await page.locator('[data-filter=all]').click();
  await page.keyboard.press('Control+k');await page.waitForFunction(()=>document.activeElement.id==='agentSearch');
  await page.locator('#agentSearch').fill('review');assert.equal(await page.locator('.srow').count(),1);await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await page.locator('#detailBody').getAttribute('data-key'),'claude:qa-b');
  await page.keyboard.press('Escape');await page.locator('#agentSearch').fill('');
  await page.locator('#settingsMenu > summary').click();await page.locator('#appearance').selectOption('light');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal(await page.locator('#notify').isDisabled(),true);assert.match(await page.locator('#notifyNote').innerText(),/unavailable/);
  await page.locator('#appearance').selectOption('dark');await page.locator('#showAgent').uncheck();await page.locator('#showAgent').check();
  await page.locator('#bureauUpdates').click();await page.waitForFunction(()=>document.getElementById('updateState').textContent.includes('You are up to date'));assert.match(await page.locator('#bureauUpdatesDialog').innerText(),/Automatic checks/);await page.locator('#updateClose').click();
  await page.locator('#settingsMenu > summary').click();
  await page.locator('#bureauZoomIn').click();const z=await page.evaluate(()=>office.camera.zoom);assert.ok(z>1);
  await page.locator('#bureauSave').click();await page.locator('#bureauReset').click();assert.equal(await page.evaluate(()=>office.camera.zoom),1);await page.locator('#bureauRestore').click();assert.equal(await page.evaluate(()=>office.camera.zoom),z);
  await page.keyboard.press('+');assert.ok(await page.evaluate(()=>office.camera.zoom)>z);
  await page.locator('#bureauPause').click();assert.equal(await page.locator('#bureauPause').getAttribute('aria-pressed'),'true');
  await page.locator('#bureauHelp').click();assert.match(await page.locator('#bureauHelpTitle').innerText(),/Keyboard/);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='bureauHelp');
  await page.locator('#connectionsBtn').click();await page.waitForFunction(()=>document.querySelectorAll('.connection-row').length===14);assert.match(await page.locator('#connectionsBody').innerText(),/Records detected/);assert.match(await page.locator('#connectionsBody').innerText(),/Check permissions/);assert.match(await page.locator('#connectionsBody').innerText(),/DeepSeek Harness/);
  failConnections=true;await page.locator('#connectionsRefresh').click();await page.waitForFunction(()=>document.getElementById('connectionsBody').textContent.includes('unavailable'));assert.match(await page.locator('#connectionsBody').innerText(),/scan again/i);
  failConnections=false;await page.locator('#connectionsRefresh').click();await page.waitForFunction(()=>document.querySelectorAll('.connection-row').length===14);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='connectionsBtn');
  await page.evaluate(()=>{state.search='';state.statusFilter='all';renderNow();});await page.locator('#telemetryView').click();assert.equal(await page.locator('#main .card').count(),4);await page.locator('#sceneView').click();
  for(const width of [1440,1280,900,640]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(150);await page.evaluate(()=>office.resetView());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
   const controls=await page.locator('#connectionsBtn').boundingBox(),settings=await page.locator('#settingsMenu > summary').boundingBox();assert.ok(controls.x+controls.width<=settings.x+1,'header controls do not collide at '+width);
   assert.ok(await page.locator('#settingsMenu > summary [data-t]').isVisible(),'settings label visible at '+width);
   await page.screenshot({path:'/tmp/ubi-pixel-ui-'+width+'.png'});
  }
  await page.setViewportSize({width:1280,height:900});await page.reload();await page.waitForFunction(()=>typeof office!=='undefined'&&office?.camera&&office.framesShown>2);assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);console.log('PASS pixel UI: English, evidence, history, search, keyboard, saved 3D view, settings, updater, connection states/retry and 4 responsive widths.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
