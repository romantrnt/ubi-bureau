"use strict";
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT = path.join(os.homedir(), '.local/state/agent-office/dot-snapshot.json');
const STATES = {running:'thinking', completed:'done', idle:'idle', error:'error', interrupted:'interrupted', waiting:'waiting'};
function readDotSnapshot(file = DEFAULT, now = Date.now()) {
  const disconnected = (reason) => ({sessions:[], connection:{source:'dot-snapshot', mode:'snapshot', available:false, reason, observedAt:null}});
  let data;
  try { if (fs.statSync(file).size > 256*1024) return disconnected('Snapshot too large'); data=JSON.parse(fs.readFileSync(file,'utf8')); }
  catch { return disconnected('No Dot snapshot received'); }
  if (data.version !== 1 || !Number.isFinite(data.observedAt) || data.observedAt > now+5000 || !Array.isArray(data.agents) || data.agents.length>100) return disconnected('Invalid Dot snapshot');
  const age=Math.max(0,now-data.observedAt), stale=age>120000;
  const sessions=[], seen=new Set();
  for(const row of data.agents) {
    if (!row || typeof row.id!=='string' || !/^[a-zA-Z0-9_/-]{1,160}$/.test(row.id) || seen.has(row.id) || !Object.hasOwn(STATES,row.status)) continue;
    seen.add(row.id);
    const title=typeof row.title==='string'?row.title.slice(0,160):row.id.split('/').pop();
    sessions.push({agent:'dot', id:row.id, source:'dot-snapshot', title, cwd:null, model:null,
      subagent:row.id!=='/root', parentId:typeof row.parentId==='string'?row.parentId:null,
      status:stale?'unknown':STATES[row.status], explicitLifecycle:true,
      activity:null, prompt:null, reply:null, error:null, startedAt:null, turnStartedAt:null,
      lastEventAt:data.observedAt, observedAt:data.observedAt, snapshotStale:stale,
      lastObservedStatus:row.status, agentName:"Dot"});
  }
  return {sessions,connection:{source:'dot-snapshot',mode:'snapshot',available:true,stale,observedAt:data.observedAt,ageMs:age}};
}
module.exports={readDotSnapshot,DEFAULT};
