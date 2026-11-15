'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http');
let browser,transport;let transportOnline=true;const transportClients=new Set();
(async()=>{
 transport=http.createServer((req,res)=>{
  // A non-200 response permanently closes EventSource in Chromium. While offline,
  // valid empty SSE responses end normally so the browser keeps its retry loop.
  if(!transportOnline){res.writeHead(200,{'Content-Type':'text/event-stream','Access-Control-Allow-Origin':'*'});res.end('retry: 300\n\n');return;}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Access-Control-Allow-Origin':'*'});
  transportClients.add(res);res.on('close',()=>transportClients.delete(res));
  const now=Date.now();res.write('retry: 300\n\ndata: '+JSON.stringify({now,sessions:[
   {id:'transport-tool',key:'codex:transport-tool',agent:'codex',title:'Transport fixture',status:'tool',activity:'npm test',lastEventAt:now,presence:{kind:'recent',source:'session-log',live:false,observedAt:now,stale:false}},
   {id:'/root',key:'dot:/root',agent:'dot',title:'Dot',status:'unknown',source:'dot-snapshot',activeSubagents:null}
  ],sources:{logs:{available:true,unreadableFiles:0},magpie:[]},dotConnection:{available:false}})+'\n\n');
 });
 await new Promise(resolve=>transport.listen(0,'127.0.0.1',resolve));
 const transportUrl='http://127.0.0.1:'+transport.address().port+'/events';
 browser=await chromium.launch({headless:true,executablePath:process.env.WMAD_CHROMIUM||chromium.executablePath(),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const p=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(url=>{const E=EventSource;window.streams=[];window.EventSource=class extends E{constructor(path,options){super(String(path)==='/events'?url:path,options);streams.push(this)}}},transportUrl);
 await p.goto(process.env.BUREAU_URL||'http://127.0.0.1:43500');await p.waitForFunction(()=>typeof office!=='undefined'&&office?.framesShown>2,null,{timeout:60000});
 console.log('STEP telemetry actual SSE socket failure/reconnect');
 // Destroy the actual SSE response; browser offline emulation does not close an existing stream.
 const originalActive=await p.evaluate(()=>state.data.sessions.filter(s=>ACTIVE.has(s.status)||s.status==='waiting').map(s=>s.key));
 assert.ok(originalActive.length,'fixture server must expose current activity');
 transportOnline=false;for(const response of transportClients)response.destroy();
 await p.waitForFunction(()=>!state.connected,null,{timeout:30000});
 assert.ok(await p.evaluate(()=>streams[0].readyState!==EventSource.CLOSED),'network loss keeps the native EventSource retry loop available');
 assert.equal(await p.evaluate(()=>state.data.sessions.some(s=>ACTIVE.has(s.status)||s.status==='waiting')),false,'transport failure cannot retain claimed current activity');
 transportOnline=true;
 await p.waitForFunction(keys=>state.connected&&keys.every(k=>state.data.sessions.some(s=>s.key===k&&(ACTIVE.has(s.status)||s.status==='waiting'))),originalActive,{timeout:60000});
 console.log('STEP telemetry evidence fields and source health');
 await p.evaluate(()=>{
  streams.forEach(s=>s.close());state.connected=true;const now=Date.now();window.fixture={now,sessions:[
   {id:'/root',key:'dot:/root',agent:'dot',title:'Dot',status:'unknown',source:'dot-snapshot',snapshotStale:true,observedAt:now-3600000,activeSubagents:null},
   {id:'tool',key:'codex:tool',agent:'codex',title:'Проверить сборку',status:'tool',activity:'exec_command: npm test',prompt:'Проверь изменённый компонент',model:'gpt-test',context:{used:12000,window:100000},today:{tokens:14000,turns:3},lastEventAt:now-10000,presence:{kind:'recent',source:'session-log',live:false,observedAt:now-10000,stale:false}},
   {id:'wait',key:'codex:wait',agent:'codex',title:'Нужен ответ',status:'waiting',lastEventAt:now-1000,presence:{kind:'recent',source:'session-log',live:false,observedAt:now-1000,stale:false}},
   {id:'done',key:'codex:done',agent:'codex',title:'Готовая задача',status:'done',reply:'Проверки завершены успешно',lastEventAt:now-60000},
   {id:'error',key:'codex:error',agent:'codex',title:'Старая ошибка',status:'error',lastEventAt:now-3600000,presence:{stale:true}},
   {id:'unknown',key:'codex:unknown',agent:'codex',title:'Нет свежих событий',status:'unknown',lastEventAt:now-3600000,presence:{kind:'unknown',source:'session-log',live:false,stale:true}}
  ],sources:{logs:{available:false,unreadableFiles:1},magpie:[{available:false,reason:'connection-failed'}]},dotConnection:{available:true,stale:true,observedAt:now-3600000}};
  onData(structuredClone(fixture));renderNow();
 });
 const row=p.locator('.srow[data-key="codex:tool"]');
 for(const text of ['exec_command: npm test','gpt-test','12%','14k','Журнал'])assert.ok((await row.innerText()).includes(text),text);
 assert.equal(await p.locator('.srow[data-key="dot:/root"] .telemetry').count(),0);
 assert.equal(await p.locator('.srow[data-key="codex:done"]').count(),0);
 assert.equal(await p.locator('#historyCount').innerText(),'2');
 await p.evaluate(()=>officeOpts.onHover(state.data.sessions[1],{x:600,y:400},false));
 for(const text of ['npm test','Проверь изменённый компонент','gpt-test','12%','Событие:'])assert.ok((await p.locator('#tip').innerText()).includes(text),text);
 await p.screenshot({path:'/tmp/ubi-v2-review/telemetry-evidence.png'});
 await p.locator('#sourceDetails').click();
 const ledger=p.locator('#sourcesDialog');
 assert.match(await ledger.locator('.today-row').filter({hasText:'Локальный поток'}).innerText(),/Подключён/,'transport may be connected while source discovery fails');
 assert.match(await ledger.locator('.today-row').filter({hasText:'Обнаружение журналов'}).innerText(),/Недоступно/);
 assert.match(await ledger.locator('.today-row').filter({hasText:'Недоступные файлы'}).innerText(),/1/);
 assert.match(await ledger.locator('.today-row').filter({hasText:'Magpie 1'}).innerText(),/Недоступен/);
 await p.keyboard.press('Escape');
 await p.evaluate(()=>{fixture.sources.magpie=[];onData(structuredClone(fixture));renderNow()});
 await p.locator('#sourceDetails').click();assert.match(await ledger.locator('.today-row').filter({hasText:'Magpie'}).innerText(),/Не настроен/);await p.keyboard.press('Escape');
 await p.locator('#historyScope').click();assert.match(await p.locator('.srow[data-key="codex:done"]').innerText(),/Проверки завершены успешно/);
 assert.equal(await p.locator('.srow[data-key="codex:done"] .ctx').count(),0);
 await p.locator('#currentScope').click();await p.locator('[data-filter="unknown"]').click();assert.equal(await p.locator('.srow').count(),2);
 await p.locator('[data-filter="all"]').click();await p.locator('#agentSearch').fill('нет такой сессии');assert.equal(await p.locator('.srow').count(),0);assert.ok(await p.locator('#sideRows .empty').isVisible());
 await p.locator('#agentSearch').fill('');
 console.log('STEP telemetry EventSource wiring and restored scene');
 // A lost SSE connection cannot leave busy actors or a claimed active feed.
 await p.evaluate(()=>streams[0].dispatchEvent(new Event('error')));
 assert.deepEqual(await p.evaluate(()=>state.data.sessions.filter(s=>['tool','wait'].includes(s.id)).map(s=>[s.id,s.status,s.presence.lastKnownStatus])),[['tool','unknown','tool'],['wait','unknown','waiting']]);
 assert.equal(await p.evaluate(()=>state.data.sessions.find(s=>s.id==='done').status),'done','disconnect preserves explicit terminal evidence');
 assert.ok(await p.locator('#conn').isVisible(),'SSE error exposes reconnect notice');
 assert.match(await p.locator('#dotConnection').innerText(),/поток недоступен/);
 await p.waitForFunction(()=>![...office.people.values()].some(p=>p.s.agent==='codex'));
 await p.evaluate(()=>streams[0].dispatchEvent(new MessageEvent('message',{data:JSON.stringify(fixture)})));
 await p.waitForFunction(()=>[...office.people.values()].some(p=>p.s.id==='tool'));
 assert.equal(await p.locator('#conn').isVisible(),false,'fresh SSE message clears reconnect notice');
 assert.equal(await p.evaluate(()=>state.connected),true);
 assert.equal(await p.evaluate(()=>contextBar({window:1000})), '');assert.equal(errors.length,0,errors.join('\n'));
 await browser.close();transport.closeAllConnections();await new Promise(resolve=>transport.close(resolve));console.log('PASS telemetry: actual socket loss/reconnect SSE transport, evidence, actual fields, history/stale error, unknown Dot, source failure, filters, disconnect clears active actors and reconnect restores.');
})().catch(async e=>{console.error(e);await browser?.close();transport?.closeAllConnections();transport?.close();process.exitCode=1});
