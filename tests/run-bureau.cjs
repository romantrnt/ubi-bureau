'use strict';
// Deterministic public fixtures only. No watcher and no access to real journals.
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-ui-'));
const chrome = process.env.WMAD_CHROMIUM || require('playwright').chromium.executablePath();
process.env.HOME = home;
process.env.WMAD_NO_UPDATE_CHECK = '1';
process.env.WMAD_LOCAL_VARIANT = '1';
const { createServer } = require('../src/server');
const watcher = new EventEmitter();
watcher.sessions = () => {
  const now = Date.now();
  const base = { cwd: '/demo/project', model: 'fixture-model', status: 'thinking', explicitLifecycle: true, lastEventAt: now, startedAt: now - 60000, turnStartedAt: now - 15000, subagent: false, prompt: null, reply: null, file: null };
  return [
    { ...base, id: '00000000-0000-0000-0000-000000000001', agent: 'codex', title: 'Demo workspace' },
    { ...base, id: 'demo-claude', agent: 'claude', title: 'Review navigation', status: 'waiting', activity: 'Approval requested' },
  ];
};
const server = createServer(watcher, { demo: true, privacy: false });
server.listen(0, '127.0.0.1', async () => {
  try {
    for (const file of (process.env.BUREAU_TEST_FILES || 'bureau-ui.cjs,bureau-focus.cjs,bureau-picking.cjs,bureau-tools.cjs,bureau-telemetry.cjs,bureau-updates.cjs,bureau-lifecycle.cjs,bureau-scene.cjs,bureau-hover-edge.cjs').split(',')) {
      console.log('\nRUN '+file);
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, file)], {
          env: { ...process.env, WMAD_CHROMIUM: chrome, BUREAU_URL: `http://127.0.0.1:${server.address().port}` }, stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${file}: ${code}`)));
      });
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.closeAllConnections(); server.close(); fs.rmSync(home, {recursive:true,force:true}); }
});
