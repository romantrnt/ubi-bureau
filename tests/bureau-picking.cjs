const {chromium}=require('playwright'),assert=require('assert/strict');
let browser;
(async()=>{browser=await chromium.launch({headless:true,executablePath:(process.env.WMAD_CHROMIUM||chromium.executablePath()),args:['--no-sandbox','--enable-unsafe-swiftshader']});
const p=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2,reducedMotion:'reduce'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(process.env.BUREAU_URL||'http://127.0.0.1:35711');await p.waitForFunction(()=>typeof office!=='undefined'&&office?.framesShown>8);
for(const provider of ['dot','codex']){
 const key=await p.evaluate(x=>[...office.people.values()].find(p=>p.s.agent===x)?.key,provider);assert.ok(key);
 await p.evaluate(k=>office.focusAgent(k),key);await p.waitForTimeout(500);
 const hit=await p.evaluate(key=>{const a=office.actors.get(key),rect=office.canvas.getBoundingClientRect(),hits=[];a.obj.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();const q=o.position.clone();o.geometry.boundingBox.getCenter(q);o.localToWorld(q);q.project(office.camera);const x=rect.left+(q.x+1)*.5*office.cw,y=rect.top+(1-q.y)*.5*office.ch;if(office.pickAt(x,y)===key)hits.push({x,y});});return hits[0]},key);
 assert.ok(hit,provider+' visible body must be selectable');await p.mouse.move(hit.x,hit.y);await p.waitForTimeout(100);assert.equal(await p.locator('#tip').getAttribute('data-key'),key);
 await p.mouse.click(hit.x,hit.y);await p.waitForTimeout(150);assert.equal(await p.locator('#detailBody').getAttribute('data-key'),key);
 await p.keyboard.press('Escape');await p.waitForTimeout(150);
 await p.setViewportSize({width:1100,height:760});await p.waitForTimeout(250);const a=await p.evaluate(k=>office.getAnchor(k),key);assert.ok(a&&a.x>30&&a.x<780&&a.y>60&&a.y<760,'resize keeps focus in scene');
 await p.setViewportSize({width:1440,height:900});await p.evaluate(()=>office.resetView());
}
assert.equal(errors.length,0,errors.join('\n'));console.log('PASS DPR2 body raycast, hover, click identity, Escape, focused resize for Dot and Codex');await browser.close();})().catch(async e=>{console.error(e);await browser?.close();process.exit(1)});
