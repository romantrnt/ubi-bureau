const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
const b=await chromium.launch({headless:true,executablePath:(process.env.WMAD_CHROMIUM||chromium.executablePath()),args:['--no-sandbox','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1}),errors=[];
p.on('pageerror',e=>errors.push(e.stack));
await p.goto('http://127.0.0.1:35711/?quality=high&dotOffice=1&lang=ru');
await p.waitForFunction(()=>typeof office!=='undefined'&&office?.framesShown>5,{timeout:60000});
await p.waitForTimeout(400);
console.log('SCENE',await p.evaluate(()=>({loaded:office.loaded,actors:office.actors.size,anchors:office.anchors.size,people:[...office.people.values()].map(x=>({key:x.key,title:x.s.title,status:x.s.status,mode:x.mode,agent:x.s.agent})),webgl:office.gl.getContext().getParameter(office.gl.getContext().VERSION)})));
await p.screenshot({path:'/tmp/bureau-overview.png'});
for(const provider of ['dot','codex']){
 const key=await p.evaluate(provider=>[...office.people.values()].find(p=>p.s.agent===provider)?.key,provider);
 if(key){await p.evaluate(key=>office.focusAgent(key),key);await p.waitForTimeout(350);await p.screenshot({path:'/tmp/bureau-'+provider+'.png'});await p.evaluate(()=>office.resetView());}
}
console.log('ERRORS',errors);
await b.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
