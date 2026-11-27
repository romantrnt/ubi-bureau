// A local instrument workshop for observed coding-agent activity.
// The shared simulation owns discovery/pathing; this renderer owns the room,
// semantic character states, picking and camera. Optional packs retain Kenney assets.
// Source file: `npm run build` bundles it with three.js into public/office3d.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { workerMascot, codexMascot, dotMascot, disposeMascot } from './mascots.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const CHARACTERS = ['male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f',
  'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'];
const FURNITURE = ['desk', 'chairDesk', 'computerScreen', 'computerKeyboard', 'computerMouse', 'laptop',
  'pottedPlant', 'plantSmall1', 'plantSmall2', 'plantSmall3', 'kitchenCabinet', 'kitchenCoffeeMachine',
  'kitchenSink', 'kitchenFridgeLarge', 'kitchenMicrowave', 'stoolBar', 'tableRound', 'table',
  'chairModernCushion', 'bookcaseOpen', 'books', 'loungeSofa', 'loungeChairRelax', 'tableCoffee', 'rugRectangle',
  'lampRoundFloor', 'lampSquareTable', 'televisionModern', 'cabinetTelevision', 'trashcan',
  'coatRackStanding', 'radio', 'speaker', 'toaster', 'cardboardBoxClosed'];

const STATUS_COLOR = {
  thinking: 0x6c91a4, tool: 0x487c94, typing: 0x557e65, waiting: 0xc89132, error: 0xbf5747,
};
const CHAR_HEIGHT = 1.18; // world units (≈ tiles)
const WALL_H = 2.4;
const SIT_FORWARD = 0.16;

// Turn a scene manifest into the floor plan the shared simulation uses:
// stations play the part of desks, pois are where off-duty agents hang out.
function scenePlan(def) {
  const grid = new window.OfficeGrid(def.W, def.D);
  const R = grid.res;
  grid.cost.fill(1); // everything blocked (sea) …
  for (const [x0, y0, x1, y1] of def.walk || []) {
    for (let j = Math.floor(y0 * R); j < Math.ceil(y1 * R); j++) {
      for (let i = Math.floor(x0 * R); i < Math.ceil(x1 * R); i++) {
        if (i >= 0 && j >= 0 && i < grid.cw && j < grid.ch) grid.cost[j * grid.cw + i] = 0; // … except walkable ground
      }
    }
  }
  for (const [x, y, w, d] of def.solid || []) grid.block(x, y, w, d, 0.1);
  const rad = (deg) => (deg == null ? null : (deg * Math.PI) / 180);
  const desks = def.stations.map((st) => ({
    x: st.x, y: st.y, side: 'n', pose: st.pose || 'stand', yaw: rad(st.yaw), anim: st.anim, seat: { x: st.x, y: st.y },
  }));
  const pois = def.pois.map((q) => ({
    ...q, yaw: rad(q.yaw), face: 'front', sit: q.sit ? (typeof q.sit === 'number' ? q.sit : 0.3) : 0, taken: null,
  }));
  return {
    W: def.W, D: def.D, viewH: def.viewH, grid, items: [], props: [], pois, desks,
    windows: [], posters: [], pp: null, door: def.spawn, fixed: true, noNap: true, terrain: !!def.terrain, scene: def,
  };
}

function skyNow() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 7 && h < 17) return { sky: 0xa9d4f2, sun: 1.7, amb: 1.15, night: false };
  if (h >= 5 && h < 7) return { sky: 0xf3c9a8, sun: 1.1, amb: 0.8, night: false };
  if (h >= 17 && h < 19) return { sky: 0xf0a679, sun: 1.0, amb: 0.75, night: false };
  return { sky: 0x1d2747, sun: 0.9, amb: 1.05, night: true };
}

// The scene pack for the instance being constructed. The base constructor
// builds the floor plan before our fields exist, so it's passed this way.
let PENDING_SCENE = null;

export class Office3D extends window.Office {
  constructor(root, opts) {
    PENDING_SCENE = (opts && opts.scene) || null;
    super(root, opts);
    this.sceneDef = PENDING_SCENE;
    this.compact = !!opts?.compact;
    this.canvas.classList.add('office-overlay');
    try {
      this.gl = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    } catch (e) {
      // Keep the 3D view explicit: the page offers a retry instead of a 2D fallback.
      this.loadError = 'WebGL unavailable';
      this.markReady(false);
      return;
    }
    this.gl.setPixelRatio(1);
    this.pixelSize=2;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.domElement.className = 'office-gl pixel-scene';
    this.gl.domElement.style.imageRendering='pixelated';
    root.insertBefore(this.gl.domElement, this.canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xedf0f3);
    const pmrem = new THREE.PMREMGenerator(this.gl);
    const roomEnv = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(roomEnv, .08);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = .12;
    pmrem.dispose(); roomEnv.dispose();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.onMotion = e => { this.reducedMotion = e.matches; };
    this.motionQuery.addEventListener('change',this.onMotion);
    this.raycaster = new THREE.Raycaster();
    this.pointerNDC = new THREE.Vector2();
    this.anchors = new Map(); this.labels = []; this.pickTargets = [];
    this._pointerDown = null; this._dragged = false; this._orbiting = false;
    this._down = e => { this._pointerDown = {x:e.clientX,y:e.clientY}; this._dragged=false; };
    this._move = e => { if(this._pointerDown && Math.hypot(e.clientX-this._pointerDown.x,e.clientY-this._pointerDown.y)>5){this._dragged=true;this.hoverKey=null;this.onHover(null);} };
    this._up = () => { this._pointerDown=null; };
    this._leave = () => {this._pointerClient=null;};
    this.canvas.addEventListener('mouseleave',this._leave);
    this.canvas.addEventListener('pointerdown',this._down);
    this.canvas.addEventListener('pointermove',this._move);
    this.canvas.addEventListener('pointerup',this._up);
    this.canvas.addEventListener('pointercancel',this._up);
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('start',()=>{this._orbiting=true;this.onHover(null);});
    this.controls.addEventListener('end',()=>{this._orbiting=false;});
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.25;
    this.controls.minZoom = 0.6;
    this.controls.maxZoom = 4;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xc4b9ac, 2.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e7, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 1;
    this.fillLight = new THREE.DirectionalLight(0xeaf2ff, 1.0);
    this.fillLight.position.set(12,8,-7);
    this.scene.add(this.fillLight);
    this.scene.add(this.sun, this.sun.target);

    this.assetResources = new Set();
    this.actors = new Map();     // person key -> { obj, mixer, actions, current, head, cup }
    this.screens = new Map();    // desk -> emissive screen mesh
    this.blinkers = [];
    this.loaded = false;
    this.clock = new THREE.Clock();
    this.load().catch((e) => {
      this.loadError = String(e && e.message || e);
      console.error('3D office failed to load:', e);
      this.markReady(false);
    });
    this.resize();
  }

  destroy() {
    super.destroy();
    if (!this.gl) return;
    this.controls.dispose();
    this.motionQuery?.removeEventListener('change',this.onMotion);
    for (const [key, actor] of this.actors || []) this.removeActor(key, actor);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.scene.traverse(o=>{ if(o.isMesh && !o.userData.sharedMascot){ if(o.geometry)geometries.add(o.geometry); for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);} } });
    new Set([...geometries,...materials,...textures,...this.assetResources]).forEach(r=>r.dispose());
    this.assetResources.clear();
    this.envTarget?.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
  }

  buildPlan(n) {
    const def = PENDING_SCENE || this.sceneDef;
    if (def) return scenePlan(def);
    const capacity=Math.max(8,Math.ceil((n+2)/4)*4);
    const cols=capacity>16?5:4,rows=Math.ceil((capacity-1)/cols);
    const W=3.55+cols*2.12,D=rows*2.62+2.1;
    const grid=new window.OfficeGrid(W,D),desks=[];
    const dot={x:1.05,y:D-2.75,side:'n',seat:{x:1.68,y:D-1.36},pose:'stand',yaw:0,reservedFor:'dot'};
    desks.push(dot);grid.block(dot.x-.2,dot.y-.16,1.75,.58,.05);
    for(let i=1;i<capacity;i++){
      const x=3.65+((i-1)%cols)*2.12,y=1.25+Math.floor((i-1)/cols)*2.62;
      const dk={x,y,side:'n',seat:{x:x+.70,y:y+1.35},pose:'stand',yaw:0};
      desks.push(dk);grid.block(x,y,1.55,.77,.08);
    }
    return {W,D,viewH:2.7,grid,desks,pois:[],items:[],props:[],windows:[],posters:[],
      noNap:true,door:{x:.22,y:D-.65},pp:null,fixed:false};
  }

  // ------------------------------------------------------------ assets

  async load() {
    // Default room and every actor are procedural. First paint does not wait on
    // dozens of furniture/character network requests.
    if(!this.sceneDef){this.chars=[];this.models={};this.loaded=true;return;}
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const get = (url) => new Promise((ok, fail) => loader.load(url, ok, undefined, fail));
    const [chars, furn] = await Promise.all([
      Promise.all(CHARACTERS.map((c) => get(`/assets/kenney/characters/character-${c}.glb`))),
      Promise.all(FURNITURE.map((f) => get(`/assets/kenney/furniture/${f}.glb`).then((g) => [f, g.scene]))),
    ]);
    this.chars = chars;
    this.models = Object.fromEntries(furn);
    if (this.sceneDef) {
      const extra = [...new Set(this.sceneDef.props.filter((p) => p.f && !this.models[p.f]).map((p) => p.f))];
      const base = await Promise.all(extra.map((f) => get(`/assets/kenney/furniture/${f}.glb`).then((g) => [f, g.scene])));
      Object.assign(this.models, Object.fromEntries(base));
      for (const [, m] of base) m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const names = [...new Set(this.sceneDef.props.filter((p) => p.m).map((p) => p.m))];
      const got = await Promise.all(names.map((m) => get(`${this.sceneDef.base}models/${m}.glb`).then((g) => [`scene:${m}`, g.scene])));
      Object.assign(this.models, Object.fromEntries(got));
      for (const [, m] of got) m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    }
    for (const m of Object.values(this.models)) {
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    }
    // Furniture clones borrow their asset geometry/materials. Room rebuilds
    // dispose only generated resources, never these shared originals.
    for (const model of [...Object.values(this.models), ...this.chars.map(c => c.scene)]) {
      model.traverse(o => {
        if (o.geometry) this.assetResources.add(o.geometry);
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) {
          this.assetResources.add(m);
          for (const value of Object.values(m)) if (value?.isTexture) this.assetResources.add(value);
        }
      });
    }
    this.loaded = true;
  }

  // Place a furniture model so its footprint fills (x, y, w, d) on the floor
  // plan, standing on height y0. rot turns it (0 = model's own front faces +z).
  // With `stretch` the model is scaled per axis to exactly w × h × d.
  place(name, x, y, w, d, { rot = 0, y0 = 0, h = null, stretch = false, group = this.room } = {}) {
    const src = this.models[name];
    if (!src) return null;
    const m = src.clone(true);
    m.rotation.y = rot;
    m.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    if (stretch) {
      const turned = Math.abs(Math.sin(rot)) > 0.5;
      m.scale.set((turned ? d : w) / (turned ? size.z : size.x), h / size.y, (turned ? w : d) / (turned ? size.x : size.z));
    } else {
      m.scale.setScalar(h ? h / size.y : Math.min(w / size.x, d / size.z));
    }
    m.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    m.position.set(x + w / 2 - c.x, y0 - box.min.y, y + d / 2 - c.z);
    group.add(m);
    return m;
  }

  boxMesh(x, y, z, w, d, h, color, opts = {}) {
    const materialOptions={ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0, ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 1 } : {}) };
    const key=JSON.stringify(materialOptions),shape=[w,h,d].join('/');
    const cache=!this.plan.scene;
    let mat=opts.mat || (!opts.uniqueMaterial&&cache&&this.roomMaterials.get(key));
    if(!mat){mat=new THREE.MeshStandardMaterial(materialOptions);if(cache&&!opts.uniqueMaterial&&!opts.mat)this.roomMaterials.set(key,mat);}
    let geometry=cache&&this.roomGeometries.get(shape);
    if(!geometry){geometry=new THREE.BoxGeometry(w,h,d);if(cache)this.roomGeometries.set(shape,geometry);}
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x + w / 2, z + h / 2, y + d / 2);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    (opts.group || this.room).add(m);
    return m;
  }

  glassMat() {
    return this._glass || (this._glass = new THREE.MeshPhysicalMaterial({
      color: 0xcfe6f5, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false,
    }));
  }

  textPlane(text, bg, w, h) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = Math.round(256 * h / w);
    const c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#fff';
    c.font = `800 ${Math.round(cv.height * 0.22)}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  }

  disposeGenerated(root) {
    const resources = new Set();
    root?.traverse(o => {
      if (o.geometry) resources.add(o.geometry);
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) {
        resources.add(m);
        for (const value of Object.values(m)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) if (!this.assetResources.has(resource)) resource.dispose();
  }

  clearRoom() {
    if (this.room) { this.scene.remove(this.room); this.disposeGenerated(this.room); }
    // A changing floor plan can remove furniture. No animation may retain a
    // reference to the previous room (the 7 → 8 desk transition removes foosball).
    this.rods = []; this.foosball = null; this.ball = null; this.doorPivot = null;
    this.arcadeScreen = null; this.lampLight = null; this.windowMat = null;
    this.water = null; this.waterBase = null; this.stars = null; this.planet = null;
    this.bobbers = []; this.flames = []; this.pendants = []; this.pulsers = [];
    this.clearMat = null; this._glass = null; this.blinkers = [];
    this.screens.clear();
    this.roomMaterials=new Map();this.roomGeometries=new Map();
  }

  batchRoom() {
    // Static furniture shares a draw call by material; animated doors and
    // status screens keep their own objects. Geometry is rebuilt only on a
    // capacity change, never on a telemetry heartbeat.
    const dynamic=new Set([...this.screens.values(),this.telemetryBoard]),batches=new Map(),originals=new Set();
    for(const mesh of [...this.room.children]){
      if(!mesh.isMesh||dynamic.has(mesh)||Array.isArray(mesh.material))continue;
      const key=[mesh.material.uuid,mesh.castShadow,mesh.receiveShadow].join('/');
      if(!batches.has(key))batches.set(key,{material:mesh.material,cast:mesh.castShadow,receive:mesh.receiveShadow,parts:[]});
      mesh.updateMatrix();
      const geometry=(mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone()).applyMatrix4(mesh.matrix);
      batches.get(key).parts.push(geometry);originals.add(mesh.geometry);this.room.remove(mesh);
    }
    for(const {material,cast,receive,parts} of batches.values()){
      const mesh=new THREE.Mesh(mergeGeometries(parts),material);mesh.castShadow=cast;mesh.receiveShadow=receive;this.room.add(mesh);parts.forEach(g=>g.dispose());
    }
    const retained=new Set();this.room.traverse(o=>{if(o.geometry)retained.add(o.geometry);});
    for(const geometry of originals)if(!retained.has(geometry))geometry.dispose();
    this.roomGeometries.clear();this.roomMaterials.clear();
  }

  removeActor(key, actor) {
    this.scene.remove(actor.obj, actor.prop, actor.halo);
    actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.obj);
    if (actor.procedural) disposeMascot(actor.obj);
    this.disposeGenerated(actor.prop); this.disposeGenerated(actor.halo);
    this.actors.delete(key);
  }

  // ------------------------------------------------------------ build room

  build() {
    if(this.plan.scene)return this.buildScene();
    const {W,D,desks}=this.plan;
    this.clearRoom();this.room=new THREE.Group();this.scene.add(this.room);this.room.name='bureau-voxel-atelier';
    const ink=0x36424c,paper=0xe8e5d6,wood=0x9a7956,trim=0x657c85;
    // The cutaway is built from solid voxels, including the parquet border.
    this.boxMesh(-.24,-.24,-.38,W+.48,D+.48,.35,0x594c43);
    this.boxMesh(-.18,-.18,-.06,W+.36,D+.36,.055,wood);
    const floorTex=this.patternTexture((c,s)=>{
      c.fillStyle='#bb9d75';c.fillRect(0,0,s,s);
      for(let y=0;y<s;y+=16)for(let x=0;x<s;x+=32){c.fillStyle=['#b99a73','#c5a780','#b29470','#c0a17a'][(x/32+y/16)%4];c.fillRect(x+(y%32?16:0),y,31,15);c.fillStyle='#ac8e6a';c.fillRect(x+3,y+7,15,1);}
    });floorTex.repeat.set(W/3,D/3);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,D),new THREE.MeshStandardMaterial({map:floorTex,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.set(W/2,.003,D/2);floor.receiveShadow=true;this.room.add(floor);
    // High back wall / low return keep silhouettes visible through an orbit.
    this.boxMesh(-.16,-.16,0,W+.32,.16,2.36,0x889aa2);
    this.boxMesh(-.21,-.21,2.36,W+.42,.26,.12,paper);
    this.boxMesh(-.16,0,0,.16,D-.95,.62,0x889aa2);
    this.boxMesh(-.21,0,.62,.26,D-.95,.10,paper);
    this.boxMesh(.01,.005,.12,W-.02,.035,.10,trim);
    for(let x=.12;x<W;x+=.5)this.boxMesh(x,.01,.25,.018,.02,.38,0x7d909a,{shadow:false});
    // A physical source board reports actual state; no decorative graphs.
    this.boxMesh(.26,.015,.65,2.63,.10,1.50,0x344752);
    this.telemetryBoard=this.textPlane('', '#26343d',2.40,1.23);
    this.telemetryBoard.position.set(1.58,1.40,.13);this.room.add(this.telemetryBoard);this.boardStamp=null;
    this.boxMesh(.30,.14,.63,2.55,.18,.08,paper);
    // Windows contain an authored voxel skyline, independent of telemetry.
    for(let x=3.75;x<W-1.1;x+=2.40){
      this.boxMesh(x,.015,.77,1.85,.10,1.36,trim);
      this.boxMesh(x+.10,.125,.88,1.65,.025,1.14,0xa2c1cb,{emissive:0x9cb7bf,ei:.08,shadow:false});
      for(let j=0;j<6;j++){const bh=.18+(j*7%5)*.065;this.boxMesh(x+.14+j*.25,.155,.89,.22,.012,bh,[0x77939f,0x8aa8b0,0x64818f][j%3],{shadow:false});}
      this.boxMesh(x+.9,.18,.88,.055,.02,1.14,paper,{shadow:false});this.boxMesh(x+.10,.18,1.44,1.65,.02,.055,paper,{shadow:false});
      this.boxMesh(x-.07,.02,.73,1.99,.36,.10,paper);
      this.boxMesh(x-.10,.01,2.10,2.05,.26,.13,0x576d79);
    }
    // Dot has a source-observation alcove, deliberately separate from desks.
    this.boxMesh(.40,.55,0,2.35,.70,.62,0x526977);
    this.boxMesh(.36,.51,.62,2.43,.79,.09,paper);
    for(let i=0;i<3;i++){this.boxMesh(.59+i*.70,1.27,.18,.48,.035,.26,0x3d5360,{shadow:false});this.boxMesh(.65+i*.70,1.31,.26,.35,.025,.035,0x9fafb3,{shadow:false});}
    // Reference library with individual voxel book spines and a cubby radio.
    this.boxMesh(.40,1.75,0,.62,1.70,1.25,0x705d4d);
    for(let row=0;row<3;row++){this.boxMesh(.36,1.72,.12+row*.38,.70,1.78,.055,wood);for(let j=0;j<5;j++)this.boxMesh(.45,1.84+j*.30,.19+row*.38,.41,.18,.24,[0x789ca6,0xbd8d78,0xaaa185,0x8b87a3][(j+row)%4]);}
    // Muted woven floor runner unifies the station area without card-like mats.
    this.boxMesh(3.22,.75,.008,W-3.66,D-1.60,.015,0x788f97,{shadow:false});
    for(let x=3.35;x<W-.4;x+=.32)this.boxMesh(x,.86,.026,.07,D-1.84,.003,0x839aa0,{shadow:false});
    this.boxMesh(3.24,.78,.026,W-3.72,.045,.003,0xc4c6b6,{shadow:false});this.boxMesh(3.24,D-.90,.026,W-3.72,.045,.003,0xc4c6b6,{shadow:false});
    for(let i=0;i<desks.length;i++){if(i===0)this.buildDotStation(desks[i]);else this.buildDesk(desks[i],i);}
    // Front review counter: documents and a mechanical desk clock, no fake work.
    this.boxMesh(W-3.20,D-.68,.72,2.68,.43,.10,wood);for(const x of[W-3.02,W-.78])this.boxMesh(x,D-.61,0,.10,.28,.72,ink);
    this.boxMesh(W-2.80,D-.59,.82,.46,.26,.028,paper,{shadow:false});this.boxMesh(W-2.71,D-.54,.852,.27,.03,.005,0x6c8790,{shadow:false});
    this.boxMesh(W-1.25,D-.57,.82,.28,.16,.31,ink);this.boxMesh(W-1.22,D-.40,.86,.22,.02,.22,paper,{shadow:false});
    // A small green volume makes the observation aisle feel inhabited.
    this.voxelPlant(.72,.55,1);this.voxelPlant(W-.45,.60,.8);this.voxelPlant(.72,D-1.20,.85);
    const dy=this.plan.door.y;
    this.boxMesh(-.13,dy-.56,0,.14,.09,1.65,ink);this.boxMesh(-.13,dy+.56,0,.14,.09,1.65,ink);this.boxMesh(-.13,dy-.56,1.56,.14,1.21,.09,ink);
    this.doorPivot=new THREE.Group();this.doorPivot.position.set(-.06,0,dy-.50);this.room.add(this.doorPivot);
    this.boxMesh(0,0,.02,.075,1.04,1.50,0x799aa5,{group:this.doorPivot});this.boxMesh(.075,.83,.72,.04,.10,.045,paper,{group:this.doorPivot});
    this.boxMesh(.06,dy-.60,.006,.60,1.20,.018,0xa88564,{shadow:false});
    this.batchRoom();this.fitCamera3D(!this.fitted);
  }

  voxelPlant(x,y,scale=1){
    const s=scale;this.boxMesh(x-.20*s,y-.20*s,0,.40*s,.40*s,.35*s,0xb68d71);this.boxMesh(x-.24*s,y-.24*s,.30*s,.48*s,.48*s,.09*s,0xd0ac87);
    this.boxMesh(x-.035*s,y-.035*s,.35*s,.07*s,.07*s,.80*s,0x536d58);
    for(const[dx,dy,z,w,h,col]of[[-.25,0,.62,.34,.17,0x72937a],[.05,-.14,.86,.38,.16,0x8eac88],[-.19,-.12,1.08,.32,.23,0xa6bf93],[.02,.08,.53,.30,.17,0x66846e]])this.boxMesh(x+dx*s,y+dy*s,z*s,w*s,.25*s,h*s,col);
  }

  buildDotStation(desk) {
    const {x,y}=desk;
    // A dedicated observation dock. Unknown Dot is stationary here, not at a
    // worker keyboard. Its muted indicators never imply live cloud activity.
    this.boxMesh(x-.35,y-.25,.012,2.05,2.20,.035,0xaaa2b9,{shadow:false});
    this.boxMesh(x-.20,y-.16,.05,1.75,.58,.42,0x635d72);
    this.boxMesh(x-.24,y-.20,.47,1.83,.66,.07,0xe0d9e9);
    const sign=this.textPlane('DOT / OBSERVATORY','#4b455b',1.55,.23);
    sign.position.set(x+.67,.32,y+.435);this.room.add(sign);
    this.boxMesh(x+1.37,y+.06,.54,.045,.045,1.12,0x4a4554);
    this.boxMesh(x+1.15,y-.02,1.65,.49,.26,.12,0xc29370);
    this.boxMesh(x+1.18,y+.01,1.64,.43,.20,.012,0xf0ddbb,{emissive:0xffe3b2,ei:.35,shadow:false});
  }

  updateTelemetryBoard() {
    if(!this.telemetryBoard)return;
    const all=this.telemetry?.sessions||[...this.people.values()].map(p=>p.s);
    const working=all.filter(s=>['thinking','tool','typing'].includes(s.status)).length;
    const waiting=all.filter(s=>s.status==='waiting'||s.status==='error').length;
    const unknown=all.filter(s=>s.status==='unknown').length;
    const stamp=[working,waiting,unknown,this.telemetry?.connected!==false].join('/');
    if(stamp===this.boardStamp)return;this.boardStamp=stamp;
    const tex=this.telemetryBoard.material.map,cv=tex.image,c=cv.getContext('2d');
    c.fillStyle='#212121';c.fillRect(0,0,cv.width,cv.height);c.textAlign='left';c.textBaseline='top';
    c.fillStyle='#ececec';c.font='700 18px "Bureau Pixel",monospace';c.fillText('The Bureau',18,14);
    c.fillStyle='#b4b4b4';c.font='13px "Bureau Pixel",monospace';c.fillText(this.telemetry?.connected===false?'Source disconnected':'Observed source events',18,38);
    for(const [i,label,value,color] of [[0,'Working',working,'#9dc5ed'],[1,'Need you',waiting,'#e8ba70'],[2,'Unknown',unknown,'#a8a8a8']]){
      const x=18+i*80;c.fillStyle=color;c.font='700 29px "Bureau Pixel",monospace';c.fillText(String(value),x,65);c.fillStyle='#b4b4b4';c.font='13px "Bureau Pixel",monospace';c.fillText(label,x,102);
    }
    tex.needsUpdate=true;
  }

  patternTexture(paint) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    paint(cv.getContext('2d'), 128);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;
    return t;
  }

  whiteboardScribbles(cx) {
    const g = new THREE.Group();
    const line = (pts, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)));
      g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
    };
    line([[-1.1, 0.35], [-0.6, 0.35]], 0x3b8ee0);
    line([[-1.1, 0.2], [-0.3, 0.2]], 0x3b8ee0);
    line([[0.0, 0.3], [0.4, 0.3], [0.4, 0.05], [0.0, 0.05], [0.0, 0.3]], 0xc96442);
    line([[0.4, 0.17], [0.65, 0.0]], 0xc96442);
    line([[0.65, 0.1], [1.05, 0.1], [1.05, -0.15], [0.65, -0.15], [0.65, 0.1]], 0xc96442);
    line([[-1.1, -0.35], [-0.9, -0.1], [-0.7, -0.3], [-0.5, -0.05], [-0.3, -0.25], [-0.1, 0.0]], 0x5f9a4c);
    g.position.set(cx, 1.4, 0.01);
    this.room.add(g);
  }

  buildDesk(dk,index=0) {
    const {x,y}=dk,ink=0x3a4c57,paper=0xd4d7c8,oak=0xa38664;
    // A coloured floor bay separates workers at overview scale, while the
    // station itself is a compact instrument table with an exposed status face.
    // Shared floor islands keep the workstation area visually coherent.
    this.boxMesh(x-.14,y+1.91,.030,1.83,.035,.006,0xe9eef4,{shadow:false});
    this.boxMesh(x,y,.68,1.55,.77,.10,paper,{rough:.9});
    this.boxMesh(x+.04,y+.03,.635,1.47,.71,.035,oak);
    for(const side of [.10,1.35])this.boxMesh(x+side,y+.10,0,.09,.52,.68,ink);
    this.boxMesh(x+.11,y+.56,.19,1.30,.08,.07,ink);
    // All monitors face the front, so faces and work signals stay readable from
    // the initial camera. No bitmap screen animations or per-frame textures.
    this.boxMesh(x+.42,y+.22,.78,.08,.16,.15,ink);
    this.boxMesh(x+.18,y+.12,.88,.75,.27,.49,ink);
    this.boxMesh(x+.22,y+.10,1.34,.67,.25,.055,0x718993);
    this.boxMesh(x+.27,y+.05,1.00,.52,.11,.26,0x718993);
    this.boxMesh(x+.84,y+.38,.97,.055,.022,.055,0xbcc9c3,{shadow:false});
    this.boxMesh(x+.245,y+.312,.955,.60,.015,.31,0xe3e9f1,{shadow:false});
    const screen=this.boxMesh(x+.275,y+.329,1.005,.54,.010,.22,0x233346,{shadow:false,uniqueMaterial:true});
    screen.material.emissive=new THREE.Color(0x000000);this.screens.set(dk,screen);
    this.boxMesh(x+.27,y+.46,.785,.60,.20,.035,0x899b9e,{shadow:false});
    for(let k=0;k<5;k++)this.boxMesh(x+.30+k*.10,y+.49,.822,.065,.12,.009,0xc0cabe,{shadow:false});
    // The task lamp is a solid soft-lit prop, not a costly point light per bay.
    this.boxMesh(x+1.24,y+.28,.78,.15,.17,.025,ink);
    this.boxMesh(x+1.30,y+.32,.79,.035,.035,.40,ink);
    this.boxMesh(x+1.18,y+.29,1.18,.26,.18,.08,0xe6aa65);
    this.boxMesh(x+1.20,y+.31,1.17,.22,.14,.012,0xffeed0,{emissive:0xffd99b,ei:.35,shadow:false});
    // Stool remains below the body and does not occlude picking at an orbit.
    this.boxMesh(dk.seat.x-.20,dk.seat.y-.18,.27,.40,.36,.085,oak);
    for(const lx of [-.14,.12])for(const ly of [-.12,.10])this.boxMesh(dk.seat.x+lx,dk.seat.y+ly,0,.04,.04,.27,ink);
  }

  buildProp(p) {
    const dark = false; // Scene lighting is independent of system UI theme.
    switch (p.t) {
      case 'panel':
        this.boxMesh(p.x, p.y, 0, p.w, p.d, p.h, new THREE.Color(p.color).getHex(), { rough: 1 });
        break;
      case 'rack': {
        this.boxMesh(p.x, p.y, 0, 0.7, 0.6, 1.9, 0x2a2d33, { metal: 0.3, rough: 0.5 });
        for (let r = 0; r < 7; r++) {
          for (let k = 0; k < 4; k++) {
            const led = this.boxMesh(p.x + 0.12 + k * 0.13, p.y + 0.6, 1.7 - r * 0.22, 0.05, 0.01, 0.03, 0x113322,
              { emissive: k % 3 === 0 ? 0xffb347 : 0x5cf08a, ei: 1, shadow: false });
            this.blinkers.push({ m: led, r, k });
          }
        }
        break;
      }
      case 'printer':
        this.boxMesh(p.x, p.y, 0, 0.75, 0.55, 0.55, dark ? 0x6e533b : 0xa8825a);
        this.boxMesh(p.x + 0.05, p.y + 0.05, 0.55, 0.65, 0.45, 0.28, 0xe8e8e8);
        this.boxMesh(p.x + 0.15, p.y + 0.35, 0.83, 0.45, 0.15, 0.02, 0xffffff);
        this.place('cardboardBoxClosed', p.x - 0.7, p.y + 0.05, 0.5, 0.5, { h: 0.35 });
        break;
      case 'plant':
        this.place('pottedPlant', p.x - 0.3, p.y - 0.3, 0.6, 0.6, { h: 1.0 });
        break;
      case 'pingpong': {
        const { x, y } = p;
        for (const [lx, ly] of [[0.1, 0.1], [2.4, 0.1], [0.1, 1.2], [2.4, 1.2]]) this.boxMesh(x + lx, y + ly, 0, 0.08, 0.08, 0.7, 0x333333);
        this.boxMesh(x, y, 0.7, 2.6, 1.4, 0.05, 0x2f7a52, { rough: 0.6 });
        this.boxMesh(x + 0.04, y + 0.69, 0.751, 2.52, 0.02, 0.002, 0xffffff, { shadow: false });
        this.boxMesh(x + 1.29, y - 0.05, 0.75, 0.02, 1.5, 0.17, 0xf4f4f4, { rough: 1 });
        this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        this.ball.castShadow = true;
        this.ball.visible = false;
        this.room.add(this.ball);
        break;
      }
      case 'vending': {
        this.boxMesh(p.x, p.y, 0, 0.7, 0.75, 1.85, new THREE.Color(p.color).getHex(), { rough: 0.5 });
        this.boxMesh(p.x + 0.7, p.y + 0.08, 0.7, 0.01, 0.47, 1.0, 0x0d1520, { emissive: 0x2a4a6a, ei: 0.5, shadow: false });
        const cols = [0xf2d16b, 0x5cf08a, 0xff8a65, 0x81d4fa, 0xce93d8];
        for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
          this.boxMesh(p.x + 0.62, p.y + 0.13 + k * 0.14, 0.82 + r * 0.22, 0.06, 0.07, 0.13, cols[(r * 3 + k) % 5], { emissive: cols[(r * 3 + k) % 5], ei: 0.25, shadow: false });
        }
        break;
      }
      case 'foosball': {
        const { x, y } = p;
        for (const [lx, ly] of [[0.1, 0.1], [1.42, 0.1], [0.1, 0.62], [1.42, 0.62]]) this.boxMesh(x + lx, y + ly, 0, 0.08, 0.08, 0.6, 0x5a4030);
        this.boxMesh(x, y, 0.6, 1.6, 0.8, 0.06, 0x6e533b);
        this.boxMesh(x + 0.05, y + 0.05, 0.66, 1.5, 0.7, 0.01, 0x2f8a4a, { shadow: false });
        this.boxMesh(x, y, 0.66, 1.6, 0.05, 0.18, 0x6e533b);
        this.boxMesh(x, y + 0.75, 0.66, 1.6, 0.05, 0.18, 0x6e533b);
        this.rods = []; this.foosball = p;
        for (let k = 0; k < 6; k++) {
          const rod = new THREE.Group();
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.7, roughness: 0.3 }));
          bar.rotation.x = Math.PI / 2;
          rod.add(bar);
          for (let m = 0; m < 2; m++) {
            const man = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xc0392b : 0x2f6fb0 }));
            man.position.set(0, -0.03, -0.15 + m * 0.3);
            man.castShadow = true;
            rod.add(man);
          }
          rod.position.set(x + 0.2 + k * 0.24, 0.8, y + 0.4);
          this.room.add(rod);
          this.rods.push(rod);
        }
        break;
      }
      case 'booth': {
        const { x, y } = p;
        const felt = new THREE.MeshStandardMaterial({ color: dark ? 0x3c4a5a : 0x9fb3c8, roughness: 1 });
        this.boxMesh(x, y - 0.05, 0, 1.3, 0.05, 2.0, 0, { mat: felt });
        this.boxMesh(x - 0.05, y, 0, 0.05, 1.3, 2.0, 0, { mat: felt });
        this.boxMesh(x + 1.25, y, 0, 0.05, 1.3, 2.0, 0, { mat: this.glassMat(), shadow: false });
        this.boxMesh(x, y + 1.25, 0, 0.85, 0.05, 2.0, 0, { mat: this.glassMat(), shadow: false });
        this.boxMesh(x - 0.05, y - 0.05, 2.0, 1.4, 1.4, 0.06, dark ? 0x4a5868 : 0xb5c4d3);
        this.place('stoolBar', x + 0.45, y + 0.4, 0.4, 0.4, { h: 0.5 });
        const l = new THREE.PointLight(0xffd9a0, 0.6, 2.5);
        l.position.set(x + 0.65, 1.85, y + 0.65);
        this.room.add(l);
        break;
      }
      case 'glass':
        if (p.w === 0) this.boxMesh(p.x - 0.03, p.y, 0, 0.06, p.d, 2.1, 0, { mat: this.glassMat(), shadow: false });
        else this.boxMesh(p.x, p.y - 0.03, 0, p.w, 0.06, 2.1, 0, { mat: this.glassMat(), shadow: false });
        if (p.w === 0) this.boxMesh(p.x - 0.04, p.y, 0, 0.08, p.d, 0.12, dark ? 0x2b2926 : 0xcfc5b3);
        else this.boxMesh(p.x, p.y - 0.04, 0, p.w, 0.08, 0.12, dark ? 0x2b2926 : 0xcfc5b3);
        break;
      case 'meetingTable':
        this.place('table', p.x, p.y, p.w, p.d, { h: 0.75 });
        this.place('laptop', p.x + 1.2, p.y + 0.45, 0.45, 0.35, { y0: 0.75 });
        break;
      case 'chair':
        this.place('chairModernCushion', p.x - 0.28, p.y - 0.28, 0.56, 0.56, { h: 0.85, rot: p.face === 'front' ? 0 : Math.PI });
        break;
      case 'counter': {
        const n = Math.max(1, Math.round(p.w / 0.7));
        const u = p.w / n;
        for (let i = 0; i < n; i++) {
          const ux = p.x + i * u;
          const isSink = Math.abs(ux + u / 2 - (p.x + 3.15)) < u / 2;
          this.place(isSink ? 'kitchenSink' : 'kitchenCabinet', ux, p.y, u, p.d, { h: 0.9, stretch: true });
        }
        this.place('kitchenMicrowave', p.x + p.w - 0.75, p.y + 0.1, 0.55, 0.4, { y0: 0.9, h: 0.32 });
        this.place('toaster', p.x + 0.2, p.y + 0.2, 0.3, 0.2, { y0: 0.9, h: 0.18 });
        break;
      }
      case 'coffee':
        this.place('kitchenCoffeeMachine', p.x, p.y, 0.45, 0.4, { y0: 0.9, h: 0.5 });
        break;
      case 'fridge':
        this.place('kitchenFridgeLarge', p.x, p.y, 0.85, 0.75, { h: 1.95, stretch: true });
        break;
      case 'cooler': {
        this.boxMesh(p.x, p.y, 0, 0.42, 0.42, 0.95, 0xe8ecef, { rough: 0.4 });
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 16),
          new THREE.MeshPhysicalMaterial({ color: 0x8ec5f2, transparent: true, opacity: 0.65, roughness: 0.1 }));
        bottle.position.set(p.x + 0.21, 0.95 + 0.21, p.y + 0.21);
        this.room.add(bottle);
        break;
      }
      case 'sink':
        break; // part of the counter
      case 'roundTable':
        this.place('tableRound', p.x - 0.45, p.y - 0.45, 0.9, 0.9, { h: 0.75 });
        break;
      case 'barStool':
        this.place('stoolBar', p.x - 0.2, p.y - 0.2, 0.4, 0.4, { h: 0.5 });
        break;
      case 'shelf': {
        const n = Math.max(1, Math.round(p.w / 0.9));
        const u = p.w / n;
        for (let i = 0; i < n; i++) {
          const b = this.place('bookcaseOpen', p.x + i * u, p.y, u, p.d, { h: 1.45, stretch: true });
          if (!b) continue;
          // book stacks on each shelf
          b.updateMatrixWorld(true);
          const ray = new THREE.Raycaster();
          for (let k = 0; k < 2; k++) {
            const bx = p.x + i * u + 0.2 + k * (u - 0.4) * 0.6;
            ray.set(new THREE.Vector3(bx + 0.1, 1.6, p.y + p.d / 2), new THREE.Vector3(0, -1, 0));
            for (const hit of ray.intersectObject(b, true)) {
              if (hit.face && hit.face.normal.y > 0.5 && hit.point.y < 1.4) {
                this.place('books', bx, p.y + 0.06, 0.25, p.d - 0.12, { y0: hit.point.y, h: 0.14 + ((i + k) % 3) * 0.03 });
              }
            }
          }
        }
        break;
      }
      case 'couch':
        this.place('loungeSofa', p.x - 0.1, p.y - 0.15, p.w + 0.2, p.d + 0.2, { h: 0.8, stretch: true });
        break;
      case 'coffeeTable':
        this.place('tableCoffee', p.x, p.y, p.w, p.d, { h: 0.35 });
        this.place('radio', p.x + 1.0, p.y + 0.2, 0.3, 0.18, { y0: 0.35, h: 0.18 });
        break;
      case 'beanbag': {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.95 }));
        m.scale.set(1, 0.5, 1);
        m.position.set(p.x, 0.2, p.y);
        m.castShadow = m.receiveShadow = true;
        this.room.add(m);
        break;
      }
      case 'arcade': {
        const { x, y } = p;
        this.boxMesh(x, y, 0, 0.7, 0.7, 1.75, 0x3a2a6a, { rough: 0.6 });
        this.arcadeScreen = this.boxMesh(x + 0.1, y + 0.7, 1.0, 0.5, 0.01, 0.45, 0x000000, { emissive: 0xff44aa, ei: 1, shadow: false });
        this.boxMesh(x, y + 0.7, 1.55, 0.7, 0.02, 0.17, 0xffcf4a, { emissive: 0xffcf4a, ei: 0.6, shadow: false });
        this.boxMesh(x, y + 0.7, 0.8, 0.7, 0.2, 0.08, 0x4a3a8a);
        break;
      }
      case 'lamp':
        this.place('lampRoundFloor', p.x - 0.25, p.y - 0.25, 0.5, 0.5, { h: 1.7 });
        this.lampLight = new THREE.PointLight(0xffd9a0, 0, 4);
        this.lampLight.position.set(p.x, 1.6, p.y);
        this.room.add(this.lampLight);
        break;
      case 'rug':
        this.place('rugRectangle', p.x, p.y, p.w, p.d, { y0: 0.004 });
        break;
    }
  }

  // ------------------------------------------------------------ scene packs

  buildScene() {
    const def = this.plan.scene;
    this.clearRoom();
    this.room = new THREE.Group();
    this.scene.add(this.room);
    this.screens.clear();
    this.blinkers = [];
    this.bobbers = [];
    this.flames = [];
    this.pendants = [];
    this.pulsers = [];
    this.windowMat = null;
    this.clearMat = null;
    this.stars = null;
    this.planet = null;
    this.scene.background = def.background === null ? null : new THREE.Color(def.background || def.sky || '#9fd3ef');
    if (def.fog) this.scene.fog = new THREE.Fog(def.fog[0], def.fog[1], def.fog[2]);

    if (def.water) {
      const geo = new THREE.PlaneGeometry(160, 160, 80, 80);
      geo.rotateX(-Math.PI / 2);
      this.water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: def.water.color, roughness: 0.35, metalness: 0.05, flatShading: true,
      }));
      this.water.position.set(def.W / 2, -0.08, def.D / 2);
      this.water.receiveShadow = true;
      this.waterBase = geo.attributes.position.array.slice();
      this.room.add(this.water);
      if (def.water.island) {
        const [cx, cz, rx, rz] = def.water.island;
        const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 48),
          new THREE.MeshStandardMaterial({ color: def.water.shallow, transparent: true, opacity: 0.7, roughness: 0.5 }));
        sh.rotation.x = -Math.PI / 2;
        sh.scale.set(rx, rz, 1);
        sh.position.set(cx, -0.035, cz);
        this.room.add(sh);
      }
    }
    for (const p of def.props) this.buildSceneProp(p);
    this.fitCamera3D(!this.fitted);
  }

  // Top of the ground (sand, dock…) under a point, ignoring anything taller
  // than a step. Props stand on it; y0 in the manifest is relative to it.
  surfaceAt(x, z) {
    this.room.updateMatrixWorld(true); // boxes added so far have no world matrix until a render
    return this.surfaceBelow(x, z, 0.6, 2);
  }

  buildSceneProp(p) {
    const flat = ['sandbase', 'floor', 'wall', 'sign', 'pendant', 'stars', 'planet', 'lamp'];
    const ground = (p.m && p.m.startsWith('patch-')) || flat.includes(p.special) || p.abs ? 0 : this.surfaceAt(p.x + (p.w || 0) / 2, p.y + (p.d || 0) / 2);
    if (p.special === 'fire') return this.buildFire(p.x, p.y, ground + (p.y0 || 0), p);
    if (p.special === 'target') return this.buildTarget(p, ground);
    if (p.special === 'well') return this.buildWell(p, ground);
    if (p.special === 'map') return this.buildMap({ ...p, y0: ground + (p.y0 ?? 0.78) });
    if (p.special === 'dock') return this.buildDock(p);
    if (p.special === 'floor') return this.buildFloor(p);
    if (p.special === 'stars') return this.buildStars(p);
    if (p.special === 'lamp') {
      // an unseen ceiling light
      const l = new THREE.PointLight(p.color || '#ffffff', p.intensity ?? 1, p.range || 6);
      l.position.set(p.x, p.z || 2.3, p.y);
      this.room.add(l);
      return;
    }
    if (p.special === 'planet') return this.buildPlanet(p);
    if (p.special === 'glow') {
      // an emissive strip or panel (light bars, screens, floor markings)
      const m = this.boxMesh(p.x, p.y, ground + (p.y0 || 0), p.w, p.d, p.h || 0.03, 0, {
        mat: new THREE.MeshStandardMaterial({ color: p.color || '#5ad1ff', emissive: p.color || '#5ad1ff', emissiveIntensity: p.intensity ?? 1.2 }), shadow: false,
      });
      if (p.pulse) (this.pulsers = this.pulsers || []).push({ m, base: p.intensity ?? 1.2, ph: p.x + p.y });
      return m;
    }
    if (p.special === 'wall') return this.buildWall(p);
    if (p.special === 'sign') return this.buildSign(p);
    if (p.special === 'pendant') return this.buildPendant(p);
    if (p.special === 'box') return this.boxMesh(p.x, p.y, ground + (p.y0 || 0), p.w, p.d, p.h, new THREE.Color(p.color || '#888').getHex(), { rough: p.rough ?? 0.8, metal: p.metal || 0 });
    if (p.special === 'glass') return this.boxMesh(p.x, p.y, ground + (p.y0 || 0), p.w, p.d, p.h, 0, { mat: this.glassMat(), shadow: false });
    if (p.special === 'sandbase') {
      // a flat bed of sand under the island so seams between sand patches
      // show sand (and can be stood on) instead of the sea
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 40),
        new THREE.MeshStandardMaterial({ color: p.color || '#d9a46c', roughness: 1 }));
      m.scale.set(p.rx, 1, p.rz);
      m.position.set(p.x, (p.top ?? 0.27) - 0.25, p.y);
      m.receiveShadow = true;
      this.room.add(m);
      return;
    }
    const name = p.m ? `scene:${p.m}` : p.f;
    const m = this.place(name, p.x, p.y, p.w, p.d, {
      rot: ((p.rot || 0) * Math.PI) / 180, y0: ground + (p.y0 || 0), h: p.h || null, stretch: !!p.stretch,
    });
    if (m && p.bob) this.bobbers.push({ m, y: m.position.y, ph: p.x * 0.7 });
  }

  buildFire(x, y, ground = 0.25, opts = {}) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 8), wood);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i * Math.PI) / 3;
      log.position.y = 0.32;
      log.castShadow = true;
      g.add(log);
    }
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, flatShading: true });
    for (let i = 0; i < (opts.stones === false ? 0 : 9); i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09), stone);
      r.position.set(Math.cos(a) * 0.45, 0.3, Math.sin(a) * 0.45);
      r.castShadow = true;
      g.add(r);
    }
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 7), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 }));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.38, 7), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
    outer.position.y = 0.6; inner.position.y = 0.55;
    const light = new THREE.PointLight(0xffa040, 1.4, 6);
    light.position.y = 0.9;
    g.add(outer, inner, light);
    g.position.set(x, ground - 0.25, y); // parts are laid out for a 0.25 sand top
    if (opts.scale) g.scale.setScalar(opts.scale);
    this.room.add(g);
    this.flames.push({ outer, inner, light });
  }

  // Floor: planks, tiles or a checkerboard over a rectangle.
  buildFloor(p) {
    const dark = false; // Scene lighting is independent of system UI theme.
    const a = p.color || (dark ? '#4a3f35' : '#d4b68f');
    const b = p.color2 || (dark ? '#3e342b' : '#d6bf9c');
    const tex = this.patternTexture((c, s) => {
      c.fillStyle = a; c.fillRect(0, 0, s, s);
      if (p.pattern === 'checker') {
        c.fillStyle = b; c.fillRect(0, 0, s / 2, s / 2); c.fillRect(s / 2, s / 2, s / 2, s / 2);
      } else {
        c.strokeStyle = b; c.lineWidth = 3;
        for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(0, (i * s) / 4); c.lineTo(s, (i * s) / 4); c.stroke(); }
        for (let i = 0; i < 4; i++) { const x = (((i * 37) % 4) + 0.5) * (s / 4); c.beginPath(); c.moveTo(x, (i * s) / 4); c.lineTo(x, ((i + 1) * s) / 4); c.stroke(); }
      }
    });
    tex.repeat.set(p.w / (p.tile || 2), p.d / (p.tile || 2));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x + p.w / 2, p.y0 || 0.002, p.y + p.d / 2);
    m.receiveShadow = true;
    this.room.add(m);
  }

  // Wall along x (axis "x": from x to x+len at depth y) or along z (axis
  // "z": from y to y+len at x), with optional window/door openings
  // [from, length, bottom, top] measured along the wall.
  buildWall(p) {
    const h = p.h || 2.4, t = p.t || 0.12;
    const mat = new THREE.MeshStandardMaterial({ color: p.color || (this.pal.dark ? '#4a4640' : '#f1ebe0'), roughness: 0.95 });
    if (p.clear) {
      this.clearMat = this.clearMat || new THREE.MeshPhysicalMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false });
    } else if (!this.windowMat) {
      this.windowMat = new THREE.MeshStandardMaterial({ color: this.plan.scene.sky || '#a9d4f2', emissive: this.plan.scene.sky || '#a9d4f2', emissiveIntensity: 0.6 });
    }
    const paneMat = p.clear ? this.clearMat : this.windowMat;
    const seg = (a, len, z0, z1) => {
      if (len <= 0.001 || z1 - z0 <= 0.001) return;
      if (p.axis === 'z') this.boxMesh(p.x - t, p.y + a, z0, t, len, z1 - z0, 0, { mat });
      else this.boxMesh(p.x + a, p.y - t, z0, len, t, z1 - z0, 0, { mat });
    };
    const holes = (p.holes || []).slice().sort((u, v) => u[0] - v[0]);
    let at = 0;
    for (const [from, len, bot, top] of holes) {
      seg(at, from - at, 0, h);
      seg(from, len, 0, bot);
      seg(from, len, top, h);
      if (bot > 0.05) {
        // window pane + a mullion in the middle
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, top - bot), paneMat);
        if (p.axis === 'z') { pane.rotation.y = Math.PI / 2; pane.position.set(p.x - t / 2, (bot + top) / 2, p.y + from + len / 2); }
        else pane.position.set(p.x + from + len / 2, (bot + top) / 2, p.y - t / 2);
        this.room.add(pane);
        const frame = new THREE.Color(p.frame || '#2b2926').getHex();
        for (let k = 1; k < Math.round(len / 1.2); k++) {
          const f = from + (len * k) / Math.round(len / 1.2);
          if (p.axis === 'z') this.boxMesh(p.x - 0.04, p.y + f - 0.03, bot, 0.04, 0.06, top - bot, frame);
          else this.boxMesh(p.x + f - 0.03, p.y - 0.04, bot, 0.06, 0.04, top - bot, frame);
        }
        if (p.axis === 'z') this.boxMesh(p.x - 0.02, p.y + from, bot - 0.05, 0.14, len, 0.05, frame);
        else this.boxMesh(p.x + from, p.y - 0.02, bot - 0.05, len, 0.14, 0.05, frame);
      } else if (p.door) {
        const door = new THREE.Color(p.door).getHex();
        if (p.axis === 'z') this.boxMesh(p.x - 0.06, p.y + from + 0.05, 0, 0.05, len - 0.1, top - 0.05, door);
        else this.boxMesh(p.x + from + 0.05, p.y - 0.06, 0, len - 0.1, 0.05, top - 0.05, door);
      }
      at = from + len;
    }
    seg(at, (p.len || 0) - at, 0, h);
  }

  // Text on a board, flat against a wall (face "+z" or "+x").
  buildSign(p) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = Math.round(512 * p.h / p.w);
    const c = cv.getContext('2d');
    c.fillStyle = p.bg || '#2b2b2b'; c.fillRect(0, 0, cv.width, cv.height);
    if (p.border) { c.strokeStyle = p.border; c.lineWidth = 14; c.strokeRect(7, 7, cv.width - 14, cv.height - 14); }
    c.fillStyle = p.fg || '#fff';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const lines = String(p.text || '').split('\n');
    const size = Math.min(cv.height / (lines.length + 0.6), (cv.width * 1.6) / Math.max(...lines.map((l) => l.length), 1));
    c.font = `700 ${Math.round(size)}px ${p.font || 'ui-rounded, "Comic Sans MS", system-ui, sans-serif'}`;
    lines.forEach((l, i) => c.fillText(l, cv.width / 2, (cv.height * (i + 0.8)) / (lines.length + 0.6)));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: p.glow ? '#ffffff' : '#000000', emissiveMap: p.glow ? tex : null, emissiveIntensity: p.glow ? 0.9 : 0 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
    if (p.face === '+x') { m.rotation.y = Math.PI / 2; m.position.set(p.x + 0.01, p.z, p.y); }
    else m.position.set(p.x, p.z, p.y + 0.01);
    this.room.add(m);
  }

  // A field of stars on a big sphere around the scene.
  buildStars(p) {
    const n = p.count || 900, r = p.r || 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, k = Math.sqrt(1 - u * u);
      pos[i * 3] = this.plan.W / 2 + Math.cos(a) * k * r;
      pos[i * 3 + 1] = u * r * 0.6;
      pos[i * 3 + 2] = this.plan.D / 2 + Math.sin(a) * k * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: p.size || 0.35, sizeAttenuation: true, fog: false }));
    this.room.add(this.stars);
  }

  // A planet (with an optional ring) out beyond the windows.
  buildPlanet(p) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const c = cv.getContext('2d');
    const cols = p.colors || ['#e08a5a', '#c76b45', '#f0b27a', '#a85a3c'];
    for (let y = 0; y < 128; y += 4) { c.fillStyle = cols[Math.floor((Math.sin(y * 0.21) + 1) * 1.99) % cols.length]; c.fillRect(0, y, 256, 4); }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(p.r || 6, 40, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, fog: false }));
    planet.position.set(p.x, p.z || 0, p.y);
    planet.rotation.z = 0.35;
    this.room.add(planet);
    if (p.ring) {
      const ring = new THREE.Mesh(new THREE.RingGeometry((p.r || 6) * 1.3, (p.r || 6) * 1.75, 64),
        new THREE.MeshBasicMaterial({ color: p.ring, transparent: true, opacity: 0.4, side: THREE.DoubleSide, fog: false }));
      ring.position.copy(planet.position);
      ring.rotation.x = -Math.PI / 2 + 0.45;
      ring.rotation.y = 0.3;
      this.room.add(ring);
    }
    this.planet = planet;
  }

  // An archery target on a wooden stand, facing `yaw` degrees.
  buildTarget(p, ground) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 1 });
    for (const dz of [-0.28, 0.28]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), wood);
      leg.position.set(-0.12, 0.6, dz); leg.rotation.z = 0.18; leg.castShadow = true; g.add(leg);
    }
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    ['#f4efe2', '#d23c2f', '#f4efe2', '#d23c2f', '#f2c14e'].forEach((col, i) => {
      c.fillStyle = col; c.beginPath(); c.arc(64, 64, 62 - i * 12, 0, Math.PI * 2); c.fill();
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.38, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 32), new THREE.MeshStandardMaterial({ color: 0xd8c08a, roughness: 1 }));
    back.rotation.z = Math.PI / 2; back.position.set(0, 0.95, 0); back.castShadow = true;
    face.rotation.y = Math.PI / 2; face.position.set(0.045, 0.95, 0);
    g.add(back, face);
    g.rotation.y = ((p.yaw ?? -90) * Math.PI) / 180 + Math.PI / 2;
    g.position.set(p.x, ground, p.y);
    this.room.add(g);
  }

  // A stone well with a little roof and a bucket.
  buildWell(p, ground) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 1, flatShading: true });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.6, 12, 1, true), stone);
    ring.material.side = THREE.DoubleSide; ring.position.y = 0.3; ring.castShadow = true;
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshStandardMaterial({ color: 0x2f6f9a, roughness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.35;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 1 });
    for (const dx of [-0.5, 0.5]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 0.08), wood); post.position.set(dx, 0.95, 0); post.castShadow = true; g.add(post); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.45, 4), new THREE.MeshStandardMaterial({ color: 0x9c3b2e, roughness: 0.9 }));
    roof.position.y = 1.8; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.16, 10), wood);
    bucket.position.set(0, 1.05, 0);
    g.add(ring, water, roof, bucket);
    g.position.set(p.x, ground, p.y);
    this.room.add(g);
  }

  // A hanging lamp: cord, shade and a soft warm light.
  buildPendant(p) {
    const top = p.top || 2.5, drop = p.drop || 0.8;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, drop, 4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    cord.position.set(p.x, top - drop / 2, p.y);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 16, 1, true), new THREE.MeshStandardMaterial({ color: p.color || '#2f3b36', side: THREE.DoubleSide, roughness: 0.6 }));
    shade.position.set(p.x, top - drop, p.y);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe7b0' }));
    bulb.position.set(p.x, top - drop - 0.07, p.y);
    const light = new THREE.PointLight(0xffd9a0, 0.7, 3.5);
    light.position.set(p.x, top - drop - 0.15, p.y);
    this.room.add(cord, shade, bulb, light);
    this.pendants.push(light);
  }

  // A plank boardwalk on posts, from the shore out over the water.
  buildDock(p) {
    const top = p.top ?? 0.32;
    const planks = [0x9c6b3c, 0xa8774a, 0x8f6236];
    for (let z = p.y, i = 0; z < p.y + p.d - 0.05; z += 0.3, i++) {
      this.boxMesh(p.x, z, top - 0.07, p.w, 0.26, 0.07, planks[i % 3], { rough: 0.95 });
    }
    for (const side of [p.x - 0.02, p.x + p.w - 0.1]) this.boxMesh(side, p.y, top - 0.16, 0.12, p.d, 0.1, 0x6b4426);
    for (let z = p.y + 0.1; z < p.y + p.d; z += 1.6) {
      for (const x of [p.x + 0.02, p.x + p.w - 0.14]) this.boxMesh(x, z, -0.9, 0.12, 0.12, top + 0.95, 0x5c3a20);
    }
    // a rope post at the far end
    this.boxMesh(p.x + p.w - 0.2, p.y + 0.05, top - 0.1, 0.14, 0.14, 0.55, 0x5c3a20);
  }

  buildMap(p) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 160;
    const c = cv.getContext('2d');
    c.fillStyle = '#e9d5a6'; c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#8a6a3a'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(40, 120); c.bezierCurveTo(30, 60, 90, 20, 140, 40); c.bezierCurveTo(200, 60, 230, 110, 180, 135); c.bezierCurveTo(130, 150, 60, 150, 40, 120); c.stroke();
    c.setLineDash([6, 6]); c.strokeStyle = '#6b4426'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(70, 110); c.quadraticCurveTo(110, 60, 165, 95); c.stroke();
    c.setLineDash([]); c.strokeStyle = '#c0392b'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(158, 88); c.lineTo(174, 104); c.moveTo(174, 88); c.lineTo(158, 104); c.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x + p.w / 2, (p.y0 || 0.78) + 0.005, p.y + p.d / 2);
    m.receiveShadow = true;
    this.room.add(m);
  }

  animateScene(t, sky) {
    const def = this.plan.scene;
    if (this.water) {
      const pos = this.water.geometry.attributes.position;
      const a = pos.array, b = this.waterBase;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] = Math.sin(b[i] * 0.45 + t * 1.1) * 0.06 + Math.cos(b[i + 2] * 0.38 + t * 0.8) * 0.05;
      }
      pos.needsUpdate = true;
      if ((this.waterTick = (this.waterTick || 0) + 1) % 3 === 0) this.water.geometry.computeVertexNormals();
    }
    for (const b of this.bobbers) {
      b.m.position.y = b.y + Math.sin(t * 0.9 + b.ph) * 0.05;
      b.m.rotation.x = Math.sin(t * 0.7 + b.ph) * 0.015;
    }
    for (const f of this.flames) {
      const k = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.07;
      f.outer.scale.set(1, k, 1);
      f.inner.scale.set(1, 1.6 - k * 0.6, 1);
      f.light.intensity = (sky.night ? 3 : 1.2) * k;
    }
    if (this.scene.background && !def.fixedSky) this.scene.background.set(sky.night ? '#13213f' : (def.background || def.sky || '#9fd3ef'));
    if (this.planet) this.planet.rotation.y = t * 0.03;
    if (this.stars) this.stars.rotation.y = t * 0.004;
    for (const g of this.pulsers || []) g.m.material.emissiveIntensity = g.base * (0.65 + 0.35 * Math.sin(t * 2.2 + g.ph));
    if (this.windowMat) { this.windowMat.color.set(sky.night ? '#1d2747' : def.sky); this.windowMat.emissive.set(sky.night ? '#1d2747' : def.sky); }
    for (const l of this.pendants || []) l.intensity = sky.night ? 1.6 : 0.7;
    if (this.scene.fog) this.scene.fog.color.set(sky.night ? '#1b2a4a' : def.fog[0]);
  }

  // ------------------------------------------------------------ camera

  fitCamera3D(reset) {
    const { W, D } = this.plan;
    const center = new THREE.Vector3(W / 2, 0.6, D / 2);
    if (reset || !this.fitted) {
      const dist = 40;
      this.camera.position.set(center.x + dist * 0.62, center.y + dist * 0.58, center.z + dist * 0.62);
      this.controls.target.copy(center);
      this.camera.zoom = 1;
      this.fitted = true;
    }
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
    // Fit the room's corners into the view.
    const inv = this.camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [0, W]) for (const y of [0, this.plan.viewH || WALL_H]) for (const z of [0, D]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    // Fit the room into the part of the canvas the panel leaves visible, then
    // extend the frustum over the covered part so the canvas never resizes.
    const vw = Math.max(120, this.cw - this.inset());
    const aspect = vw / this.ch;
    let w = (maxX - minX) * 1.12, h = (maxY - minY) * 1.16;
    // Leave room for screen-space badges and bubbles in a small PiP window.
    if (this.compact) h *= this.ch / Math.max(80, this.ch - 48);
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    const cxv = (minX + maxX) / 2, cyv = (minY + maxY) / 2;
    const full = w * (this.cw / vw);
    Object.assign(this.camera, { left: cxv - w / 2, right: cxv - w / 2 + full, top: cyv + h / 2, bottom: cyv - h / 2 });
    this.camera.updateProjectionMatrix();
    // Sun casts shadows over the whole room.
    this.sun.position.set(center.x - 8, 14, center.z + 6);
    this.sun.target.position.copy(center);
    const sc = this.sun.shadow.camera;
    const r = Math.max(W, D) * 0.75;
    Object.assign(sc, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 50 });
    sc.updateProjectionMatrix();
    if(this.focusedKey&&!reset)this.focusAgent(this.focusedKey);
  }

  setInset(px, animate = true) {
    super.setInset(px, animate);
    this.insetSettling = true;
    if (!animate && this.room) this.fitCamera3D(false);
  }

  resize() {
    super.resize();
    if (!this.gl) return;
    // Integer CSS pixels per rendered pixel. The camera/picking canvas stays
    // at CSS resolution, so orbit, labels and hit targets keep their accuracy.
    this.pixelSize=this.cw>=900?2:1;
    this.gl.setSize(Math.ceil(this.cw/this.pixelSize),Math.ceil(this.ch/this.pixelSize),false);
    this.gl.domElement.style.width = this.cw + 'px';
    this.gl.domElement.style.height = this.ch + 'px';
    if (this.room) this.fitCamera3D(false);
  }

  // ------------------------------------------------------------ actors

  dotModel() { return dotMascot(); }
  codexModel() { return codexMascot(); }

  actorFor(p) {
    let a = this.actors.get(p.key);
    if (a) return a;
    const procedural=true;
    const obj=p.s.agent==='dot'?this.dotModel():workerMascot(p.s.agent,p.h);
    obj.userData.sessionKey=p.key;
    obj.traverse(o=>{if(o.isMesh){o.userData.sessionKey=p.key;o.userData.sharedMascot=procedural;}});
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = !o.userData.outline; o.receiveShadow = !o.userData.outline; } });
    const box = new THREE.Box3().setFromObject(obj);
    const s = CHAR_HEIGHT * (p.s && p.s.subagent ? 0.94 : 1) / (box.max.y - box.min.y);
    obj.scale.setScalar(s);
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {};

    let head = null, armR = null;
    obj.traverse((o) => { if (o.name === 'head') head = o; if (o.name === 'arm-right') armR = o; });
    const prop = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.04), new THREE.MeshStandardMaterial({ color: 0xc96442 }));
    prop.add(cup, book);
    const halo=new THREE.Mesh(new THREE.RingGeometry(.38,.43,40),new THREE.MeshBasicMaterial({color:0x858882,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));
    halo.rotation.x=-Math.PI/2;halo.visible=false;
    this.scene.add(obj, prop, halo);
    a = { obj, halo, procedural, localBounds:box.clone(), bounds: new THREE.Box3(), labelAnchor:obj.getObjectByName('label-anchor'), anchor:new THREE.Vector3(), mixer, actions, current: null, head, headRest: head ? head.rotation.x : 0, armR, prop, cup, book, yaw: 0, last: { x: p.x, y: p.y } };
    a.pickMeshes=[];a.signals=[];obj.traverse(o=>{if(o.isMesh&&!o.userData.outline)a.pickMeshes.push(o);if(o.userData.signal)a.signals.push(o);});
    a.limbs=['arm-left','arm-right','leg-left','leg-right'].map(name=>obj.getObjectByName(name));
    if(this.outlinesEnabled===false)obj.traverse(o=>{if(o.userData.outline)o.visible=false;});
    this.actors.set(p.key, a);
    return a;
  }

  play(a, name) {
    if (a.current === name) return;
    const next = a.actions[name] || a.actions.idle;
    if (!next) return;
    next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (a.current && a.actions[a.current]) a.actions[a.current].fadeOut(0.25);
    a.current = name;
  }

  facing(p, st) {
    if (st.pose === 'walk') return null;
    if (p.mode === 'work' && p.desk) {
      if (p.desk.yaw != null) return p.desk.yaw;
      return p.desk.side === 'n' ? 0 : Math.PI;
    }
    const q = p.poi;
    if (!q) return null;
    if (q.yaw != null) return q.yaw;
    if (q.pair) {
      const other = this.plan.pois.find((o) => o.pair === q.pair && o !== q);
      return Math.atan2(other.x - q.x, 0);
    }
    if (q.act === 'vending' || q.act === 'plant') return -Math.PI / 2;
    return st.face === 'back' ? Math.PI : 0;
  }

  syncActors(dt) {
    for (const [k, a] of this.actors) {
      if (!this.people.has(k)) this.removeActor(k, a);
    }
    for (const p of this.people.values()) {
      const a = this.actorFor(p);
      const st = this.stateOf(p);
      p.pose = st.pose;
      const anim = {
        walk: 'walk', wave: 'emote-yes', coffee: 'holding-right', water: 'holding-right', read: 'holding-both',
        phone: 'holding-right', arcade: 'interact-right', whiteboard: 'interact-right', foosball: 'interact-left',
        pingpong: 'interact-right', vending: 'interact-right', fridge: 'interact-left', sink: 'interact-right',
      }[st.pose === 'walk' ? 'walk' : st.act] || (st.pose === 'sit' ? 'sit' : 'idle');
      let chosen = anim;
      if (st.act === 'station') chosen = p.s.status === 'thinking' ? 'idle' : (p.desk.anim || 'interact-right');
      else if (st.pose !== 'walk' && p.poi && p.poi.anim) chosen = p.poi.anim;
      this.play(a, chosen);
      if (!this.reducedMotion && !this.motionPaused) a.mixer.update(dt);
      const statusColor=STATUS_COLOR[p.s.status]||0xb5bbc6;
      for(const signal of a.signals){signal.material.color.setHex(statusColor);}
      if(a.procedural){
        const walking=st.pose==='walk'&&!this.reducedMotion&&!this.motionPaused&&this.focusedKey!==p.key;
        for(const side of ['left','right']){
          const limb=a.obj.getObjectByName('arm-'+side),leg=a.obj.getObjectByName('leg-'+side);
          const busy=['tool','typing'].includes(p.s.status)&&!p.path.length&&!this.reducedMotion&&!this.motionPaused;
          const swing=walking?Math.sin(this.t*.009+p.phase)*(side==='left'?1:-1)*.28:busy?-.32+Math.sin(this.t*.006+p.phase+(side==='left'?0:Math.PI))*.055:0;
          if(limb)limb.rotation.x=swing;
          if(leg)leg.rotation.x=-swing*.8;
        }
      }

      // position + facing
      const dx = p.x - a.last.x, dy = p.y - a.last.y;
      let want = st.pose !== 'walk' && p.poi && p.poi.float ? null : this.facing(p, st);
      if (want == null && Math.hypot(dx, dy) > 0.001) want = Math.atan2(dx, dy);
      if (want != null) {
        let d = want - a.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        a.yaw += d * Math.min(1, dt * 10);
      }
      a.last = { x: p.x, y: p.y };
      a.obj.rotation.y = a.yaw;
      const seatY = st.pose === 'sit' ? this.seatHeight(p.x, p.y, st.sitZ)
        : this.plan.terrain ? this.groundHeight(p.x, p.y) : 0;
      // The sit pose's torso leans back past its origin; slide the body
      // forward so the back rests against the backrest instead of in it.
      const fwd = st.pose === 'sit' && !a.procedural ? SIT_FORWARD : 0;
      let lift = 0;
      if (st.pose !== 'walk' && p.poi && p.poi.float) {
        // zero gravity: drift up and down, slowly turning
        const k = this.t / 1000 + p.phase;
        lift = 0.45 + Math.sin(k * 0.9) * 0.18;
        a.yaw += dt * 0.35;
      }
      const baseY = a.procedural && st.pose==='sit' ? Math.max(0,seatY-.22) : seatY;
      a.obj.position.set(p.x + Math.sin(a.yaw) * fwd, baseY + lift, p.y + Math.cos(a.yaw) * fwd);
      a.halo.visible = this.selectedKey===p.key || this.hoverKey===p.key || ['waiting','error'].includes(p.s.status);
      a.halo.material.color.setHex(['waiting','error'].includes(p.s.status)?STATUS_COLOR[p.s.status]:0x9b9b9b);
      a.halo.position.set(a.obj.position.x,.016,a.obj.position.z);
      if (a.head) {
        if (st.act === 'nap') { a.head.rotation.x = a.headRest + 0.55; a.napped = true; }
        else if (a.napped) { a.head.rotation.x = a.headRest; a.napped = false; }
      }
      // hand-held props
      a.cup.visible = !a.procedural && (st.act === 'coffee' || st.act === 'water' || (st.pose !== 'walk' && p.poi && p.poi.prop === 'cup'));
      a.book.visible = !a.procedural && st.act === 'read';
      if (a.armR && (a.cup.visible || a.book.visible)) {
        a.obj.updateMatrixWorld(true);
        const hand = new THREE.Vector3(0, -0.4, 0.15);
        a.armR.localToWorld(hand);
        a.prop.position.copy(hand);
        a.prop.rotation.y = a.yaw;
        a.cup.material.color.set(st.act === 'water' ? 0x9fd3ff : 0xffffff);
      }
    }
  }

  // Highest surface below `limit` under (x, z). Sampled at the point and
  // four spots around it so a gap between dock planks or sand patches
  // doesn't read as the sea floor. World matrices must be current.
  surfaceBelow(x, z, limit, from = 1.2) {
    if (!this.room) return 0;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    let best = 0;
    for (const [dx, dz] of [[0, 0], [0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09]]) {
      ray.set(new THREE.Vector3(x + dx, from, z + dz), down);
      for (const h of ray.intersectObject(this.room, true)) {
        if (h.point.y < limit && h.point.y > best) best = h.point.y;
      }
    }
    return best;
  }

  // Height of the walkable surface (sand, dock planks…) on terrain scenes.
  groundHeight(x, y) {
    const key = `${Math.round(x * 4)},${Math.round(y * 4)}`;
    this.ground = this.ground || new Map();
    if (this.ground.has(key)) return this.ground.get(key);
    const v = this.surfaceBelow(x, y, 0.55);
    this.ground.set(key, v);
    return v;
  }

  // Kenney's `sit` clip is a sit-on-the-floor pose (seat at the model's
  // origin), so lift the character to whatever surface is under the seat
  // point: chair cushion, stool, sofa or beanbag. Measured once per spot.
  seatHeight(x, y, fallback) {
    const key = `${x.toFixed(2)},${y.toFixed(2)}`;
    this.seats = this.seats || new Map();
    if (this.seats.has(key)) return this.seats.get(key);
    const best = this.surfaceBelow(x, y, 0.75);
    const v = best > 0.05 ? best : fallback;
    this.seats.set(key, v);
    return v;
  }

  // ------------------------------------------------------------ frame

  draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.cw, this.ch);
    if (!this.loaded) {
      c.fillStyle = this.pal.text;
      c.globalAlpha = 0.7;
      c.font = '600 14px ui-sans-serif, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(this.loadError ? `3D failed: ${this.loadError}` : '', this.cw / 2, this.ch / 2);
      c.globalAlpha = 1;
      return false;
    }
    if (this.room !== undefined && this.builtPlan === this.plan) {
      // fine
    } else {
      this.build();
      this.builtPlan = this.plan;
      this.room.updateMatrixWorld(true);
      this.seats = new Map();
      this.ground = new Map();
      // Keep actor identity and shared GPU assets through room growth.
      // Only furniture and its transient animation state were rebuilt.
    }
    const dt = this.reducedMotion || this.motionPaused ? 0 : Math.min(0.05, this.clock.getDelta());
    const t = this.reducedMotion ? 0 : this.t / 1000;

    // Stable studio lighting keeps mascots legible in either UI appearance.
    if (!this.plan.scene) this.scene.background.setHex(this.pal.dark ? 0x212121 : 0xedf0f3);
    const sky = { sky:0xf4f6fa, sun:2.8, amb:2.2, night:false };
    this.sun.intensity = sky.sun;
    this.hemi.intensity = sky.amb;
    if (this.windowMat && !this.windowMat.isMeshBasicMaterial) {
      this.windowMat.color.setHex(sky.sky);
      this.windowMat.emissive.setHex(sky.sky);
    }
    if (this.plan.scene) this.animateScene(t, sky);
    if (this.lampLight) this.lampLight.intensity = sky.night ? 2.2 : 0;

    // screens show who is working and on what
    const occupant = new Map();
    for (const p of this.people.values()) if (p.mode === 'work' && p.desk && !p.path.length) occupant.set(p.desk, p);
    for (const [dk, scr] of this.screens) {
      const p = occupant.get(dk);
      const col = p ? STATUS_COLOR[p.s.status] : null;
      if (col) {
        const pulse = .32;
        scr.material.emissive.setHex(col);
        scr.material.emissiveIntensity = pulse;
      } else {
        scr.material.emissive.setHex(0x000000);
      }
    }
    for (const b of this.blinkers) {
      const on = Math.sin(this.t / (180 + b.r * 37 + b.k * 53) + b.r * b.k) > 0.2 && (b.r * 4 + b.k) < Math.max(4, this.deskOf.size * 3);
      b.m.material.emissiveIntensity = on ? 1.2 : 0.05;
    }
    if (this.arcadeScreen) this.arcadeScreen.material.emissive.setHSL((t * 0.05) % 1, 0.7, 0.5);
    const fbPlaying = this.plan.pois.filter((q) => q.pair === 'fb' && q.taken).length === 2;
    if (this.foosball) this.rods.forEach((r, k) => { r.position.z = this.foosball.y + 0.4 + (fbPlaying ? Math.sin(t * 8 + k) * 0.06 : 0); r.rotation.z = fbPlaying ? Math.sin(t * 12 + k) * 0.6 : 0; });
    this.updateBall();
    if (this.doorPivot && !this.reducedMotion && !this.motionPaused) {
      const entering = [...this.people.values()].some(p => (p.arriving || p.leaving) && Math.hypot(p.x-this.plan.door.x,p.y-this.plan.door.y)<1.6);
      const target = entering ? Math.PI*.43 : 0;
      this.doorPivot.rotation.y += (target-this.doorPivot.rotation.y)*Math.min(1,dt*7);
    }

    this.syncActors(dt);
    this.updateTelemetryBoard();
    if (this.insetMoving() || this.insetSettling) { this.fitCamera3D(false); this.insetSettling = this.insetMoving(); }
    this.controls.update();
    this.gl.render(this.scene, this.camera);

    this.drawAgentOverlay(c);
    if(this._pointerClient && !this._orbiting && !this._pointerDown && (!this.lastHoverPick || performance.now()-this.lastHoverPick>80)){
      this.lastHoverPick=performance.now();
      const key=this.pickAt(this._pointerClient.x,this._pointerClient.y);
      if(key!==this.hoverKey){this.hoverKey=key;const p=key&&this.people.get(key);this.onHover(p?p.s:null,key?(this.getAnchor(key)||{x:this._pointerClient.x,y:this._pointerClient.y}):null,false);}
    }
  }

  drawAgentOverlay(c) {
    this.hit=[];this.labels=[];this.anchors.clear();this.pickTargets=[];
    const projected=[],bodies=[];
    const rect=this.canvas.getBoundingClientRect();
    const maxX=this.cw-this.inset();
    for(const p of this.people.values()){
      const a=this.actors.get(p.key);if(!a)continue;
      this.pickTargets.push(...a.pickMeshes);
      if(a.labelAnchor)a.labelAnchor.getWorldPosition(a.anchor);
      else {a.bounds.setFromObject(a.obj);a.bounds.getCenter(a.anchor);a.anchor.y=a.bounds.max.y+.1;}
      const v=a.anchor.clone().project(this.camera);
      if(v.z < -1 || v.z > 1)continue;
      const x=(v.x+1)*.5*this.cw,y=(1-v.y)*.5*this.ch;
      if(x<0||x>maxX||y<0||y>this.ch)continue;
      const body={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
      for(const bx of [a.localBounds.min.x,a.localBounds.max.x])for(const by of [a.localBounds.min.y,a.localBounds.max.y])for(const bz of [a.localBounds.min.z,a.localBounds.max.z]){
        const point=new THREE.Vector3(bx,by,bz).applyMatrix4(a.obj.matrixWorld).project(this.camera),sx=(point.x+1)*.5*this.cw,sy=(1-point.y)*.5*this.ch;
        body.x0=Math.min(body.x0,sx);body.x1=Math.max(body.x1,sx);body.y0=Math.min(body.y0,sy);body.y1=Math.max(body.y1,sy);
      }
      bodies.push(body);
      this.anchors.set(p.key,{x:x+rect.left,y:y+rect.top,localX:x,localY:y,depth:v.z});
      const hot=this.hoverKey===p.key||this.selectedKey===p.key;
      const attention=p.s.status==='waiting'||p.s.status==='error'||p.arriving;
      projected.push({p,a,x,y,z:v.z,hot,attention});
    }
    const all=this.telemetry?.sessions||[...this.people.values()].map(p=>p.s);
    const working=all.filter(s=>['thinking','tool','typing'].includes(s.status)).length;
    const waiting=all.filter(s=>['waiting','error'].includes(s.status)).length;
    const unknown=all.filter(s=>s.status==='unknown').length;
    const hudWidth=Math.min(430,maxX-32),hudHeight=65;
    if(hudWidth>200){
      c.fillStyle=this.pal.dark?'rgba(23,23,23,.94)':'rgba(255,255,255,.94)';
      c.beginPath();c.rect(16,16,hudWidth,hudHeight);c.fill();
      c.textAlign='left';c.textBaseline='top';c.fillStyle=this.pal.dark?'#ececec':'#292929';c.font='600 15px "Bureau Pixel",monospace';
      c.fillText(`${working} working  ·  ${waiting} need you  ·  ${unknown} unknown`,28,26,hudWidth-24);
      c.fillStyle=this.pal.dark?'#b4b4b4':'#626262';c.font='13px "Bureau Pixel",monospace';
      c.fillText(this.telemetry?.connected===false?'Disconnected / statuses unconfirmed':'Observed events / select an agent',28,51,hudWidth-24);
    }
    const occupied=[...bodies,...(hudWidth>200?[{x0:16,x1:16+hudWidth,y0:16,y1:16+hudHeight}]:[])];
    // Selected/waiting agents and the coordinator win collisions. Details are
    // actual source fields, not made-up task progress or productivity scores.
    projected.sort((a,b)=>Number(b.hot)-Number(a.hot)||Number(b.attention)-Number(a.attention)||Number(b.p.s.agent==='dot')-Number(a.p.s.agent==='dot')||a.z-b.z);
    const accepted=[];
    const trim=(text,width)=>{let s=String(text||'').replace(/\s+/g,' ');while(c.measureText(s).width>width&&s.length>2)s=s.slice(0,-2)+'…';return s;};
    for(const q of projected){
      const {p,x,y,hot,attention}=q,s=p.s;
      const show=hot||(this.showAgent&&(attention||!s.subagent||s.agent==='dot'));
      const full=show&&(projected.length<=12||hot||attention||s.agent==='dot');
      const states={thinking:'Thinking',tool:'Using tool',typing:'Writing',waiting:'Needs you',error:'Error',unknown:'Unknown'};
      c.font='600 15px "Bureau Pixel",monospace';
      const text=trim((p.arriving?'+ ':'')+(s.agent==='dot'?'Dot':this.label(s)||s.agent),210);
      const at=s.presence?.observedAt||s.lastEventAt,age=Number.isFinite(at)?Math.max(0,Math.floor((Date.now()-(this.telemetry?.skew||0)-at)/1000)):null;
      const time=age===null?'':age<60?`${age}s`:age<3600?`${Math.floor(age/60)}m`:`${Math.floor(age/3600)}h`;
      const status=s.agent==='dot'?'Live status unavailable':`${states[s.status]||s.status} · ${s.presence?.live?'live':s.presence?.source==='demo'?'demo':s.presence?.source==='session-log'?'log':s.presence?.source==='external-event'?'event':s.presence?.source||'no source'}${time?' '+time:''}`;
      c.font='13px "Bureau Pixel",monospace';
      const detail=trim(s.agent==='dot'?'Active agents: unavailable':s.activity||s.prompt||s.model||'',210);
      const w=show?Math.max(188,Math.min(240,Math.max(c.measureText(text).width,c.measureText(status).width,c.measureText(detail).width)+28)):18;
      const h=show?(full&&detail?72:full?52:29):18;
      const r={x0:x-w/2,x1:x+w/2,y0:y-h-8,y1:y-8,key:p.key,z:q.z};
      const overlaps=box=>occupied.some(o=>box.x0<o.x1+4&&box.x1>o.x0-4&&box.y0<o.y1+3&&box.y1>o.y0-3);
      if(overlaps(r)){
        let placed=false;
        const offsets=[[0,-h-6],[-w/2,-h/2],[w/2,-h/2],[0,-2*h-12],[-w,-h],[w,-h],[0,h+12]];
        if(projected.length<=8||hot||attention||s.agent==='dot')for(let radius=1;radius<=8;radius++)for(let direction=0;direction<12;direction++)offsets.push([Math.round(Math.cos(direction*Math.PI/6)*radius*64),Math.round(Math.sin(direction*Math.PI/6)*radius*42)]);
        for(const [dx,dy] of offsets){
          const moved={...r,x0:r.x0+dx,x1:r.x1+dx,y0:r.y0+dy,y1:r.y1+dy};
          if(moved.x0>=4&&moved.x1<=maxX-4&&moved.y0>=4&&moved.y1<this.ch-75&&!overlaps(moved)){Object.assign(r,moved,{leader:true});placed=true;break;}
        }
        // At a close focus, neighbouring bodies can fill the local search.
        // Keep the selected record accessible in a free viewport corner.
        if(!placed&&hot){
          const corners=[[8,88],[maxX-w-8,88],[8,this.ch-h-82],[maxX-w-8,this.ch-h-82]];
          for(const [left,top]of corners){const moved={...r,x0:left,x1:left+w,y0:top,y1:top+h};if(left>=4&&top>=4&&moved.x1<=maxX-4&&!overlaps(moved)){Object.assign(r,moved,{leader:true});placed=true;break;}}
        }
        if(!placed)continue;
      }
      if(r.x0<4||r.x1>maxX-4||r.y0<4)continue;
      occupied.push(r);accepted.push({...q,r,text,show,full,status,detail});
    }
    accepted.sort((a,b)=>b.z-a.z);
    for(const {p,r,text,show,full,status,detail,hot,x,y} of accepted){
      if(r.leader){c.strokeStyle=this.pal.dark?'#9999':'#6669';c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo((r.x0+r.x1)/2,r.y1);c.stroke();}
      const tone={thinking:'#b79bdb',tool:'#81b4df',typing:'#85bea7',waiting:'#e2b362',error:'#e68d91',unknown:'#a0a0a0'}[p.s.status]||'#a0a0a0';
      c.fillStyle=this.pal.dark?(hot?'#393939':'rgba(33,33,33,.96)'):(hot?'#e7e7e7':'rgba(250,250,250,.97)');
      c.beginPath();c.rect(Math.round(r.x0),Math.round(r.y0),Math.round(r.x1-r.x0),Math.round(r.y1-r.y0));c.fill();
      c.strokeStyle=hot||['waiting','error'].includes(p.s.status)?tone:this.pal.dark?'#565656':'#bdbdbd';c.lineWidth=hot?1.5:1;c.stroke();
      c.fillStyle=tone;c.beginPath();c.arc(r.x0+(show?11:9),r.y0+(show?15:9),3,0,Math.PI*2);c.fill();
      if(show){
        c.fillStyle=this.pal.dark?'#ececec':'#292929';c.textAlign='left';c.textBaseline='top';c.font='600 15px "Bureau Pixel",monospace';c.fillText(text,r.x0+21,r.y0+7);
        if(full){c.fillStyle=tone;c.font='13px "Bureau Pixel",monospace';c.fillText(status,r.x0+10,r.y0+29,r.x1-r.x0-20);if(detail){c.fillStyle=this.pal.dark?'#b4b4b4':'#626262';c.fillText(detail,r.x0+10,r.y0+50,r.x1-r.x0-20);}}
      }
      this.labels.push(r);this.hit.push(r);
    }

  }

  getAnchor(key) { return this.anchors.get(key)||null; }

  focusAgent(key) {
    const a=this.actors.get(key);if(!a)return false;
    this.selectedKey=key;this.focusedKey=key;
    const target=a.obj.position.clone();target.y+=.65;
    const yaw=a.obj.rotation.y+.45;
    this.controls.target.copy(target);
    this.camera.position.set(target.x+Math.sin(yaw)*25,target.y+18,target.z+Math.cos(yaw)*25);
    this.camera.zoom=2.7;this.camera.lookAt(target);this.camera.updateMatrixWorld(true);this.camera.updateProjectionMatrix();
    // Keep the orbit pivot on the actual character. Move the off-centre
    // frustum for the sidebar instead of shifting camera and target in world
    // space (that made a focused orbit rotate the whole room out of view).
    const width=this.camera.right-this.camera.left,height=this.camera.top-this.camera.bottom;
    const center=width*this.inset()/(2*this.cw*this.camera.zoom);
    this.camera.left=center-width/2;
    this.camera.right=center+width/2;
    this.camera.top=height/2;this.camera.bottom=-height/2;
    this.camera.updateProjectionMatrix();this.controls.update();return true;
  }

  setOutlines(enabled) {
    this.outlinesEnabled=!!enabled;
    for(const actor of this.actors.values())actor.obj.traverse(o=>{if(o.userData.outline)o.visible=!!enabled;});
  }

  resetView() { this.selectedKey=null;this.focusedKey=null;this.fitCamera3D(true);this.controls.update(); }

  pickAt(clientX,clientY) {
    const rect=this.canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
    if(x<0||y<0||x>this.cw-this.inset()||y>this.ch)return null;
    for(let i=this.labels.length-1;i>=0;i--){const l=this.labels[i];if(x>=l.x0&&x<=l.x1&&y>=l.y0&&y<=l.y1)return l.key;}
    this.pointerNDC.set(x/this.cw*2-1,1-y/this.ch*2);this.raycaster.setFromCamera(this.pointerNDC,this.camera);
    const hits=this.raycaster.intersectObjects(this.pickTargets,false);
    if(!hits.length)return null;
    const obstacle=this.raycaster.intersectObject(this.room,true).find(h=>{
      const m=h.object.material;return m&&!m.transparent&&h.object.visible;
    });
    if(obstacle && obstacle.distance<hits[0].distance-.035)return null;
    return hits[0].object.userData.sessionKey;
  }

  updateBall() {
    if (!this.ball) return;
    const players = this.plan.pois.filter((q) => q.pair === 'pp' && q.taken)
      .map((q) => this.people.get(q.taken)).filter((p) => p && p.poi && p.poi.pair === 'pp' && !p.path.length);
    this.ball.visible = players.length === 2;
    if (!this.ball.visible) return;
    const pp = this.plan.pp;
    const k = (this.t / 900) % 2;
    const f = k < 1 ? k : 2 - k;
    this.ball.position.set(pp.x0 + 0.3 + f * (pp.x1 - pp.x0 - 0.6), 0.8 + Math.abs(Math.sin(f * Math.PI * 2)) * 0.4, pp.y);
  }

  pointer(e, click) {
    if(!this.raycaster)return;
    this._pointerClient={x:e.clientX,y:e.clientY};
    if(e.buttons||this._orbiting){this.onHover(null);return;}
    if(click&&this._dragged){this._dragged=false;return;}
    const key=this.pickAt(e.clientX,e.clientY);
    this.canvas.style.cursor=key?'pointer':'grab';
    this.hoverKey=key;
    const p=key&&this.people.get(key);
    if(click&&key)this.selectedKey=key;
    this.onHover(p?p.s:null,key?(this.getAnchor(key)||{x:e.clientX,y:e.clientY}):null,!!click);
  }
}
