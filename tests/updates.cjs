'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const fsp=fs.promises;const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const http=require('node:http');
const core=require('../src/update-core');const {Updates,updateRoute,preferences}=require('../src/updates');
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const wrong=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
function image(byte){const b=Buffer.alloc(100000,byte);Buffer.from([127,69,76,70,2,1,1,0,65,73,2]).copy(b);b.writeUInt16LE(62,18);return b;}
const old=image(1),next=image(2);
function signed(version='0.2.0',bytes=next){const p=core.manifestPayload(version,bytes.length,crypto.createHash('sha256').update(bytes).digest('hex'));return crypto.sign('RSA-SHA256',Buffer.from(p),pair.privateKey).toString('base64')+'\n'+p;}
function signRaw(p){return crypto.sign('RSA-SHA256',Buffer.from(p),pair.privateKey).toString('base64')+'\n'+p;}
async function fixture(t){const d=await fsp.mkdtemp(path.join(os.tmpdir(),'ubi-updater-test-'));await fsp.chmod(d,0o700);t.after(()=>fsp.rm(d,{recursive:true,force:true}));const target=path.join(d,'Ubi.AppImage'),stage=path.join(d,'stage');await fsp.writeFile(target,old,{mode:0o755});await fsp.writeFile(stage,next,{mode:0o600});return {d,target,stage};}
const options={publicKey:pair.publicKey};
test('strict version and signed canonical manifest',()=>{
  assert.equal(core.versionCode('1.2.3'),1002003);assert.equal(core.parseManifest(signed(),pair.publicKey).version,'0.2.0');
  for(const v of ['01.2.3','1.2','1.2.3-beta','-1.2.3','1000.1.1','1.2.3\n'])assert.throws(()=>core.versionCode(v));
  assert.throws(()=>core.parseManifest(signed(),wrong.publicKey),/signature/);
  assert.throws(()=>core.parseManifest(signed().replace('0.2.0','0.3.0'),pair.publicKey),/signature/);
  const payload=signed().split('\n').slice(1).join('\n');
  for(const p of [payload+'extra=1\n',payload.replace('version_code=2000','version_code=2001'),payload.replace('size=100000','size=999999999'),payload.replace('updater_min=1','updater_min=2'),payload.replace('platform=linux-x86_64','platform=linux-aarch64'),payload.replaceAll('\n','\r\n')])assert.throws(()=>core.parseManifest(signRaw(p),pair.publicKey));
  assert.throws(()=>core.parseManifest(Buffer.alloc(17000),pair.publicKey),/size/);
  assert.throws(()=>core.parseManifest('!'+signed(),pair.publicKey),/encoding/);
});
test('only bounded fixed GitHub HTTPS hosts and Type2 x86_64 headers',()=>{
  for(const u of ['https://github.com/x','https://release-assets.githubusercontent.com/a?token=foo','https://objects.githubusercontent.com/a'])assert.ok(core.allowedUrl(u));
  for(const u of ['http://github.com/a','https://github.com.evil.org/a','https://github.com@evil.org','https://a@github.com/a','https://github.com:444/a','https://github.com/a#b','https://github.com/\\evil','https://github.com/a\n','file:///tmp/a'])assert.equal(core.allowedUrl(u),false,u);
  assert.ok(core.imageHeader(next));const bad=Buffer.from(next);bad[18]=0;assert.equal(core.imageHeader(bad),false);
});
test('atomic install makes an independent backup, signed private receipt and no temporary files',async t=>{
  const f=await fixture(t);const result=await core.installUpdate(f.target,f.stage,signed(),'0.1.0',options);
  assert.deepEqual(await fsp.readFile(f.target),next);assert.deepEqual(await fsp.readFile(result.backupPath),old);
  assert.notEqual((await fsp.stat(f.target)).ino,(await fsp.stat(result.backupPath)).ino);
  assert.equal((await fsp.stat(f.target)).mode&0o777,0o755);
  const receipt=f.target+'.update-manifest';assert.equal((await fsp.stat(receipt)).mode&0o777,0o600);assert.equal(core.parseManifest(await fsp.readFile(receipt),pair.publicKey).version,'0.2.0');
  assert.equal((await fsp.readdir(f.d)).some(n=>n.startsWith('.ubi-update-')||n.endsWith('update-lock')),false);
});
test('tampered staged bytes never replace the original',async t=>{const f=await fixture(t);await fsp.writeFile(f.stage,image(3));await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',options),/checksum/);assert.deepEqual(await fsp.readFile(f.target),old);assert.equal((await fsp.readdir(f.d)).some(n=>n.includes('update-lock')||n.startsWith('.ubi-')),false);});
test('cancel and wrong signatures preserve target',async t=>{const f=await fixture(t);const c=new AbortController();c.abort();await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',{...options,signal:c.signal}),/cancelled/);await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',{publicKey:wrong.publicKey}),/signature/);assert.deepEqual(await fsp.readFile(f.target),old);});
test('refuse downgrade and replay below signed receipt, allow exact retry after prepared receipt',async t=>{
  const f=await fixture(t);await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.2.0',options),/not newer/);
  await fsp.writeFile(f.target+'.update-manifest',signed('0.3.0'),{mode:0o600});await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',options),/rollback/);
  await fsp.writeFile(f.target+'.update-manifest',signed());await core.installUpdate(f.target,f.stage,signed(),'0.1.0',options);assert.deepEqual(await fsp.readFile(f.target),next);
});
test('refuse symlink, hardlink, shared target/directory, unsafe stage and receipts',async t=>{
  const f=await fixture(t),link=path.join(f.d,'link');await fsp.symlink(f.target,link);assert.equal((await core.probeTarget(link)).canInstall,false);await fsp.unlink(link);await fsp.link(f.target,link);assert.equal((await core.probeTarget(f.target)).canInstall,false);await fsp.unlink(link);
  await fsp.chmod(f.target,0o775);assert.equal((await core.probeTarget(f.target)).canInstall,false);await fsp.chmod(f.target,0o755);
  await fsp.chmod(f.d,0o777);assert.equal((await core.probeTarget(f.target)).canInstall,false);await fsp.chmod(f.d,0o700);
  await fsp.chmod(f.stage,0o644);await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',options),/Unsafe staged/);await fsp.chmod(f.stage,0o600);
  await fsp.symlink(f.target,f.target+'.update-manifest');await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',options));assert.deepEqual(await fsp.readFile(f.target),old);
});
test('exclusive update lock never replaces target or removes another lock',async t=>{const f=await fixture(t);await fsp.writeFile(f.target+'.update-lock','existing',{mode:0o600});await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',options),/lock/);assert.equal(await fsp.readFile(f.target+'.update-lock','utf8'),'existing');assert.deepEqual(await fsp.readFile(f.target),old);});
test('preferences validation, atomic persistence and source-mode no network',async t=>{
  const f=await fixture(t),dir=path.join(f.d,'config');const a=new Updates({configDir:dir});assert.equal(a.snapshot().supported,false);assert.equal(a.timer,undefined);
  for(const value of [{mode:'install',intervalHours:24},{mode:'notify',intervalHours:0},{mode:'notify',intervalHours:24,skippedVersion:'../foo'}])assert.throws(()=>preferences(value));
  a.savePreferences({mode:'download',intervalHours:6,skippedVersion:'0.2.0'});assert.equal(fs.statSync(path.join(dir,'updates.json')).mode&0o777,0o600);
  const b=new Updates({configDir:dir});b.readPreferences();assert.deepEqual(b.prefs,{mode:'download',intervalHours:6,skippedVersion:'0.2.0'});await a.close();await b.close();
});
test('HTTP update API rejects cross-origin, wrong Host, missing Origin/token, non-JSON and oversized bodies',async t=>{
  const manager=new Updates();const server=http.createServer((q,r)=>updateRoute(q,r,manager,server.address().port)||r.end('other'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const origin=`http://127.0.0.1:${server.address().port}`;
  const get=await fetch(origin+'/api/updates/state');assert.equal(get.status,200);const state=await get.json();assert.equal(state.token.length,64);assert.equal(state.supported,false);
  assert.equal((await fetch(origin+'/api/updates/state',{headers:{Origin:'https://evil.test'}})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{http.get(origin+'/api/updates/state',{headers:{Host:'evil.test'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(wrongHost,403);
  const post=(headers,body)=>fetch(origin+'/api/updates/action',{method:'POST',headers,body});
  assert.equal((await post({'Content-Type':'application/json'},JSON.stringify({token:state.token,action:'check'}))).status,403);
  assert.equal((await post({Origin:origin,'Content-Type':'application/json'},JSON.stringify({token:'0'.repeat(64),action:'check'}))).status,403);
  assert.equal((await post({Origin:origin,'Content-Type':'text/plain'},'{}')).status,403);
  assert.equal((await post({Origin:origin,'Content-Type':'application/json'},'x'.repeat(5000))).status,413);
  assert.equal((await post({Origin:origin,'Content-Type':'application/json'},JSON.stringify({token:state.token,action:'check'}))).status,400);
});
test('manager serializes actions, cancels downloads, skips persistently and never installs automatically',async t=>{
  const f=await fixture(t);const originals={checkUpdate:core.checkUpdate,downloadUpdate:core.downloadUpdate,installUpdate:core.installUpdate,cleanupStage:core.cleanupStage};
  t.after(()=>Object.assign(core,originals));let installs=0,downloads=0;
  core.checkUpdate=async()=>core.parseManifest(signed(),pair.publicKey);core.cleanupStage=async()=>{};
  core.downloadUpdate=async(_e,_v,{signal})=>{downloads++;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,30);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'));},{once:true});});return '/synthetic/candidate.AppImage';};
  core.installUpdate=async()=>{installs++;return {backupPath:'/synthetic/backup'};};
  const a=new Updates({enabled:true,target:f.target,configDir:path.join(f.d,'prefs'),currentVersion:'0.1.0'});await a.ready;a.savePreferences({mode:'download',intervalHours:1});
  await a.action('check',true);await assert.rejects(a.action('check'),/already/);await a.job;assert.equal(downloads,1);assert.equal(installs,0);assert.equal(a.state.status,'ready');
  await a.action('install');await a.job;assert.equal(installs,1);assert.equal(a.state.status,'installed');assert.ok(a.state.restartRequired);await assert.rejects(a.action('check'),/reopen/);await a.close();
  const b=new Updates({enabled:true,target:f.target,configDir:path.join(f.d,'prefs2'),currentVersion:'0.1.0'});await b.ready;
  await b.action('check');await b.job;await b.action('download');await b.action('cancel');await b.job;assert.equal(b.state.status,'cancelled');assert.equal(b.staged,null);
  await b.action('skip');assert.equal(b.prefs.skippedVersion,'0.2.0');await b.action('check',true);await b.job;assert.equal(b.state.status,'idle');assert.equal(b.state.availableVersion,null);
  await b.action('check');await b.job;assert.equal(b.prefs.skippedVersion,null);assert.equal(b.state.status,'available');await b.close();
});
test('unsafe preferences disable automatic network instead of restoring notify defaults',async t=>{
  const f=await fixture(t),dir=path.join(f.d,'prefs');await fsp.mkdir(dir,{mode:0o755});
  const a=new Updates({enabled:true,target:f.target,configDir:dir});await a.ready;assert.equal(a.prefs.mode,'off');assert.equal(a.timer,undefined);assert.match(a.state.error,/disabled/);await a.close();
});
test('FIFO files are rejected without blocking the event loop or filesystem worker',async t=>{
  const f=await fixture(t);const {execFileSync}=require('node:child_process');const dir=path.join(f.d,'prefs');await fsp.mkdir(dir,{mode:0o700});execFileSync('mkfifo',[path.join(dir,'updates.json')]);
  const a=new Updates({enabled:true,target:f.target,configDir:dir});await a.ready;assert.equal(a.prefs.mode,'off');assert.match(a.state.error,/Unsafe/);await a.close();
  const fifo=path.join(f.d,'fifo');execFileSync('mkfifo',[fifo]);assert.equal((await core.probeTarget(fifo)).canInstall,false);
  await fsp.unlink(f.stage);execFileSync('mkfifo',[f.stage]);await assert.rejects(core.installUpdate(f.target,f.stage,signed(),'0.1.0',options),/Unsafe/);
});
test('HTTPS downloader rejects unsafe redirects, overflow, bad hashes and incomplete bodies without executing files',async t=>{
  const https=require('node:https');const {PassThrough}=require('node:stream');const {EventEmitter}=require('node:events');const original=https.get;
  t.after(()=>{https.get=original;});let responses=[],requested=[];
  https.get=(url,opts)=>{requested.push(url);const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>{};queueMicrotask(()=>{const value=responses.shift();if(!value){req.emit('error',new Error('no mock'));return;}const res=new PassThrough();res.statusCode=value.status||200;res.headers=value.headers||{};res.rawHeaders=Object.entries(res.headers).flat();req.emit('response',res);res.end(value.body||Buffer.alloc(0));});return req;};
  responses=[{body:Buffer.from(signed())}];assert.equal((await core.checkUpdate('0.1.0',options)).version,'0.2.0');
  responses=[{status:302,headers:{location:'https://evil.test/payload'}}];requested=[];await assert.rejects(core.checkUpdate('0.1.0',options),/Untrusted/);assert.equal(requested.length,1);
  responses=[{body:Buffer.alloc(17000)}];await assert.rejects(core.checkUpdate('0.1.0',options),/size/);
  for(const body of [next.subarray(0,next.length-1),image(3),Buffer.concat([next,Buffer.from([0])])]){responses=[{body}];await assert.rejects(core.downloadUpdate(signed(),'0.1.0',options),/verification|size/);}
  responses=[{status:302,headers:{location:'https://release-assets.githubusercontent.com/good'}},{body:next}];const stage=await core.downloadUpdate(signed(),'0.1.0',options);assert.deepEqual(await fsp.readFile(stage),next);assert.equal((await fsp.stat(stage)).mode&0o777,0o600);await core.cleanupStage(stage);assert.equal(fs.existsSync(stage),false);
});
test('late cancellation after a download resolves discards the stage instead of announcing ready',async t=>{
  const f=await fixture(t), saved={downloadUpdate:core.downloadUpdate,cleanupStage:core.cleanupStage};t.after(()=>Object.assign(core,saved));
  let finish, removed=false;core.cleanupStage=async p=>{if(p==='/synthetic/late')removed=true;};core.downloadUpdate=()=>new Promise(resolve=>{finish=resolve;});
  const a=new Updates({enabled:true,target:f.target,configDir:path.join(f.d,'late-prefs'),currentVersion:'0.1.0'});await a.ready;a.manifest=core.parseManifest(signed(),pair.publicKey);a.state.availableVersion='0.2.0';
  await a.action('download');while(!finish)await new Promise(r=>setImmediate(r));await a.action('cancel');finish('/synthetic/late');await a.job;
  assert.equal(a.state.status,'cancelled');assert.equal(a.staged,null);assert.equal(removed,true);await a.close();
});
test('update route tolerates a closed listening address while a request still has its socket port',async t=>{
  const {EventEmitter}=require('node:events');const {createServer}=require('../src/server');const watcher=new EventEmitter();watcher.sessions=()=>[];
  const server=createServer(watcher,{demo:true,privacy:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  // Simulate the shutdown window: listener address is gone, accepted socket remains valid.
  server.address=()=>null;t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const response=await fetch(`http://127.0.0.1:${port}/api/updates/state`);assert.equal(response.status,200);assert.equal((await response.json()).supported,false);
});
