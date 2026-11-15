#!/usr/bin/env node
// Explicit input only. Never polls private runtimes or invents agent states.
const fs=require('fs'), path=require('path');
const {readDotSnapshot,validSnapshot,DEFAULT}=require('../src/dot-snapshot');
let buf=''; process.stdin.setEncoding('utf8');
process.stdin.on('data',s=>{buf+=s;if(Buffer.byteLength(buf,'utf8')>256*1024){console.error('Snapshot too large');process.exit(1);}});
process.stdin.on('end',()=>{
  let data;try{data=JSON.parse(buf);}catch{console.error('Invalid JSON');process.exit(1);}
  if(!validSnapshot(data)){console.error('Invalid snapshot schema');process.exitCode=1;return;}
  fs.mkdirSync(path.dirname(DEFAULT),{recursive:true,mode:0o700});
  const tmp=DEFAULT+'.'+process.pid+'.tmp';
  try {
    fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600,flag:'wx'});
    const checked=readDotSnapshot(tmp);
    if(!checked.connection.available)throw new Error('Invalid snapshot schema');
    fs.renameSync(tmp,DEFAULT);console.log('Observation saved for the single Dot coordinator. Current status and active worker count remain unknown.');
  }catch(e){try{fs.unlinkSync(tmp);}catch{}console.error(e.message);process.exitCode=1;}
});
