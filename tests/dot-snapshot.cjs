const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {readDotSnapshot}=require('../src/dot-snapshot');
const {spawnSync}=require('node:child_process');
test('bounded snapshot and truthful stale status',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'dot-test-')),f=path.join(d,'snapshot.json'),now=Date.now();
 try{
 const missing=readDotSnapshot(f,now);assert.equal(missing.connection.available,false);assert.equal(missing.sessions.length,1);assert.equal(missing.sessions[0].id,'/root');assert.equal(missing.sessions[0].status,'unknown');assert.equal(missing.sessions[0].activeSubagents,null);
 fs.writeFileSync(f,JSON.stringify({version:1,observedAt:now,agents:[{id:'/root',title:"vas'",status:'running'},{id:'/root/test',title:'Review',status:'completed'}]}));
 let x=readDotSnapshot(f,now); assert.equal(x.sessions.length,1);assert.equal(x.sessions[0].status,'unknown');assert.equal(x.sessions[0].subagent,false);assert.equal(x.sessions[0].activeSubagents,null);
 x=readDotSnapshot(f,now+120001);assert.equal(x.connection.stale,true);assert.equal(x.sessions[0].status,'unknown');assert.equal(x.sessions[0].lastObservedStatus,'running');
 assert.equal(readDotSnapshot(f,now-10000).connection.available,false);
 fs.writeFileSync(f,'bad');assert.equal(readDotSnapshot(f,now).connection.available,false);
 for(const data of [null,[],{version:1,observedAt:-1,agents:[]},{version:1,observedAt:now,agents:Array(101).fill({id:'/root/x',status:'running'})}]){
 fs.writeFileSync(f,JSON.stringify(data));const bad=readDotSnapshot(f,now);assert.equal(bad.connection.available,false);assert.equal(bad.sessions.length,1);assert.equal(bad.sessions[0].status,'unknown');
 }
 fs.writeFileSync(f,JSON.stringify({version:1,observedAt:now,agents:[{id:'/root/a',status:'running'},{id:'/root/b',status:'waiting'}]}));
 const workers=readDotSnapshot(f,now);assert.equal(workers.sessions.length,1);assert.equal(workers.sessions[0].lastObservedStatus,null);assert.equal(workers.connection.live,false);assert.equal(workers.connection.activeSubagents,null);
 for(const status of [null,true,1,[],{}, {toString:null,valueOf:null}]){
 fs.writeFileSync(f,JSON.stringify({version:1,observedAt:now,agents:[{id:'/root',status}]}));
 let invalid;assert.doesNotThrow(()=>{invalid=readDotSnapshot(f,now);});assert.equal(invalid.connection.available,false);assert.equal(invalid.sessions[0].status,'unknown');
 }
 }finally{fs.rmSync(d,{recursive:true});}
});

test('snapshot importer validates every row, keeps prior observations on failure and displays one coordinator',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dot-import-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const file=path.join(home,'.local/state/agent-office/dot-snapshot.json');
 const run=data=>spawnSync(process.execPath,[path.join(__dirname,'../bin/update-dot-snapshot.js')],{
  env:{...process.env,HOME:home,USERPROFILE:home},input:JSON.stringify(data),encoding:'utf8',timeout:5000});
 const data={version:1,observedAt:Date.now(),agents:[{id:'/root',status:'running'},{id:'/root/review',status:'completed',parentId:'/root'}]};
 const accepted=run(data);assert.equal(accepted.status,0,accepted.stderr);assert.match(accepted.stdout,/remain unknown/);
 const saved=fs.readFileSync(file,'utf8');assert.deepEqual(JSON.parse(saved),data);
 assert.equal(readDotSnapshot(file).sessions.length,1);assert.equal(readDotSnapshot(file).sessions[0].status,'unknown');
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 for(const agents of [[{id:'/root',status:'running'},{id:'/root',status:'waiting'}],[{id:'/root',status:'running'},{id:'/root/bad',status:'fake'}],
  [{id:'/root',status:'running'},{id:'invalid id',status:'running'}],[{id:'/root',status:'running',parentId:'invalid id'}],
  [{id:'/root',status:{toString:null,valueOf:null}}]]){
  const rejected=run({...data,agents});assert.equal(rejected.status,1);assert.match(rejected.stderr,/Invalid snapshot schema/);assert.equal(fs.readFileSync(file,'utf8'),saved);
 }
 assert.equal(run({...data,observedAt:Date.now()+60000}).status,1);
 assert.equal(run({...data,agents:[]}).status,0,'an empty observation still represents one unknown coordinator');
 assert.equal(readDotSnapshot(file).sessions.length,1);
});
