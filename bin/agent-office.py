#!/usr/bin/env python3
"""Native GTK4/WebKit6 window. All data is served on loopback by our own child."""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import threading
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent

def options():
    parser = argparse.ArgumentParser(description='Ubi Bureau: a local 3D office for coding agents')
    parser.add_argument('--demo', action='store_true', help='Use a synthetic team, never local sessions')
    parser.add_argument('--private', action='store_true', help='Hide prompts, replies and session titles')
    parser.add_argument('--check', action='store_true', help='Check required host runtimes without opening a window')
    parser.add_argument('--version', action='version', version=json.loads((ROOT/'package.json').read_text())['version'])
    return parser.parse_args()

ARGS = options()
NODE = os.environ.get('AGENT_OFFICE_NODE') or shutil.which('node')
if not NODE:
    raise SystemExit('Ubi Bureau requires Node.js 22.13+ on PATH (or AGENT_OFFICE_NODE).')
try:
    version = subprocess.check_output([NODE, '-p', 'process.versions.node'], text=True).strip()
    parts = tuple(int(p) for p in version.split('.'))
    if parts < (22, 13, 0):
        raise ValueError('Node.js 22.13+ is required')
    import gi
    gi.require_version('Gtk', '4.0')
    gi.require_version('WebKit', '6.0')
    from gi.repository import Gtk, Gio, GLib, WebKit
except (ImportError, ValueError, subprocess.SubprocessError) as error:
    raise SystemExit(f'Missing host runtime: {error}. See docs/BUILD.md.') from error
if ARGS.check:
    print(f'Ubi Bureau: Node {version}, Python GI, GTK4 and WebKitGTK 6.0 available. Display not tested.')
    raise SystemExit(0)

from native_policy import is_codex_uri, is_internal_uri

class Office(Gtk.Application):
    def __init__(self):
        super().__init__(application_id='io.github.romantrnt.UbiBureau', flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
        self.proc = None
        self.window = None
        self.url = None
        self.stopping = threading.Event()
        quit_action = Gio.SimpleAction.new('quit', None)
        quit_action.connect('activate', lambda action, parameter: self.quit())
        self.add_action(quit_action)

    def do_activate(self):
        if self.window:
            self.window.present()
            return
        self.window = Gtk.ApplicationWindow(application=self, title='Ubi Bureau')
        self.window.set_default_size(1280, 820)
        self.window.set_icon_name('io.github.romantrnt.UbiBureau')
        self.view = WebKit.WebView()
        self.view.connect('decide-policy', self.on_policy)
        self.view.connect('permission-request', lambda view, request: (request.deny(), True)[1])
        self.window.set_child(self.view)
        self.view.load_html('<body style="background:#29282d;color:#eee;padding:50px;font:18px sans-serif">Открываем Ubi Bureau…</body>', None)
        self.window.present()
        threading.Thread(target=self.start_server, daemon=True).start()

    def on_policy(self, view, decision, kind):
        if kind != WebKit.PolicyDecisionType.NAVIGATION_ACTION:
            return False
        action = decision.get_navigation_action()
        uri = action.get_request().get_uri()
        if is_codex_uri(uri) and action.is_user_gesture():
            decision.ignore()
            if Gio.AppInfo.get_default_for_uri_scheme('codex'):
                Gio.AppInfo.launch_default_for_uri(uri, None)
            return True
        if not is_internal_uri(uri, self.url):
            decision.ignore()
            return True
        return False

    def start_server(self):
        try:
            env = {**os.environ, 'BUREAU_NATIVE': '1'}
            if ARGS.demo:
                env['BUREAU_DEMO'] = '1'
            if ARGS.private:
                env['BUREAU_PRIVATE'] = '1'
            self.proc = subprocess.Popen([NODE, str(ROOT/'bin/desktop-server.js')], cwd=ROOT,
                                         env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            if self.stopping.is_set():
                self.proc.terminate()
                return
            port = json.loads(self.proc.stdout.readline())['port']
            if type(port) is not int or not 1 <= port <= 65535:
                raise ValueError('Invalid local port')
            self.url = f'http://127.0.0.1:{port}'
            if not self.stopping.is_set():
                GLib.idle_add(self.view.load_uri, self.url+'/?quality=high&dotOffice=1&native=1')
        except Exception:
            if not self.stopping.is_set():
                GLib.idle_add(self.view.load_html, '<body style="padding:50px;font:18px sans-serif">Не удалось запустить Ubi Bureau. Проверьте зависимости: --check. Закройте и откройте приложение снова.</body>', None)

    def do_shutdown(self):
        self.stopping.set()
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                # The child has stopped the watcher/listener and cancelled transfers.
                # Do not SIGKILL a pending atomic update/fsync on a slow disk.
                # It exits itself after cleanup; no GUI or new code is launched.
                pass
        Gtk.Application.do_shutdown(self)

if __name__ == '__main__':
    Office().run([])
