'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{},Image:class{}};vm.runInNewContext(fs.readFileSync(require.resolve('../public/office.js'),'utf8'),context);
const proto=context.window.Office.prototype;
function office(){const o=Object.create(proto);Object.assign(o,{people:new Map(),deskOf:new Map(),first:true,pal:{deskTop:"#eeeeee"},moveCat(){}});o.plan=o.buildPlan(0);return o;}
function session(n){return {key:'codex:'+n,agent:'codex',status:'thinking',startedAt:n};}
for(const mode of ['motionPaused','reducedMotion'])test(mode+' keeps new/removed sessions truthful without animation',()=>{
 const o=office();o.update([session(1)]);o[mode]=true;o.update([]);assert.equal(o.people.size,0);
 o.update([session(2)]);const p=o.people.get('codex:2');assert.equal(p.path.length,0);assert.equal(p.arriving,false);
 p.leaving=true;o.step(0);assert.equal(o.people.size,0);
});
test('focused actor may still leave when its session is removed',()=>{
 const o=office();o.update([session(1)]);o.focusedKey='codex:1';o.update([]);const p=o.people.get('codex:1');assert.ok(p.leaving);p.path=[];o.step(.01);assert.equal(o.people.size,0);
});
test('fresh discovery enters via the door, initial snapshot never stampedes',()=>{
 const o=office();o.update([session(1)]);assert.equal(o.people.get('codex:1').path.length,0);
 o.update([session(1),session(2)]);const p=o.people.get('codex:2');assert.ok(p.arriving);assert.ok(p.path.length);assert.equal(p.x,o.plan.door.x);assert.equal(p.y,o.plan.door.y);
});

test('unknown Dot stays stationary when discovery grows the room',()=>{
 const o=office(),dot={key:'dot:/root',agent:'dot',status:'unknown',startedAt:0};
 o.update([dot,session(1)]);const p=o.people.get(dot.key),oldPlan=o.plan;
 o.update([dot,...Array.from({length:12},(_,i)=>session(i+1))]);
 assert.notEqual(o.plan,oldPlan);assert.equal(o.people.get(dot.key),p);
 assert.equal(p.path.length,0);assert.equal(p.arriving,false);
 assert.equal(p.x,p.desk.seat.x);assert.equal(p.y,p.desk.seat.y);
 assert.ok(o.people.get('codex:12').arriving);
});

test('a fresh terminal/unknown snapshot cannot leave a walking live ghost',()=>{
 for(const status of ['done','interrupted','unknown']){
  const o=office(),busy={...session(1),status:'tool',presence:{live:true}};
  o.update([busy],{snapshot:[busy]});assert.equal(o.people.size,1);
  const current={...busy,status,presence:{live:false}};
  o.update([],{snapshot:[current]});
  assert.equal(o.people.size,0,status);assert.equal(o.deskOf.size,0,status);
 }
 const o=office(),busy=session(2);o.update([busy],{snapshot:[busy]});
 o.update([],{snapshot:[]});assert.equal(o.people.size,0,'removed source');
});

const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const filters=html.slice(html.indexOf('const matchAgent ='),html.indexOf('function render()',html.indexOf('const matchAgent =')));
function filterContext(sessions){const state={data:{sessions},agents:[],showSub:true,showIdle:false,search:'',statusFilter:'all',scope:'current'};const ctx={state,ACTIVE:new Set(['thinking','tool','typing']),agentNameFor:s=>s.id};vm.runInNewContext(filters,ctx);return ctx;}
test('completed history never populates scene and unknown stays discoverable',()=>{
 const rows=['thinking','tool','typing','waiting','error','done','idle','interrupted','unknown'].map(status=>({agent:'codex',status,id:status}));rows.push({agent:'dot',status:'unknown',id:'/root'});
 const ctx=filterContext(rows);const scene=vm.runInNewContext('rosterPool().filter(inScene)',ctx);
 assert.deepEqual(Array.from(scene,s=>s.status),['thinking','tool','typing','waiting','error','unknown']);
 assert.ok(ctx.visible().some(s=>s.agent==='codex'&&s.status==='unknown'));
 ctx.state.scope='history';assert.deepEqual(Array.from(ctx.visible(),s=>s.status),['done','interrupted']);
 assert.equal(vm.runInNewContext('rosterPool().filter(inScene)',ctx).length,scene.length);
 ctx.state.scope='current';ctx.state.statusFilter='unknown';assert.equal(ctx.visible().length,2);
});
