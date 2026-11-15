'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const core = require('./update-core');
const VERSION = require('../package.json').version;
const DEFAULTS = {mode:'notify',intervalHours:24,skippedVersion:null};
const C = fs.constants;
function preferences(value) {
  if (!value || !['off','notify','download'].includes(value.mode) || ![1,6,24,168].includes(value.intervalHours)) throw new Error('Invalid update preferences');
  let skippedVersion = value.skippedVersion || null;
  if (skippedVersion) core.versionCode(skippedVersion);
  return {mode:value.mode,intervalHours:value.intervalHours,skippedVersion};
}
class Updates {
  constructor({enabled=false,target=process.env.APPIMAGE,configDir=path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(),'.config'),'ubi-bureau'),currentVersion=VERSION}={}) {
    this.target=target;this.configDir=configDir;this.currentVersion=currentVersion;
    this.token=crypto.randomBytes(32).toString('hex');this.prefs={...DEFAULTS};this.closed=false;
    this.supported=Boolean(enabled && target && process.platform==='linux' && process.arch==='x64');
    this.state={supported:this.supported,reason:this.supported?null:'Self-update is available only in the Linux x86_64 AppImage (not source or demo mode).',currentVersion,status:'idle',availableVersion:null,progress:null,error:null,installed:false,restartRequired:false,targetPath:target||null,backupPath:null,canInstall:false};
    if(this.supported){
      try{this.readPreferences();}catch(e){this.prefs.mode='off';this.state.error=`Update preferences were not loaded; automatic checks disabled: ${e.message}`;}
      this.ready=core.probeTarget(target).then(probe=>{Object.assign(this.state,probe);this.schedule(30000);});
    }else this.ready=Promise.resolve();
  }
  readPreferences(){
    let fd;
    try{const ds=fs.lstatSync(this.configDir);if(!ds.isDirectory()||ds.uid!==process.getuid()||ds.mode&0o077)throw new Error('Unsafe configuration directory');
      fd=fs.openSync(path.join(this.configDir,'updates.json'),C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);const s=fs.fstatSync(fd);
      if(!s.isFile()||s.uid!==process.getuid()||s.nlink!==1||s.mode&0o077||s.size>4096)throw new Error('Unsafe preferences file');
      this.prefs=preferences(JSON.parse(fs.readFileSync(fd,'utf8')));
    }catch(e){if(e.code!=='ENOENT')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  savePreferences(next){
    const value=preferences(next);
    fs.mkdirSync(this.configDir,{recursive:true,mode:0o700});
    const s=fs.lstatSync(this.configDir);if(!s.isDirectory()||s.uid!==process.getuid()||s.mode&0o077)throw new Error('Unsafe configuration directory');
    const file=path.join(this.configDir,`.updates-${crypto.randomBytes(16).toString('hex')}`);
    let fd;
    try{fd=fs.openSync(file,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(file,path.join(this.configDir,'updates.json'));const d=fs.openSync(this.configDir,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
    finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
    this.prefs=value;this.schedule();
  }
  snapshot(){return {...this.state,preferences:{...this.prefs},token:this.token};}
  schedule(delay=this.prefs.intervalHours*3600000){
    clearTimeout(this.timer);
    if(this.closed||!this.supported||this.prefs.mode==='off'||this.state.installed)return;
    this.timer=setTimeout(()=>{if(!this.job&&this.state.status!=='ready')this.action('check',true).catch(()=>{});this.schedule();},delay);this.timer.unref();
  }
  async action(action,automatic=false){
    if(!this.supported)throw new Error(this.state.reason);
    if(this.closed||this.state.installed)throw new Error('Close and reopen Ubi Bureau to use the installed version');
    if(action==='cancel'){this.controller?.abort();return;}
    if(this.job)throw new Error('An update operation is already running');
    if(action==='skip'){
      if(!this.manifest)throw new Error('No update to skip');
      this.savePreferences({...this.prefs,skippedVersion:this.manifest.version});
      const staged=this.staged;this.staged=null;this.manifest=null;this.state.availableVersion=null;this.state.status='idle';await core.cleanupStage(staged);return;
    }
    if(!['check','download','install'].includes(action))throw new Error('Unknown update action');
    if(action==='install'&&(!this.state.canInstall||this.state.status!=='ready'||!this.staged))throw new Error('A verified download and a writable AppImage are required');
    if(action==='download'&&!this.manifest)throw new Error('Check for an update first');
    if(action==='check'&&!automatic&&this.prefs.skippedVersion)this.savePreferences({...this.prefs,skippedVersion:null});
    this.controller=new AbortController();const signal=this.controller.signal;
    this.state.status={check:'checking',download:'downloading',install:'installing'}[action];this.state.error=null;this.state.progress=null;
    this.job=(async()=>{
      if(action==='check'){
        await core.cleanupStage(this.staged);this.staged=null;this.manifest=null;this.state.availableVersion=null;
        const m=await core.checkUpdate(this.currentVersion,{signal});
        if(signal.aborted)throw new Error('Update cancelled');
        if(m.code===core.versionCode(this.currentVersion)){this.state.status='current';return;}
        if(automatic&&m.version===this.prefs.skippedVersion){this.state.status='idle';return;}
        this.manifest=m;this.state.availableVersion=m.version;this.state.status='available';
        if(automatic&&this.prefs.mode==='download'){this.state.status='downloading';await this.download(signal);}
      }else if(action==='download'){await core.cleanupStage(this.staged);this.staged=null;await this.download(signal);}
      else{
        const result=await core.installUpdate(this.target,this.staged,this.manifest.envelope,this.currentVersion,{signal});
        this.staged=null;Object.assign(this.state,result,{status:'installed',installed:true,restartRequired:true,canInstall:false});clearTimeout(this.timer);
      }
    })().catch(e=>{this.state.status=signal.aborted?'cancelled':'error';this.state.error=signal.aborted?null:String(e.message).slice(0,500);})
      .finally(()=>{this.job=null;this.controller=null;});
  }
  async download(signal){
    this.staged=await core.downloadUpdate(this.manifest.envelope,this.currentVersion,{signal,progress:p=>{this.state.progress=p;}});
    if(signal.aborted){await core.cleanupStage(this.staged);this.staged=null;throw new Error('Update cancelled');}
    this.state.status='ready';
  }
  async close(){this.closed=true;clearTimeout(this.timer);this.controller?.abort();await this.job;await core.cleanupStage(this.staged).catch(()=>{});this.staged=null;}
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function updateRoute(req,res,manager,port){
  if(!req.url?.startsWith('/api/updates/'))return false;
  const host=`127.0.0.1:${port}`,origin=`http://${host}`;
  if(req.headers.host!==host || (req.headers.origin&&req.headers.origin!==origin) || req.headers['sec-fetch-site']==='cross-site') {json(res,403,{error:'Update requests must be same-origin'});return true;}
  if(req.url==='/api/updates/state'&&req.method==='GET'){json(res,200,manager.snapshot());return true;}
  if(!['/api/updates/action','/api/updates/preferences'].includes(req.url)||req.method!=='POST'){json(res,404,{error:'Unknown update endpoint'});return true;}
  if(req.headers.origin!==origin || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')){json(res,403,{error:'Same-origin JSON is required'});return true;}
  let bytes=0,chunks=[],rejected=false;
  const timer=setTimeout(()=>{if(!res.writableEnded){rejected=true;json(res,408,{error:'Request timed out'});}},5000);timer.unref();
  req.on('data',chunk=>{bytes+=chunk.length;if(bytes>4096){if(!rejected){rejected=true;json(res,413,{error:'Request too large'});}chunks=[];}else if(!rejected)chunks.push(chunk);});
  req.on('end',async()=>{clearTimeout(timer);if(rejected)return;
    try{
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(typeof data.token!=='string'||data.token.length!==manager.token.length||!crypto.timingSafeEqual(Buffer.from(data.token),Buffer.from(manager.token))) {json(res,403,{error:'Invalid update token'});return;}
      if(req.url.endsWith('/preferences')){if(!manager.supported)throw new Error(manager.state.reason);manager.savePreferences({mode:data.mode,intervalHours:data.intervalHours,skippedVersion:manager.prefs.skippedVersion});if(data.mode==='off')manager.controller?.abort();}
      else await manager.action(data.action);
      json(res,200,manager.snapshot());
    }catch(e){json(res,400,{error:String(e.message).slice(0,500)});}
  });req.on('error',()=>{clearTimeout(timer);});return true;
}
module.exports={Updates,updateRoute,preferences,DEFAULTS};
