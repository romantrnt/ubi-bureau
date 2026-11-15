const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {readDotSnapshot}=require('../src/dot-snapshot');
test('bounded snapshot and truthful stale status',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'dot-test-')),f=path.join(d,'snapshot.json'),now=Date.now();
 try{
 assert.equal(readDotSnapshot(f,now).connection.available,false);
 fs.writeFileSync(f,JSON.stringify({version:1,observedAt:now,agents:[{id:'/root',title:"vas'",status:'running'},{id:'/root/test',title:'Review',status:'completed'}]}));
 let x=readDotSnapshot(f,now); assert.equal(x.sessions.length,2);assert.equal(x.sessions[0].status,'thinking');assert.equal(x.sessions[1].status,'done');assert.equal(x.sessions[1].subagent,true);
 x=readDotSnapshot(f,now+120001);assert.equal(x.connection.stale,true);assert.equal(x.sessions[0].status,'unknown');assert.equal(x.sessions[0].lastObservedStatus,'running');
 assert.equal(readDotSnapshot(f,now-10000).connection.available,false);
 fs.writeFileSync(f,'bad');assert.equal(readDotSnapshot(f,now).connection.available,false);
 }finally{fs.rmSync(d,{recursive:true});}
});
