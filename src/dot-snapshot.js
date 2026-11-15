"use strict";
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT = path.join(os.homedir(), '.local/state/agent-office/dot-snapshot.json');
const STATES = {running:'thinking', completed:'done', idle:'idle', error:'error', interrupted:'interrupted', waiting:'waiting'};
const ID = /^[a-zA-Z0-9_/-]{1,160}$/;
function validSnapshot(data, now = Date.now()) {
  if (!data || data.version !== 1 || !Number.isFinite(data.observedAt) || data.observedAt < 0
    || data.observedAt > now+5000 || !Array.isArray(data.agents) || data.agents.length > 100) return false;
  const seen = new Set();
  return data.agents.every(row => {
    if (!row || typeof row.id !== 'string' || !ID.test(row.id) || seen.has(row.id)
      || typeof row.status !== 'string' || !Object.hasOwn(STATES, row.status)
      || (row.title !== undefined && typeof row.title !== 'string')
      || (row.parentId != null && (typeof row.parentId !== 'string' || !ID.test(row.parentId)))) return false;
    seen.add(row.id);
    return true;
  });
}
function readDotSnapshot(file = DEFAULT, now = Date.now()) {
  const coordinator = (extra = {}) => ({agent:'dot',id:'/root',source:'dot-snapshot',title:'Dot',cwd:null,model:null,
    subagent:false,parentId:null,status:'unknown',explicitLifecycle:true,
    activity:null,prompt:null,reply:null,error:null,startedAt:null,turnStartedAt:null,
    lastEventAt:null,observedAt:null,snapshotStale:true,lastObservedStatus:null,
    activeSubagents:null,agentName:'Dot',...extra});
  const disconnected = (reason) => ({sessions:[coordinator({presenceReason:'snapshot-unavailable'})],
    connection:{source:'dot-snapshot', mode:'snapshot', live:false, available:false, stale:true, reason, observedAt:null,activeSubagents:null}});
  let data;
  try { if (fs.statSync(file).size > 256*1024) return disconnected('Snapshot too large'); data=JSON.parse(fs.readFileSync(file,'utf8')); }
  catch { return disconnected('No Dot snapshot received'); }
  if (!validSnapshot(data, now)) return disconnected('Invalid Dot snapshot');
  const age=Math.max(0,now-data.observedAt), stale=age>120000;
  // A manual snapshot is not a live agent feed. Represent the coordinator once,
  // never turn saved worker records into people who appear to be working now.
  const root=data.agents.find(row=>row && row.id==='/root');
  const sessions=[coordinator({
    lastEventAt:data.observedAt,observedAt:data.observedAt,snapshotStale:stale,
    lastObservedStatus:root && Object.hasOwn(STATES,root.status)?root.status:null,
    presenceReason:stale?'stale-snapshot':'manual-snapshot'})];
  return {sessions,connection:{source:'dot-snapshot',mode:'snapshot',live:false,available:true,stale,observedAt:data.observedAt,ageMs:age,activeSubagents:null}};
}
module.exports={readDotSnapshot,validSnapshot,DEFAULT};
