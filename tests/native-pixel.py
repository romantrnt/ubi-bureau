"""Visible GTK/WebKit checks with a real watcher and synthetic isolated stores.

No model turn is submitted and no user journal is changed. BUREAU_QA_ROOT may
point to an extracted release. Captures contain synthetic data only.
"""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

root = Path(os.environ.get('BUREAU_QA_ROOT', Path(__file__).resolve().parents[1]))
fixture_home = Path(tempfile.mkdtemp(prefix='bureau-pixel-native-'))
evidence = Path(os.environ.get('BUREAU_QA_OUTPUT', '/tmp/ubi-pixel-native'))
evidence.mkdir(parents=True, exist_ok=True)
# Inherited source overrides must never escape the synthetic fixture home.
for key in list(os.environ):
    if (key.startswith('WMAD_') or (key.startswith('BUREAU_') and not key.startswith('BUREAU_QA_'))) or key in ('CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'GEMINI_CLI_HOME', 'ANTIGRAVITY_HOME', 'ANTIGRAVITY_APP_HOME', 'ANTIGRAVITY_IDE_HOME', 'KIMI_CODE_HOME', 'DSH_HOME', 'GROK_HOME', 'HERMES_HOME', 'OPENCODE_DB', 'LOCALAPPDATA', 'PI_CODING_AGENT_SESSION_DIR', 'PI_CODING_AGENT_DIR', 'WMAD_OMP_SESSIONS_DIR', 'OMP_CONFIG_DIR', 'OMP_HOME'):
        os.environ.pop(key, None)
os.environ.update(HOME=str(fixture_home), CODEX_HOME=str(fixture_home/'.codex'),
                  CLAUDE_CONFIG_DIR=str(fixture_home/'.claude'), GEMINI_CLI_HOME=str(fixture_home),
                  BUREAU_PORT='0', XDG_CACHE_HOME=str(fixture_home/'cache'),
                  XDG_DATA_HOME=str(fixture_home/'data'), XDG_CONFIG_HOME=str(fixture_home/'config'))
os.environ.pop('APPIMAGE', None)
sys.argv = ['agent-office.py']
sys.path.insert(0, str(root/'bin'))
spec = importlib.util.spec_from_file_location('bureau_native', root/'bin/agent-office.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def identifier(n):
    return '00000000-0000-4000-8000-' + str(n).zfill(12)

def event(kind, payload):
    return json.dumps({'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       'type': kind, 'payload': payload}) + '\n'

logs = {}
def add_session(n):
    folder = fixture_home/'.codex/sessions'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y/%m/%d')
    folder.mkdir(parents=True, exist_ok=True)
    log = folder/('rollout-' + identifier(n) + '.jsonl')
    log.write_text(event('session_meta', {'id': identifier(n), 'cwd': '/fixture/native-studio'}) +
                   event('turn_context', {'model': 'fixture-model'}) +
                   event('event_msg', {'type': 'user_message', 'message': 'Native pixel fixture ' + str(n)}) +
                   event('event_msg', {'type': 'task_started'}))
    logs[n] = log

for number in range(1, 8):
    add_session(number)
snapshot = fixture_home/'.local/state/agent-office/dot-snapshot.json'
snapshot.parent.mkdir(parents=True)
snapshot.write_text(json.dumps({'version': 1, 'observedAt': int(time.time()*1000)-180000,
                               'agents': [{'id': '/root/'+str(i), 'status': 'running'} for i in range(20)]}))
app = m.Office()
app.set_application_id('io.github.romantrnt.UbiBureau.PixelAcceptance')
phase, checks, busy, passed, started, baseline_frames = 'baseline', 0, False, False, 0, 0
report = []
OBSERVE = r"""(()=>{
if(!window.__nativeErrors){window.__nativeErrors=[];window.addEventListener('error',e=>__nativeErrors.push(e.message));}
const o=typeof office==='undefined'?null:office, ss=typeof state==='undefined'?[]:state.data.sessions;
const target=ss.find(s=>s.id==='00000000-0000-4000-8000-000000000008');
return JSON.stringify({frames:o?.framesShown||0,cap:o?.plan?.desks?.length,
people:[...(o?.people?.values()||[])].map(p=>p.s.id),actors:o?.people?.size,pixel:!!o?.gl&&!!o?.camera,lang:document.documentElement.lang,
local:ss.filter(s=>s.agent==='codex').length,dot:ss.filter(s=>s.agent==='dot').length,
dotStatus:ss.find(s=>s.agent==='dot')?.status,subagents:ss.find(s=>s.agent==='dot')?.activeSubagents,
found:!!target,status:target?.status,native:typeof NATIVE!=='undefined'&&NATIVE,
labels:o?.showAgent,paused:o?.motionPaused,theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,font:document.fonts.status,
fontFamily:getComputedStyle(document.body).fontFamily,errors:__nativeErrors,canvas:{width:o?.canvas?.width,height:o?.canvas?.height},connections:!!document.querySelector('#connectionsBtn')});})()"""

def finish(error=None):
    global passed
    passed = error is None
    report.append({'phase': phase, 'error': str(error)} if error else {'result': 'passed'})
    (evidence/'result.json').write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n')
    print('NATIVE_ACCEPTANCE_FAIL '+str(error) if error else 'NATIVE_ACCEPTANCE_PASS', flush=True)
    app.quit()

def record(name, data):
    report.append({'phase': name, **data})
    print('NATIVE_'+name.upper()+' '+json.dumps(data), flush=True)

def js(script):
    app.view.evaluate_javascript(script, -1, None, None, None, None)

def screenshot(name):
    def done(view, result, *_):
        try:
            assert view.get_snapshot_finish(result).save_to_png(str(evidence/(name+'.png')))
        except Exception as error:
            finish('snapshot: '+str(error))
    app.view.get_snapshot(m.WebKit.SnapshotRegion.VISIBLE, m.WebKit.SnapshotOptions.NONE, None, done)

def result(view, result, *_):
    global phase, busy, started, baseline_frames
    busy = False
    try:
        data = json.loads(view.evaluate_javascript_finish(result).to_string())
        assert not data['errors'], data['errors']
        frames = data['frames']
        if phase == 'baseline' and frames > 8 and data['local'] == 7:
            assert data['dot'] == 1 and data['dotStatus'] == 'unknown' and data.get('subagents') is None, data
            assert data['cap'] >= 8 and data['native'] and data['font'] == 'loaded', data
            assert data['theme'] == 'dark' and data['pixel'] and data['lang'] == 'en', data
            record(phase, data)
            screenshot('overview')
            baseline_frames, started = frames, time.monotonic()
            add_session(8)
            phase = 'discovery'
        elif phase == 'discovery' and data['found'] and identifier(8) in data['people'] and frames > baseline_frames+3:
            assert data['cap'] >= 9, data
            record(phase, {**data, 'latencySeconds': round(time.monotonic()-started, 3)})
            js("document.querySelector('#settingsMenu').open=true;const toggle=document.querySelector('#showAgent');toggle.checked=false;toggle.dispatchEvent(new Event('change'));document.querySelector('#settingsMenu').open=false;document.querySelector('#bureauPause').click();")
            phase = 'settings'
        elif phase == 'settings' and data['labels'] is False and data['paused'] is True:
            record(phase, data)
            with logs[8].open('a') as log:
                log.write(event('event_msg', {'type': 'task_complete', 'last_agent_message': 'Native fixture done'}))
            phase = 'completion'
        elif phase == 'completion' and data['status'] == 'done' and identifier(8) not in data['people']:
            record(phase, data)
            screenshot('completed')
            app.view.reload()
            phase = 'persistence'
        elif phase == 'persistence' and frames > 6 and data['local'] == 8 and data['labels'] is False:
            assert identifier(8) not in data['people'] and data['native'], data
            record(phase, data)
            js("document.querySelector('#settingsMenu').open=true;const toggle=document.querySelector('#showAgent');toggle.checked=true;toggle.dispatchEvent(new Event('change'));document.querySelector('#settingsMenu').open=false;")
            phase = 'restored'
        elif phase == 'restored' and data['labels'] is True:
            record(phase, data)
            baseline_frames, started = frames, time.monotonic()
            for number in range(9, 15):
                add_session(number)
            phase = 'burst'
        elif phase == 'burst' and data['local'] == 14 and data['actors'] == 14 and frames > baseline_frames+3:
            assert data['cap'] >= 14, data
            record(phase, {**data, 'latencySeconds': round(time.monotonic()-started, 3)})
            screenshot('burst')
            js("document.querySelector('#connectionsBtn')?.click()")
            phase = 'connections'
        elif phase == 'connections':
            record(phase, data)
            screenshot('connections')
            phase = 'final-frame'
        elif phase == 'final-frame':
            finish()
    except Exception as error:
        finish(repr(error))

def check():
    global checks, busy
    checks += 1
    if checks > 100:
        finish('timeout in '+phase)
        return False
    if not busy and app.view and app.url:
        busy = True
        app.view.evaluate_javascript(OBSERVE, -1, None, None, None, result)
    return True

m.GLib.timeout_add_seconds(1, check)
try:
    app.run([])
finally:
    shutil.rmtree(fixture_home, ignore_errors=True)
assert app.proc is None or app.proc.poll() is not None, 'child server leaked'
sys.exit(0 if passed else 1)
