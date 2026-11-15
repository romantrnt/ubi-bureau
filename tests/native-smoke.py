import os,sys,json,importlib.util
sys.argv=['agent-office.py','--demo']
from pathlib import Path
root=os.environ.get('BUREAU_QA_ROOT',str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,root+'/bin')
spec=importlib.util.spec_from_file_location('bureau_app',root+'/bin/agent-office.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
app=m.Office(); app.set_application_id('io.github.romantrnt.UbiBureau.QA')
checks=0; outcome={}; failed=False

def ready(view,result,*args):
 global checks,outcome,failed
 try:
  data=json.loads(view.evaluate_javascript_finish(result).to_string())
  if data.get('frames',0)>5:
   assert data['title'].endswith('Ubi Bureau'),data
   assert data['font']=='loaded',data
   assert data['sessions']>0,data
   assert data['native'],data
   assert data['buttons']==8,data
   outcome=data
   print('NATIVE_WEBKIT_WAYLAND_PASS '+json.dumps(data),flush=True)
   app.quit()
 except Exception as error:
  failed=True; print('NATIVE_FAIL '+repr(error),flush=True);app.quit()

def check():
 global checks,failed
 checks+=1
 if checks>45:
  failed=True;print('NATIVE_TIMEOUT',flush=True);app.quit();return False
 if app.view and app.url:
  js="JSON.stringify({title:document.title,frames:typeof office==='undefined'?0:office?.framesShown||0,sessions:typeof state==='undefined'?0:state.data?.sessions?.length||0,native:typeof NATIVE!=='undefined'&&NATIVE,font:document.fonts.status,buttons:document.querySelectorAll('.bureau-nav button').length})"
  app.view.evaluate_javascript(js,-1,None,None,None,ready)
 return True
m.GLib.timeout_add_seconds(1,check)
app.run([])
assert app.proc is None or app.proc.poll() is not None, 'child server leaked'
sys.exit(1 if failed or not outcome else 0)
