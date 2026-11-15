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
