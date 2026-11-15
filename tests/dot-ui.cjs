const {chromium}=require('playwright'),assert=require('assert/strict');
(async()=>{
const b=await chromium.launch({headless:true,executablePath:process.env.HOME+'/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1400,height:900}}),errors=[];
p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:33363/?quality=high&dotOffice=1');
await p.waitForFunction(()=>typeof office!=='undefined'&&office?.framesShown>4,{timeout:60000});
await p.waitForSelector('[data-key="dot:/root"]');
assert.match(await p.locator('#dotConnection').textContent(),/снимок/);
assert.ok(await p.locator('#sideRows').textContent().then(s=>s.includes('DOT ·')&&s.includes('LOCAL ·')));
await p.screenshot({path:'/tmp/office-reference/office-qa.png'});
await p.click('[data-key="dot:/root"]');assert.equal(await p.locator('#detailBody .copy').count(),0);
assert.match(await p.locator('#detailBody').textContent(),/не live|Устарел/);
assert.equal(errors.length,0,errors.join('\n'));
console.log('3D, source separation, snapshot provenance, no false resume: PASS');await b.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
