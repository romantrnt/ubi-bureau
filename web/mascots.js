import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Purpose-built, actual 3D mascots. No screenshot textures or external assets.
const geometries = new Map();
const materials = new Map();
const mat = (name, color, roughness = .46, metalness = .04, emissive = null) => {
  if (!materials.has(name)) materials.set(name, new THREE.MeshStandardMaterial({color, roughness, metalness, ...(emissive ? {emissive, emissiveIntensity:.55} : {})}));
  return materials.get(name);
};
function rounded(w,h,d,r=.04) {
  const key=[w,h,d,r].join(',');
  if(!geometries.has(key)) geometries.set(key,new RoundedBoxGeometry(w,h,d,3,Math.min(r,Math.min(w,h,d)/2-.001)));
  return geometries.get(key);
}
function box(parent,w,h,d,x,y,z,material,r=.04) {
  const m=new THREE.Mesh(rounded(w,h,d,r),material); m.position.set(x,y,z); parent.add(m); return m;
}
function sphere(parent,r,x,y,z,material,scale=null){
  const key='s'+r;if(!geometries.has(key))geometries.set(key,new THREE.SphereGeometry(r,20,14));
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
function finish(root,headY){
  const anchor=group(root,'label-anchor',0,headY,0);
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  root.userData.mascot=true;return root;
}
export function codexMascot(){
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
  const root=new THREE.Group();root.name='dot-mascot';
  const body=mat('plum',0x817399,.48,.06),rim=mat('plum-edge',0xada0c8,.39,.07),dark=mat('plum-dark',0x302b48,.47,.02),slot=mat('plum-slot',0x4d4269,.51),light=mat('lavender',0xd8c4ff,.34,.02,0x8c68be),sole=mat('dot-sole',0x423759,.65);
  box(root,.22,.105,.32,-.16,.065,.045,sole,.035);box(root,.22,.105,.32,.16,.065,.045,sole,.035);
  for(let i=0;i<3;i++){
    const tier=group(root,i===2?'head':'tier-'+i,0,.25+i*.29,0);
    box(tier,.65,.25,.425,0,0,0,body,.055);
    box(tier,.57,.19,.035,0,.012,.214,rim,.025);
    box(tier,.505,.126,.035,0,.012,.239,dark,.022);
    box(tier,.065,.051,.022,-.135,.019,.261,light,.014);
    box(tier,.065,.051,.022,.135,.019,.261,light,.014);
    if(i===2)box(tier,.09,.013,.014,0,-.032,.262,rim,.004);
    else box(tier,.11,.014,.015,.005,-.036,.262,slot,.005);
    box(tier,.07,.092,.17,-.36,-.005,0,slot,.025);box(tier,.07,.092,.17,.36,-.005,0,slot,.025);
  }
  rod(root,[[-.15,.96,0],[-.15,1.115,0],[-.205,1.17,0]],.022,dark);
  rod(root,[[.13,.96,0],[.13,1.08,0]],.019,dark);
  box(root,.075,.068,.075,-.205,1.19,0,light,.018);sphere(root,.039,.13,1.10,0,rim);
  return finish(root,1.28);
}
