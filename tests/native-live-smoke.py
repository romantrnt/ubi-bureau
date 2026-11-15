"""GTK/WebKit + real isolated watcher. No model turns or real user journals."""
import os,sys,json,tempfile,time,importlib.util,pathlib,shutil,datetime
root=pathlib.Path(__file__).resolve().parents[1]
home=pathlib.Path(tempfile.mkdtemp(prefix='bureau-native-live-'))
os.environ.update(HOME=str(home),CODEX_HOME=str(home/'.codex'),CLAUDE_CONFIG_DIR=str(home/'.claude'),GEMINI_CLI_HOME=str(home),BUREAU_PORT='0',XDG_CACHE_HOME=str(home/'cache'),XDG_DATA_HOME=str(home/'data'),XDG_CONFIG_HOME=str(home/'config'))
f=home/'.local/state/agent-office/dot-snapshot.json';f.parent.mkdir(parents=True);f.write_text(json.dumps({'version':1,'observedAt':int(time.time()*1000)-180000,'agents':[{'id':'/fixture/'+str(i),'title':'Dot snapshot '+str(i),'status':'running'}for i in range(7)]}))
sys.argv=['agent-office.py'];sys.path.insert(0,str(root/'bin'))
spec=importlib.util.spec_from_file_location('bureau_native',root/'bin/agent-office.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
os.environ.pop('APPIMAGE',None) # QA must never enable a real AppImage updater.
app=m.Office();app.set_application_id('io.github.romantrnt.UbiBureau.LiveQA')
phase=0;checks=0;busy=False;passed=False;baseline=0;started=0
ID='00000000-0000-4000-8000-000000000001';log=home/'.codex/sessions'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y/%m/%d')/('rollout-'+ID+'.jsonl')
def event(typ,payload):return json.dumps({'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'type':typ,'payload':payload})+'\n'
def finish(error=None):
 global passed
 passed=not error;print('NATIVE_LIVE_FAIL '+str(error)if error else'NATIVE_LIVE_PASS',flush=True);app.quit()
def result(view,res,*args):
 global phase,busy,baseline,started
 busy=False
 try:
  d=json.loads(view.evaluate_javascript_finish(res).to_string());frames=d.get('frames',0)
  if d.get('error'):raise AssertionError(d['error'])
  if phase==0 and frames>6 and d.get('cap')==8:
   print('NATIVE_BASELINE '+json.dumps(d),flush=True);baseline=frames;started=time.monotonic();log.parent.mkdir(parents=True)
   log.write_text(event('session_meta',{'id':ID,'cwd':'/fixture/native-live'})+event('event_msg',{'type':'user_message','message':'Проверить появление нового агента'})+event('event_msg',{'type':'task_started'}));phase=1
  elif phase==1 and d.get('found') and frames>baseline+5:
   assert d['cap']==12,d
   print('NATIVE_DISCOVERED '+json.dumps({**d,'latencySeconds':round(time.monotonic()-started,2)}),flush=True)
   with log.open('a')as f:f.write(event('event_msg',{'type':'task_complete','last_agent_message':'Native fixture done'}))
   phase=2;baseline=frames
  elif phase==2 and d.get('status')=='done' and frames>baseline+5:
   assert d.get('native')and d.get('buttons')==8,d
   print('NATIVE_COMPLETED '+json.dumps(d),flush=True);finish()
 except Exception as error:finish(repr(error))
def check():
 global checks,busy
 checks+=1
 if checks>80:finish('timeout phase '+str(phase));return False
 if not busy and app.view and app.url:
  busy=True
  js="""(()=>{if(!window.__bureauQAErrors){window.__bureauQAErrors=[];window.addEventListener('error',e=>__bureauQAErrors.push(e.message));}const o=typeof office==='undefined'?null:office,s=typeof state==='undefined'?null:state.data.sessions.find(s=>s.id==='00000000-0000-4000-8000-000000000001');return JSON.stringify({frames:o?.framesShown||0,cap:o?.plan.desks.length,found:!!s,status:s?.status,native:typeof NATIVE!=='undefined'&&NATIVE,buttons:document.querySelectorAll('.bureau-nav button').length,error:__bureauQAErrors.join(';'),memory:o?.gl?.info.memory});})()"""
  app.view.evaluate_javascript(js,-1,None,None,None,result)
 return True
m.GLib.timeout_add_seconds(1,check)
try:app.run([])
finally:shutil.rmtree(home,ignore_errors=True)
assert app.proc is None or app.proc.poll()is not None,'child server leaked'
sys.exit(0 if passed else 1)
