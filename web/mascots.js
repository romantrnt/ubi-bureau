import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Purpose-built, actual 3D mascots. No screenshot textures or external assets.
const geometries = new Map();
const materials = new Map();
const templates = new Map();
const sharedGeometry = new WeakSet();
const mat = (name, color, roughness = .46, metalness = .04, emissive = null) => {
  if (!materials.has(name)) materials.set(name, new THREE.MeshStandardMaterial({color, roughness, metalness, ...(emissive ? {emissive, emissiveIntensity:.55} : {})}));
  return materials.get(name);
};
function rounded(w,h,d,r=.04) {
  const key=[w,h,d,r].join(',');
  if(!geometries.has(key)) geometries.set(key,new RoundedBoxGeometry(w,h,d,1,Math.min(r,Math.min(w,h,d)/2-.001)));
  return geometries.get(key);
}
function box(parent,w,h,d,x,y,z,material,r=.04) {
  const m=new THREE.Mesh(rounded(w,h,d,r),material); m.position.set(x,y,z); parent.add(m); return m;
}
function sphere(parent,r,x,y,z,material,scale=null){
  const key='s'+r;if(!geometries.has(key))geometries.set(key,new THREE.SphereGeometry(r,10,8));
  const m=new THREE.Mesh(geometries.get(key),material);m.position.set(x,y,z);if(scale)m.scale.set(...scale);parent.add(m);return m;
}
function rod(parent,points,r,material){
  for(let i=1;i<points.length;i++){
    const a=new THREE.Vector3(...points[i-1]),b=new THREE.Vector3(...points[i]),delta=b.clone().sub(a);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),10),material);
    mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());parent.add(mesh);
  }
  for(const p of points)sphere(parent,r,...p,material);
}
function group(parent,name,x=0,y=0,z=0){const g=new THREE.Group();g.name=name;g.position.set(x,y,z);parent.add(g);return g;}
// A shared back-face shell gives a true silhouette at every orbit angle.
// It adds no render targets/postprocessing and never allocates during a frame.
const outline = new THREE.MeshBasicMaterial({color:0x293342,side:THREE.BackSide});
const ignoreRaycast = () => {};
outline.onBeforeCompile = shader => {
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
    'vec3 transformed = vec3(position) + normal * 0.014;');
};
outline.customProgramCacheKey = () => 'bureau-silhouette-v1';

// Collapse stationary parts by material within each articulated group. A robot
// keeps its named arm/leg/head pivots while using a handful of draw calls.
function batchParts(parent) {
  for (const child of [...parent.children]) if (child.isGroup) batchParts(child);
  const batches = new Map();
  for (const child of [...parent.children]) {
    if (!child.isMesh || child.userData.signal) continue;
    child.updateMatrix();
    const geometry=(child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone()).applyMatrix4(child.matrix);
    if (!batches.has(child.material)) batches.set(child.material,[]);
    batches.get(child.material).push(geometry);
    parent.remove(child);
    if (!new Set(geometries.values()).has(child.geometry)) child.geometry.dispose();
  }
  for (const [material,parts] of batches) {
    const mesh=new THREE.Mesh(mergeGeometries(parts),material);
    parent.add(mesh);parts.forEach(g=>g.dispose());
  }
}
function finish(root,headY){
  group(root,'label-anchor',0,headY,0);
  batchParts(root);
  const bodies=[];root.traverse(o=>{if(o.isMesh)bodies.push(o);});
  for (const mesh of bodies) {
    mesh.castShadow=true;mesh.receiveShadow=true;
    if (mesh.userData.signal) continue;
    const shell=new THREE.Mesh(mesh.geometry,outline);
    shell.name='silhouette';shell.userData.outline=true;
    shell.raycast=ignoreRaycast;mesh.add(shell);
  }
  root.userData.mascot=true;return root;
}
// Construct and merge each immutable shape once. Clones keep independent
// pivots/userData and only the status lights need their own materials.
function instantiate(key, build) {
  let template=templates.get(key);
  if (!template) {
    template=build();
    template.traverse(o=>{if(o.geometry)sharedGeometry.add(o.geometry);});
    templates.set(key,template);
  }
  const root=template.clone(true);
  root.traverse(o=>{
    if(o.userData.signal)o.material=o.material.clone();
    // Object3D.clone copies data/transforms, but not per-instance methods.
    if(o.userData.outline)o.raycast=ignoreRaycast;
  });
  return root;
}
function signal(parent,w,h,d,x,y,z) {
  const material=new THREE.MeshStandardMaterial({color:0xa5a7bb,roughness:.7});
  const mesh=box(parent,w,h,d,x,y,z,material,.012);
  mesh.userData.signal=true;
  return mesh;
}

const PROVIDERS = {
  codex:{body:0x398bce,trim:0xc5e9ff,mark:'brackets'},
  claude:{body:0xdc9466,trim:0xffe0c7,mark:'rays'},
  gemini:{body:0x6d8edc,trim:0xd0dcff,mark:'star'},
  copilot:{body:0x8895d7,trim:0xd6d7ea,mark:'goggles'},
  antigravity:{body:0xb89bba,trim:0xe5d2e1,mark:'star'},
  omp:{body:0x669fb6,trim:0xd5effa,mark:'brackets'},
};
export function workerMascot(provider='codex',variant=0){
  if(provider==='codex')return codexMascot();
  const style=Object.hasOwn(PROVIDERS,provider)?provider:'other';
  const tab=variant%3===1?1:variant%3===2?2:0;
  const root=instantiate('worker:'+style+':'+tab,()=>buildWorkerMascot(style,tab));
  root.name=provider+'-mascot';
  return root;
}
function buildWorkerMascot(provider,variant){
  const root=new THREE.Group();root.name=provider+'-mascot';
  const style=PROVIDERS[provider]||{body:0x8c98af,trim:0xe4ebf6,mark:'brackets'};
  const paint=mat(provider+'-body',style.body,.8),trim=mat(provider+'-trim',style.trim,.8);
  const ink=mat('ink',0x293342,.9),face=mat('face',0x26384c,.88),eye=mat('eyes',0xf5fbff,.9);
  // Chunky jacket, large boots and a compact terminal head. A provider's
  // silhouette/face is stable; session variants carry one of three side tabs.
  const torso=group(root,'torso',0,.49,0);
  box(torso,.43,.34,.29,0,0,0,paint,.065);
  box(torso,.32,.07,.025,0,-.055,.15,trim,.014);
  signal(torso,.06,.045,.018,.10,.045,.162);
  for(const side of [-1,1]){
    const leg=group(root,side<0?'leg-left':'leg-right',side*.13,.25,0);
    box(leg,.15,.19,.18,0,-.015,0,ink,.025);
    box(leg,.22,.14,.30,0,-.14,.055,paint,.035);
    const arm=group(root,side<0?'arm-left':'arm-right',side*.28,.58,0);
    box(arm,.13,.26,.16,0,-.1,0,paint,.035);
    box(arm,.15,.095,.17,0,-.26,.025,trim,.025);
  }
  const head=group(root,'head',0,.95,0);
  box(head,.66,.49,.38,0,0,0,paint,.08);
  box(head,.56,.355,.035,0,-.005,.2,trim,.04);
  box(head,.48,.275,.035,0,-.005,.224,face,.035);
  if(style.mark==='goggles'){
    for(const side of [-1,1])box(head,.175,.155,.03,side*.12,.015,.25,eye,.035);
  }else if(style.mark==='rays'){
    for(const side of [-1,1]){
      box(head,.035,.09,.025,side*.11,.015,.25,eye,.007);
      box(head,.10,.025,.025,side*.11,.02,.25,eye,.006);
    }
  }else if(style.mark==='star'){
    for(const side of [-1,1]){
      const star=box(head,.095,.095,.025,side*.11,.02,.25,eye,.01);star.rotation.z=Math.PI/4;
    }
  }else{
    for(const side of [-1,1]){
      box(head,.025,.105,.025,side*.135,.02,.25,eye,.005);
      box(head,.065,.024,.025,side*.11,.06,.25,eye,.005);
      box(head,.065,.024,.025,side*.11,-.02,.25,eye,.005);
    }
  }
  box(head,.08,.018,.025,0,-.078,.25,trim,.006);
  if(provider==='codex'){
    // Three broad cloud lobes remain readable at overview scale.
    for(const [x,y,r] of [[-.19,.26,.12],[0,.32,.16],[.19,.26,.12]])sphere(head,r,x,y,0,trim,[1,1,.9]);
  } else {
    box(head,.075,.14,.10,-.24,.30,0,trim,.02);
    if(variant%3===1)box(head,.075,.10,.10,-.13,.28,0,trim,.02);
    if(variant%3===2)box(head,.075,.10,.10,.24,.28,0,trim,.02);
  }
  return finish(root,1.5);
}
export function codexMascot(){
  return instantiate('codex',buildCodexMascot);
}
function buildCodexMascot(){
  const root=new THREE.Group();root.name='codex-mascot';
  const blue=mat('blue',0x2371ce,.32,.1),blueDark=mat('blue-dark',0x15488e,.42,.08),ice=mat('ice',0xb8e6f8,.38,.04),sole=mat('sole',0xd5f4fa,.55),screen=mat('screen',0x0a2047,.24,.12),cyan=mat('cyan',0x53f3e7,.3,.02,0x21c8d4);
  const torso=group(root,'torso',0,.47,0);
  box(torso,.45,.38,.31,0,0,0,blue,.105);
  box(torso,.33,.23,.045,0,.035,.163,ice,.075);
  sphere(torso,.047,0,.065,.193,cyan,[1,1,.45]);
  for(const side of [-1,1]){
    const leg=group(root,side<0?'leg-left':'leg-right',side*.135,.235,0);
    box(leg,.16,.20,.18,0,-.01,0,blueDark,.055);
    box(leg,.235,.15,.31,0,-.14,.065,blue,.058);
    box(leg,.24,.039,.31,0,-.205,.065,sole,.015);
    const arm=group(root,side<0?'arm-left':'arm-right',side*.29,.55,0);
    box(arm,.14,.27,.155,0,-.09,0,blue,.055);
    box(arm,.145,.042,.16,0,-.19,0,ice,.014);
    sphere(arm,.084,0,-.26,.012,blue,[.86,1.05,.92]);
    sphere(arm,.042,-side*.052,-.24,.068,blue);
  }
  const head=group(root,'head',0,.96,0);
  // Continuous cloud silhouette, softly extruded rather than overlapping balloons.
  const sh=new THREE.Shape();
  sh.moveTo(-.36,-.25);sh.bezierCurveTo(-.53,-.25,-.59,-.14,-.53,.015);
  sh.bezierCurveTo(-.57,.15,-.47,.28,-.34,.27);
  sh.bezierCurveTo(-.29,.46,-.05,.49,.055,.35);
  sh.bezierCurveTo(.22,.43,.36,.34,.38,.23);
  sh.bezierCurveTo(.55,.20,.58,.03,.51,-.06);
  sh.bezierCurveTo(.57,-.20,.46,-.29,.31,-.28);
  sh.lineTo(-.36,-.25);
  const cloud=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:.26,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:.034,bevelThickness:.035,curveSegments:10}),ice);
  cloud.position.z=-.15;head.add(cloud);
  box(head,.77,.56,.13,-.005,-.045,.20,blue,.12);
  box(head,.665,.45,.07,-.005,-.045,.275,blueDark,.092);
  box(head,.60,.395,.035,-.005,-.045,.316,screen,.075);
  const face=group(head,'eyes',0,-.035,.343);
  rod(face,[[-.185,.078,0],[-.105,0,0],[-.185,-.078,0]],.019,cyan);
  rod(face,[[.175,.078,0],[.095,0,0],[.175,-.078,0]],.019,cyan);
  sphere(head,.078,-.535,-.045,0,blue,[.55,1,1]);sphere(head,.078,.535,-.045,0,blue,[.55,1,1]);
  return finish(root,1.47);
}
export function dotMascot(){
  return instantiate('dot',buildDotMascot);
}
function buildDotMascot(){
  const root=new THREE.Group();root.name='dot-mascot';
  const body=mat('plum',0x817399,.48,.06),rim=mat('plum-edge',0xada0c8,.39,.07),dark=mat('plum-dark',0x302b48,.47,.02),slot=mat('plum-slot',0x4d4269,.51),light=mat('lavender',0xd8c4ff,.55,.02),sole=mat('dot-sole',0x423759,.65);
  box(root,.22,.105,.32,-.16,.065,.045,sole,.035);box(root,.22,.105,.32,.16,.065,.045,sole,.035);
  for(let i=0;i<3;i++){
    const tier=group(root,i===2?'head':'tier-'+i,0,.25+i*.29,0);
    box(tier,.65,.25,.425,0,0,0,body,.055);
    box(tier,.57,.19,.035,0,.012,.214,rim,.025);
    box(tier,.505,.126,.035,0,.012,.239,dark,.022);
    signal(tier,.065,.051,.022,-.135,.019,.261);
    signal(tier,.065,.051,.022,.135,.019,.261);
    if(i===2)box(tier,.09,.013,.014,0,-.032,.262,rim,.004);
    else box(tier,.11,.014,.015,.005,-.036,.262,slot,.005);
    box(tier,.07,.092,.17,-.36,-.005,0,slot,.025);box(tier,.07,.092,.17,.36,-.005,0,slot,.025);
  }
  rod(root,[[-.15,.96,0],[-.15,1.115,0],[-.205,1.17,0]],.022,dark);
  rod(root,[[.13,.96,0],[.13,1.08,0]],.019,dark);
  box(root,.075,.068,.075,-.205,1.19,0,light,.018);sphere(root,.039,.13,1.10,0,rim);
  return finish(root,1.28);
}


// Template geometry and immutable materials outlive actor removal. Dispose only
// per-actor status materials or any private geometry attached by a caller.
export function disposeMascot(root) {
  const unique=new Set(),ownMaterials=new Set();
  root.traverse(o=>{if(o.geometry&&!sharedGeometry.has(o.geometry))unique.add(o.geometry);if(o.userData.signal)ownMaterials.add(o.material);});
  unique.forEach(g=>g.dispose());ownMaterials.forEach(m=>m.dispose());
}
