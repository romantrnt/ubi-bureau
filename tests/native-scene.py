"""Native GTK/WebKit scene evidence with synthetic, in-memory sessions only.

Uses the production Office window and child server with an isolated HOME. All
EventSources are closed before injecting fixtures. No model turn or journal is
written. BUREAU_QA_ROOT can target an extracted build; BUREAU_QA_OUTPUT selects
where JSON timings and WebKit snapshots are saved. Run only after npm run build.
"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

root = Path(os.environ.get('BUREAU_QA_ROOT', Path(__file__).resolve().parents[1]))
fixture_home = Path(tempfile.mkdtemp(prefix='bureau-native-scene-'))
evidence = Path(os.environ.get('BUREAU_QA_OUTPUT', '/tmp/bureau-native-scene'))
evidence.mkdir(parents=True, exist_ok=True)
os.environ.update(HOME=str(fixture_home), CODEX_HOME=str(fixture_home/'.codex'),
                  CLAUDE_CONFIG_DIR=str(fixture_home/'.claude'), GEMINI_CLI_HOME=str(fixture_home),
                  BUREAU_PORT='0', WMAD_NO_UPDATE_CHECK='1', XDG_CACHE_HOME=str(fixture_home/'cache'),
                  XDG_DATA_HOME=str(fixture_home/'data'), XDG_CONFIG_HOME=str(fixture_home/'config'))
os.environ.pop('APPIMAGE', None)
sys.argv = ['agent-office.py']
sys.path.insert(0, str(root/'bin'))
spec = importlib.util.spec_from_file_location('bureau_native_scene', root/'bin/agent-office.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

INSTRUMENT = r"""
window.__sceneErrors=[];addEventListener('error',e=>__sceneErrors.push(e.message));
addEventListener('unhandledrejection',e=>__sceneErrors.push(String(e.reason)));
window.__sceneSources=[];const NativeEventSource=EventSource;
window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);__sceneSources.push(this)}};
window.closeEventSources=()=>{for(const source of __sceneSources)source.close();};
"""

class SceneOffice(m.Office):
    def do_activate(self):
        super().do_activate()
        if not getattr(self, 'instrumented', False):
            script = m.WebKit.UserScript.new(INSTRUMENT, m.WebKit.UserContentInjectedFrames.TOP_FRAME,
                                             m.WebKit.UserScriptInjectionTime.START, None, None)
            self.view.get_user_content_manager().add_script(script)
            self.window.set_title('Ubi Bureau · synthetic native scene')
            self.instrumented = True

app = SceneOffice()
app.set_application_id('io.github.romantrnt.UbiBureau.SceneEvidence')
report = [{'fixture': 'synthetic in-memory sessions; production GTK/WebKit Office wrapper',
           'version': json.loads((root/'package.json').read_text())['version'],
           'bundleSha256': hashlib.sha256((root/'public/office3d.js').read_bytes()).hexdigest()}]
busy, finished, passed = False, False, False
failures = []
step_index, start_frames, started = -1, 0, time.monotonic()

SETUP = r"""
closeEventSources();state.sound=false;state.notify=false;state.connected=true;
state.agents=[];state.search='';state.scope='current';state.statusFilter='all';
state.showSub=true;state.showIdle=true;state.showAgent=true;
const marker=document.createElement('div');marker.textContent='Synthetic scene fixture · native WebKit';
marker.style.cssText='position:fixed;bottom:5px;right:8px;z-index:100;font:10px sans-serif;padding:3px 6px;background:#212121dd;color:#d9d9d9;pointer-events:none';document.body.append(marker);
window.sceneFixture=n=>{
 const now=Date.now();const sessions=Array.from({length:n},(_,i)=>{
  if(i===0)return{id:'/root',key:'dot:/root',agent:'dot',title:'Synthetic Dot',source:'dot-snapshot',status:'unknown',snapshotStale:true,observedAt:now-180000,lastEventAt:now-180000,activeSubagents:null};
  const agent=['codex','claude','gemini'][(i-1)%3],status=['tool','thinking','typing','waiting'][(i-1)%4];
  return{id:'native-scene-'+i,key:agent+':native-scene-'+i,agent,title:'Synthetic '+agent+' '+i,status,model:'fixture-model',cwd:'/synthetic/native-scene',project:'Synthetic fixture',activity:status==='waiting'?'Synthetic approval request':'Synthetic scene workload',prompt:'Synthetic render fixture. No model turn.',lastEventAt:now,startedAt:now-60000+i,turnStartedAt:now-10000,subagent:false,presence:{kind:'recent',source:'demo',live:false,observedAt:now,stale:false},context:{used:12000+i*1000,window:100000},today:{tokens:14000+i*1000,turns:3}};
 });
 // Terminal fixtures belong to history and must never acquire scene bodies.
 for(const status of ['done','interrupted'])sessions.push({id:'terminal-'+status,key:'codex:terminal-'+status,agent:'codex',title:'Synthetic terminal '+status,status,lastEventAt:now-60000});
 return{now,sessions,dotConnection:{available:true,stale:true,observedAt:now-180000}};
};
window.showSceneFixture=n=>{office.motionPaused=true;onData(sceneFixture(n));office.motionPaused=false;office.resetView();};
window.orbitScene=angle=>{const t=office.controls.target,p=office.camera.position,dx=p.x-t.x,dz=p.z-t.z,dy=p.y-t.y,r=angle*Math.PI/180;office.camera.position.set(t.x+Math.cos(r)*dx+Math.sin(r)*dz,t.y+dy,t.z-Math.sin(r)*dx+Math.cos(r)*dz);office.camera.lookAt(t);office.controls.update();};
window.measureNativeScene=()=>{
 window.__sceneTiming=null;
 (async()=>{
  const settlingGaps=[],frameGaps=[];let previous=null;
  for(let i=0;i<6;i++){const at=await new Promise(requestAnimationFrame);if(previous!==null)settlingGaps.push(at-previous);previous=at;}
  for(let i=0;i<12;i++){const at=await new Promise(requestAnimationFrame);frameGaps.push(at-previous);previous=at;}
  const renderSamples=[];
  for(let i=0;i<7;i++){await new Promise(requestAnimationFrame);const begin=performance.now();office.gl.render(office.scene,office.camera);office.gl.getContext().finish();if(i)renderSamples.push(performance.now()-begin);}
  const stats=a=>{const sorted=[...a].sort((a,b)=>a-b);return{meanMs:a.reduce((s,x)=>s+x,0)/a.length,medianMs:sorted[Math.floor(sorted.length/2)],maxMs:sorted.at(-1),samples:a}};
  const gl=office.gl.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  __sceneTiming={settlingFrameGaps:stats(settlingGaps),ordinaryFrameGaps:stats(frameGaps),synchronousRenderFinish:stats(renderSamples),calls:office.gl.info.render.calls,triangles:office.gl.info.render.triangles,memory:{...office.gl.info.memory},programs:office.gl.info.programs.length,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),userAgent:navigator.userAgent};
 })().catch(e=>__sceneErrors.push(String(e.stack||e)));
};
showSceneFixture(4);setSide(true,false);office.setOutlines(true);
"""

steps = [('overview-three-providers', '', 4),
         ('scene-sidebar-closed', 'setSide(false,false);office.resetView();', 4)]
for provider, key in [('dot', 'dot:/root'), ('codex', 'codex:native-scene-1')]:
    steps += [(provider+'-focus', "setSide(true,false);office.focusAgent('"+key+"');", 4),
              (provider+'-orbit-side', 'orbitScene(75);', 4),
              (provider+'-orbit-back', 'orbitScene(100);', 4)]
for count in (1, 10, 25):
    for outlines in (False, True):
        name = f'workload-{count}-outlines-{str(outlines).lower()}'
        script = f'showSceneFixture({count});setSide(false,false);office.setOutlines({str(outlines).lower()});measureNativeScene();'
        steps.append((name, script, count))

requested = os.environ.get('BUREAU_QA_STEPS')
if requested:
    selected = set(requested.split(','))
    assert selected <= {step[0] for step in steps}, 'unknown scene evidence step'
    steps = [step for step in steps if step[0] in selected]

OBSERVE = r"""(()=>{
const o=typeof office==='undefined'?null:office;const people=[...(o?.people?.values()||[])];
let pick=null;if(o?.focusedKey&&o.actors.has(o.focusedKey)){
 const a=o.actors.get(o.focusedKey),rect=o.canvas.getBoundingClientRect(),labels=o.labels;pick=false;
 o.labels=[];try{for(const mesh of a.pickMeshes){mesh.geometry.computeBoundingBox();const point=mesh.geometry.boundingBox.getCenter(a.anchor.clone());mesh.localToWorld(point);point.project(o.camera);if(o.pickAt(rect.left+(point.x+1)*.5*o.cw,rect.top+(1-point.y)*.5*o.ch)===o.focusedKey){pick=true;break;}}}finally{o.labels=labels;}
}
const dot=people.find(p=>p.s.agent==='dot');
return JSON.stringify({frames:o?.framesShown||0,actors:o?.actors?.size,capacity:o?.plan?.desks?.length,
dot:dot?{status:dot.s.status,path:dot.path.length,dockDistance:dot.desk?Math.hypot(dot.x-dot.desk.seat.x,dot.y-dot.desk.seat.y):null}:null,
keys:people.map(p=>p.key),models:[...(o?.actors?.values()||[])].map(a=>a.obj.name),
native:typeof NATIVE!=='undefined'&&NATIVE,errors:window.__sceneErrors||[],streams:window.__sceneSources?.length,
streamsClosed:window.__sceneSources?.every(s=>s.readyState===EventSource.CLOSED),
font:document.fonts.status,outlines:o?.outlinesEnabled!==false,bodyPick:pick,
camera:o?.camera?{position:o.camera.position.toArray(),target:o.controls.target.toArray(),frustum:[o.camera.left,o.camera.right,o.camera.top,o.camera.bottom],zoom:o.camera.zoom}:null,
sideClosed:document.body.classList.contains('side-closed'),timing:window.__sceneTiming||null});})()"""

def finish(error=None):
    global finished, passed
    if finished:
        return
    finished, passed = True, error is None
    report.append({'result': 'passed'} if passed else {'step': step_index, 'error': str(error)})
    (evidence/'result.json').write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n')
    print('NATIVE_SCENE_PASS' if passed else 'NATIVE_SCENE_FAIL '+str(error), flush=True)
    app.quit()

def execute(script):
    app.view.evaluate_javascript(script, -1, None, None, None, None)

def begin_next():
    global step_index, busy, started
    step_index += 1
    if step_index == len(steps):
        finish("; ".join(failures) if failures else None)
        return
    busy = False
    started = time.monotonic()
    execute("if(typeof closeMenus==='function')closeMenus();"+steps[step_index][1])

def capture(name, data):
    global busy
    busy = True
    def done(view, result, *_):
        try:
            image = view.get_snapshot_finish(result)
            assert image.save_to_png(str(evidence/(name+'.png')))
            report.append({'step': name, **data})
            print('NATIVE_SCENE '+name+' '+json.dumps(data), flush=True)
            begin_next()
        except Exception as error:
            finish('snapshot: '+str(error))
    app.view.get_snapshot(m.WebKit.SnapshotRegion.VISIBLE, m.WebKit.SnapshotOptions.NONE, None, done)

def observed(view, result, *_):
    global busy, start_frames, started
    busy = False
    try:
        data = json.loads(view.evaluate_javascript_finish(result).to_string())
        assert not data['errors'], data['errors']
        if step_index == -1:
            if data['frames'] < 8:
                return
            assert data['native'] and data['font'] == 'loaded', data
            execute(SETUP)
            start_frames = data['frames']
            begin_next()
            return
        name, _, count = steps[step_index]
        if data['frames'] <= start_frames+3 or data['actors'] != count:
            return
        assert data['streamsClosed'] and data['streams'] >= 1, data
        assert len(data['keys']) == count and all('terminal-' not in key for key in data['keys']), data
        assert data['capacity'] >= count and data['native'], data
        if data['dot']['status'] == 'unknown':
            assert data['dot']['path'] == 0 and data['dot']['dockDistance'] < .05, 'unknown Dot moves away from dock: '+str(data['dot'])
        if name.startswith(('dot-', 'codex-')):
            if data['bodyPick'] is not True:
                failure = 'focused native body unselectable: '+name
                failures.append(failure)
                data['failure'] = failure
        if name.startswith('workload-') and not data['timing']:
            return
        if name.startswith('overview'):
            assert {'dot-mascot', 'codex-mascot', 'claude-mascot', 'gemini-mascot'}.issubset(data['models']), data
        start_frames = data['frames']
        capture(name, data)
    except Exception as error:
        finish(repr(error))

def check():
    global busy
    if finished:
        return False
    if time.monotonic()-started > 45:
        finish('timeout waiting for '+(steps[step_index][0] if step_index >= 0 else 'production scene'))
        return False
    if not busy and app.view and app.url:
        busy = True
        app.view.evaluate_javascript(OBSERVE, -1, None, None, None, observed)
    return True

m.GLib.timeout_add_seconds(1, check)
try:
    app.run([])
finally:
    shutil.rmtree(fixture_home, ignore_errors=True)
assert app.proc is None or app.proc.poll() is not None, 'child server leaked'
sys.exit(0 if passed else 1)
