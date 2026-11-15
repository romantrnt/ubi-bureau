'use strict';
// Signed AppImage updates. No downloaded code is executed by this module.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const https = require('node:https');
const C = fs.constants;
const MAX_MANIFEST = 16384, MAX_IMAGE = 512 * 1024 * 1024;
const REPO = 'https://github.com/romantrnt/ubi-bureau';
const MANIFEST_URL = `${REPO}/releases/latest/download/update-manifest.txt`;
const PUBLIC_KEY = path.join(__dirname, '../assets/update-public-key.pem');
const fail = message => { throw new Error(message); };
const cancelled = signal => { if (signal?.aborted) fail('Update cancelled'); };
function versionCode(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.test(version)) fail('Invalid release version');
  return version.split('.').reduce((n, x) => n * 1000 + Number(x), 0);
}
function manifestPayload(version, size, sha256) {
  const code = versionCode(version);
  if (!Number.isSafeInteger(size) || size < 64 || size > MAX_IMAGE || !/^[a-f0-9]{64}$/.test(sha256)) fail('Invalid image metadata');
  return `ubi-bureau-update-v1\nversion=${version}\nversion_code=${code}\nplatform=linux-x86_64\nupdater_min=1\nsize=${size}\nsha256=${sha256}\n`;
}
function parseManifest(envelope, publicKey = fs.readFileSync(PUBLIC_KEY)) {
  if (!Buffer.isBuffer(envelope)) envelope = Buffer.from(envelope);
  if (!envelope.length || envelope.length > MAX_MANIFEST) fail('Invalid manifest size');
  const split = envelope.indexOf(10);
  if (split < 1) fail('Missing manifest signature');
  const sigBytes = envelope.subarray(0, split);
  if ([...sigBytes].some(x=>x>127)) fail('Non-canonical signature encoding');
  const encoded = sigBytes.toString('ascii');
  const signature = Buffer.from(encoded, 'base64');
  const payload = envelope.subarray(split + 1);
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048 || signature.length !== key.asymmetricKeyDetails.modulusLength / 8 || signature.toString('base64') !== encoded) fail('Invalid signing identity or signature encoding');
  if (!crypto.verify('RSA-SHA256', payload, {key, padding:crypto.constants.RSA_PKCS1_PADDING}, signature)) fail('Release signature verification failed');
  if ([...payload].some(x => x !== 10 && (x < 32 || x > 126))) fail('Non-canonical manifest');
  const text = payload.toString('ascii');
  const match = /^ubi-bureau-update-v1\nversion=(.+)\nversion_code=(0|[1-9]\d*)\nplatform=linux-x86_64\nupdater_min=1\nsize=([1-9]\d*)\nsha256=([a-f0-9]{64})\n$/.exec(text);
  if (!match) fail('Unsupported or malformed update manifest');
  const [,version,code,size,sha256] = match;
  if (+code !== versionCode(version) || manifestPayload(version, +size, sha256) !== text) fail('Non-canonical update metadata');
  return {version, code:+code, size:+size, sha256, envelope:envelope.toString('ascii'), url:`${REPO}/releases/download/v${version}/Ubi_Bureau-${version}-x86_64.AppImage`};
}
function allowedUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value)) return false;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443') && ['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname); } catch { return false; }
}
function imageHeader(b) {
  return b.length >= 64 && b.subarray(0,4).equals(Buffer.from([127,69,76,70])) && b[4] === 2 && b[5] === 1 && b[8] === 65 && b[9] === 73 && b[10] === 2 && b.readUInt16LE(18) === 62;
}
async function transfer(url, {limit, signal, write, progress = () => {}}) {
  const deadline = Date.now() + (limit <= MAX_MANIFEST ? 90000 : 600000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    cancelled(signal);
    if (!allowedUrl(url)) fail('Untrusted update URL');
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail('Update transfer timed out');
    let timer;
    const req = https.get(url, {signal, minVersion:'TLSv1.2', maxHeaderSize:16384, headers:{'User-Agent':'Ubi-Bureau-Updater/1','Accept-Encoding':'identity'} });
    timer = setTimeout(() => req.destroy(new Error('Update transfer timed out')), remaining);
    req.setTimeout(30000, () => req.destroy(new Error('Update transfer stalled')));
    try {
      const res = await new Promise((resolve,reject) => {req.once('response',resolve); req.once('error',reject);});
      if ([301,302,303,307,308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (res.rawHeaders.filter((x,i)=>i%2===0&&x.toLowerCase()==='location').length !== 1) {res.destroy(); fail('Ambiguous update redirect');}
        res.destroy();
        if (!location || location.length > 8192 || redirects === 5) fail('Invalid update redirect');
        url = new URL(location,url).href;
        continue;
      }
      if (res.statusCode !== 200) {res.destroy(); fail(res.statusCode === 404 ? 'No signed update published yet' : `Update server returned HTTP ${res.statusCode}`);}
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {res.destroy(); fail('Compressed update transfer refused');}
      const length = res.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || +length > limit)) {res.destroy(); fail('Update exceeds allowed size');}
      let received = 0;
      for await (const chunk of res) {
        cancelled(signal); received += chunk.length;
        if (received > limit) fail('Update exceeds allowed size');
        await write(chunk); progress({received,total:limit});
      }
      return received;
    } finally {clearTimeout(timer); req.destroy();}
  }
  fail('Too many update redirects');
}
async function checkUpdate(currentVersion, {signal, publicKey} = {}) {
  const chunks = [];
  await transfer(MANIFEST_URL, {limit:MAX_MANIFEST,signal,write:b=>chunks.push(b)});
  const manifest = parseManifest(Buffer.concat(chunks),publicKey);
  if (manifest.code < versionCode(currentVersion)) fail('Published update is older than this application');
  return manifest;
}
function secureFile(s, privateFile = false) {
  return s.isFile() && s.uid === process.getuid() && s.nlink === 1 && !(s.mode & (privateFile ? 0o077 : 0o022)) && !(s.mode & 0o6000);
}
async function openTarget(target) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || !target || !path.isAbsolute(target) || target.includes('\0')) fail('Self-update requires a Linux x86_64 AppImage');
  const base = path.basename(target);
  if (base === '.' || base === '..' || base.length > 180) fail('Unsupported AppImage path');
  const parent = await fsp.realpath(path.dirname(target));
  const dir = await fsp.open(parent,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);
  let file;
  try {
    const ds = await dir.stat();
    if (ds.uid !== process.getuid() || ds.mode & 0o022 || !(ds.mode & 0o200)) fail('AppImage directory must be owned by you and not writable by others');
    const anchored = `/proc/self/fd/${dir.fd}`;
    file = await fsp.open(`${anchored}/${base}`,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);
    const stat = await file.stat({bigint:true});
    const normal = await file.stat();
    if (!secureFile(normal) || !(normal.mode & 0o100) || !(normal.mode & 0o200) || normal.size > MAX_IMAGE) fail('AppImage must be an owned writable executable regular file, not a link');
    const header = Buffer.alloc(64); await file.read(header,0,64,0);
    if (!imageHeader(header)) fail('Current file is not an x86_64 Type 2 AppImage');
    return {dir,file,stat,mode:normal.mode & 0o755,base,parent,anchored,targetPath:path.join(parent,base)};
  } catch (e) {await file?.close();await dir.close();throw e;}
}
async function probeTarget(target) {
  try {const t = await openTarget(target); await t.file.close();await t.dir.close();return {canInstall:true,targetPath:t.targetPath,reason:null};}
  catch(e) {return {canInstall:false,targetPath:target || null,reason:e.message};}
}
async function unchanged(t) {
  const s = await fsp.lstat(`${t.anchored}/${t.base}`,{bigint:true});
  if (!s.isFile() || ['dev','ino','size','mtimeNs','ctimeNs'].some(k=>s[k] !== t.stat[k])) fail('AppImage changed during update; reopen the application');
}
async function writeAll(file, data) {
  let done = 0;
  while (done < data.length) {const {bytesWritten} = await file.write(data,done,data.length-done); if (!bytesWritten) fail('Short update write');done += bytesWritten;}
}
async function copyVerified(input, output, {size, sha256,signal, headerRequired=true}) {
  const buffer = Buffer.alloc(65536), hash = crypto.createHash('sha256');
  let total = 0, first = true;
  for (;;) {
    cancelled(signal);
    const {bytesRead} = await input.read(buffer,0,buffer.length,total);
    if (!bytesRead) break;
    if (first && headerRequired && !imageHeader(buffer.subarray(0,bytesRead))) fail('Invalid AppImage header');
    first = false; total += bytesRead;
    if (total > size) fail('AppImage size mismatch');
    hash.update(buffer.subarray(0,bytesRead)); await writeAll(output,buffer.subarray(0,bytesRead));
  }
  if (total !== size || (sha256 && hash.digest('hex') !== sha256)) fail('AppImage checksum or size mismatch');
}
async function cleanupStage(staged) {
  if (!staged || path.basename(staged) !== 'candidate.AppImage' || !/^ubi-bureau-update-[A-Za-z0-9]{6}$/.test(path.basename(path.dirname(staged))) || path.dirname(path.dirname(staged)) !== os.tmpdir()) return;
  const dir = path.dirname(staged);
  try {const s=await fsp.lstat(dir);if (!s.isDirectory() || s.uid !== process.getuid() || s.mode & 0o077) return; await fsp.unlink(staged).catch(e=>{if(e.code!=='ENOENT')throw e;});await fsp.rmdir(dir);} catch(e) {if(e.code!=='ENOENT')throw e;}
}
async function downloadUpdate(envelope,currentVersion,{signal,progress,publicKey}={}) {
  const m = parseManifest(envelope,publicKey);
  if (m.code <= versionCode(currentVersion)) fail('Update is not newer');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(),'ubi-bureau-update-'));
  await fsp.chmod(dir,0o700);
  const staged = path.join(dir,'candidate.AppImage');
  let file;
  try {
    file = await fsp.open(staged,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
    const hash = crypto.createHash('sha256');let header=Buffer.alloc(0);
    const received = await transfer(m.url,{limit:m.size,signal,progress,write:async chunk=>{hash.update(chunk);if(header.length<64)header=Buffer.concat([header,chunk.subarray(0,64-header.length)]);await writeAll(file,chunk);}});
    if(received !== m.size || hash.digest('hex') !== m.sha256 || !imageHeader(header)) fail('Downloaded AppImage failed verification');
    await file.sync();await file.close();file=null;cancelled(signal);return staged;
  } catch(e) {await file?.close();await cleanupStage(staged);throw e;}
}
async function installUpdate(target,staged,envelope,currentVersion,{signal,publicKey}={}) {
  const m=parseManifest(envelope,publicKey);
  if(m.code <= versionCode(currentVersion)) fail('Update is not newer');
  const t=await openTarget(target), temps=[];
  let lock, candidate, receipt, backup, input, swapped=false, backupPath=null;
  const name = suffix => `${t.anchored}/.ubi-update-${crypto.randomBytes(16).toString('hex')}-${suffix}`;
  const create = async suffix => {const p=name(suffix), f=await fsp.open(p,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);temps.push(p);return {p,f};};
  try {
    const lockPath=`${t.anchored}/${t.base}.update-lock`;
    try {lock=await fsp.open(lockPath,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);} catch(e) {if(e.code==='EEXIST')fail('Another update or interrupted update lock exists; close other copies and remove the .update-lock file manually');throw e;}
    const receiptPath=`${t.anchored}/${t.base}.update-manifest`;
    let previous;
    try {previous=await fsp.open(receiptPath,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);const s=await previous.stat();if(!secureFile(s,true)||s.size>MAX_MANIFEST)fail('Unsafe update receipt');const old=parseManifest(await previous.readFile(),publicKey);if(m.code<old.code || (m.code===old.code && m.envelope!==old.envelope))fail('Update rejected by rollback protection');} catch(e) {if(e.code!=='ENOENT')throw e;} finally {await previous?.close();}
    input=await fsp.open(staged,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);const s=await input.stat();
    if(!secureFile(s,true)||s.size!==m.size)fail('Unsafe staged update');
    candidate=await create('candidate');await copyVerified(input,candidate.f,{...m,signal});await input.close();input=null;
    await candidate.f.chmod(t.mode);await candidate.f.sync();await candidate.f.close();candidate.f=null;
    await unchanged(t);cancelled(signal);
    backup=await create('backup');await copyVerified(t.file,backup.f,{size:Number(t.stat.size),signal});await backup.f.chmod(t.mode);await backup.f.sync();await backup.f.close();backup.f=null;
    await unchanged(t);cancelled(signal);
    const backupName=`${t.base}.backup-${crypto.randomBytes(8).toString('hex')}`;
    await fsp.link(backup.p,`${t.anchored}/${backupName}`);await fsp.unlink(backup.p);backupPath=path.join(t.parent,backupName);
    receipt=await create('receipt');await writeAll(receipt.f,Buffer.from(m.envelope));await receipt.f.sync();await receipt.f.close();receipt.f=null;
    // Commit the signed floor first. A crash can only require retrying this exact candidate.
    await fsp.rename(receipt.p,receiptPath);await t.dir.sync();
    await unchanged(t);cancelled(signal);
    await fsp.rename(candidate.p,`${t.anchored}/${t.base}`);swapped=true;
    let warning=null;try{await t.dir.sync();}catch{warning='Installed, but directory durability could not be confirmed; keep the backup.';}
    return {backupPath,targetPath:t.targetPath,warning};
  } finally {
    await input?.close();await candidate?.f?.close();await backup?.f?.close();await receipt?.f?.close();
    for(const p of temps)await fsp.unlink(p).catch(()=>{});
    if(lock){await lock.close();await fsp.unlink(`${t.anchored}/${t.base}.update-lock`).catch(()=>{});}
    await t.file.close();await t.dir.close();
    if(swapped)await cleanupStage(staged).catch(()=>{});
  }
}
module.exports={MAX_MANIFEST,MAX_IMAGE,MANIFEST_URL,versionCode,manifestPayload,parseManifest,allowedUrl,imageHeader,checkUpdate,downloadUpdate,installUpdate,probeTarget,cleanupStage,copyVerified};
