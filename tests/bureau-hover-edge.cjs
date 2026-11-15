'use strict';
// A stationary cursor can intersect a body after orbiting while its label is
// above the viewport. Exercise the frame-driven hover path, not pointer().
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
let browser;
(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.WMAD_CHROMIUM||chromium.executablePath(),args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];
  page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const Source=EventSource;window.hoverEdgeSources=[];window.EventSource=class extends Source{constructor(...args){super(...args);hoverEdgeSources.push(this)}}});
  await page.goto(process.env.BUREAU_URL||'http://127.0.0.1:35711');
  await page.waitForFunction(()=>typeof office!=='undefined'&&office?.framesShown>3);
  const key=await page.evaluate(()=>{
    hoverEdgeSources.forEach(source=>source.close());
    const key=[...office.people.values()].find(person=>person.s.agent==='codex').key;
    office.motionPaused=true;office.focusAgent(key);hideTip();return key;
  });
  await page.waitForTimeout(150);
  const framed=await page.evaluate(key=>{
    const actor=office.actors.get(key),point=actor.anchor.clone();
    actor.labelAnchor.getWorldPosition(point);point.project(office.camera);
    const y=(1-point.y)*.5*office.ch;
    const shift=(y+8)*(office.camera.top-office.camera.bottom)/office.camera.zoom/office.ch;
    office.camera.top-=shift;office.camera.bottom-=shift;
    office.camera.updateProjectionMatrix();office.controls.update();office.drawAgentOverlay(office.ctx);
    const rect=office.canvas.getBoundingClientRect();let hit=null;
    for(const mesh of actor.pickMeshes){
      mesh.geometry.computeBoundingBox();
      const center=mesh.geometry.boundingBox.getCenter(actor.anchor.clone());
      mesh.localToWorld(center);center.project(office.camera);
      const x=rect.left+(center.x+1)*.5*office.cw,y=rect.top+(1-center.y)*.5*office.ch;
      if(office.pickAt(x,y)===key){hit={x,y};break;}
    }
    if(hit){office._pointerClient=hit;office.hoverKey=null;office.lastHoverPick=0;}
    return{anchor:office.getAnchor(key),hit,frames:office.framesShown};
  },key);
  assert.ok(framed.hit,'a visible body must remain raycastable with a clipped label');
  assert.equal(framed.anchor,null,'the label anchor is outside the viewport');
  await page.waitForFunction(before=>office.framesShown>before+2,framed.frames);
  assert.equal(await page.locator('#tip').getAttribute('data-key'),key);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS clipped-label body auto-hover, tooltip identity and continuing frames');
  await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
