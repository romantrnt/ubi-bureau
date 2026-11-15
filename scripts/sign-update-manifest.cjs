#!/usr/bin/env node
'use strict';
// Offline signing only. The private key stays outside the repository.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const core=require('../src/update-core');
(async()=>{
  const [keyPath,imagePath,outputPath]=process.argv.slice(2);
  if(!keyPath||!imagePath||!outputPath)throw new Error('Usage: node scripts/sign-update-manifest.cjs /private/release-private.pem dist/Ubi_Bureau-VERSION-x86_64.AppImage dist/update-manifest.txt');
  const version=require('../package.json').version;
  if(path.basename(imagePath)!==`Ubi_Bureau-${version}-x86_64.AppImage`)throw new Error('Artifact name must match package version');
  const keyFile=fs.openSync(keyPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK),s=fs.fstatSync(keyFile);
  if(!s.isFile()||s.uid!==process.getuid()||s.nlink!==1||s.mode&0o077||s.size>16384)throw new Error('Signing key must be an owned private regular file');
  const key=crypto.createPrivateKey(fs.readFileSync(keyFile));fs.closeSync(keyFile);
  const pinned=crypto.createPublicKey(fs.readFileSync(path.join(__dirname,'../assets/update-public-key.pem'))).export({type:'spki',format:'der'});
  if(!crypto.createPublicKey(key).export({type:'spki',format:'der'}).equals(pinned))throw new Error('Private key does not match the Ubi public key');
  const stat=fs.statSync(imagePath);if(!stat.isFile()||stat.size<64||stat.size>core.MAX_IMAGE)throw new Error('Invalid AppImage size');
  const hash=crypto.createHash('sha256');let header=Buffer.alloc(0),size=0;
  for await(const b of fs.createReadStream(imagePath)){size+=b.length;if(size>core.MAX_IMAGE)throw new Error('Image too large');hash.update(b);if(header.length<64)header=Buffer.concat([header,b.subarray(0,64-header.length)]);}
  if(size!==stat.size||!core.imageHeader(header))throw new Error('Invalid or changing AppImage');
  const payload=core.manifestPayload(version,size,hash.digest('hex'));
  const envelope=crypto.sign('RSA-SHA256',Buffer.from(payload),{key,padding:crypto.constants.RSA_PKCS1_PADDING}).toString('base64')+'\n'+payload;
  core.parseManifest(envelope);fs.writeFileSync(outputPath,envelope,{flag:'wx',mode:0o644});console.log(`Signed Ubi Bureau ${version}: ${size} bytes`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
