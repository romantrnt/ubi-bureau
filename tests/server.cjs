// Each case owns a child process so an uncaught request error fails the test.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

for (const scenario of ['assets', 'scenes', 'guards']) {
  test(`HTTP ${scenario}: malformed paths and resource boundaries`, t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-server-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const child = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/server.cjs'), scenario, home], {
      env: { ...process.env, HOME: home, USERPROFILE: home, WMAD_NO_UPDATE_CHECK: '1' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
}

test('clock expiration preserves last-known evidence without inventing completion or idleness', () => {
  const { presence, EVIDENCE_TTL } = require('../src/server');
  const now = Date.now();
  for (const status of ['thinking', 'tool', 'typing', 'waiting', 'idle']) {
    const session = { status, lastEventAt: now, activity: 'npm test' };
    const fresh = presence(session, now + EVIDENCE_TTL, false);
    assert.equal(fresh.status, status);
    assert.equal(fresh.presence.kind, 'recent');
    assert.equal(fresh.presence.live, false, 'a fresh log does not prove the process is alive');
    const expired = presence(session, now + EVIDENCE_TTL + 1, false);
    assert.equal(expired.status, 'unknown');
    assert.equal(expired.presence.lastKnownStatus, status);
    assert.equal(expired.presence.reason, 'stale-evidence');
  }
  for (const status of ['done', 'error', 'interrupted']) {
    const value = presence({ status, lastEventAt: now - 86_400_000 }, now, false);
    assert.equal(value.status, status);
    assert.equal(value.presence.kind, 'terminal');
    assert.equal(value.presence.stale, true);
  }
});

test('missing timestamps, future clocks and file metadata cannot fabricate current presence', () => {
  const { presence } = require('../src/server');
  const { newSession, applyCodex } = require('../src/parsers');
  const now = Date.now();
  for (const lastEventAt of [null, undefined, now + 5001]) {
    assert.equal(presence({ status: 'tool', lastEventAt, mtime: now }, now).status, 'unknown');
  }
  const s = newSession('codex', 'metadata', '/fixture');
  applyCodex(s, { timestamp: new Date(now - 300_000).toISOString(), type: 'event_msg', payload: { type: 'task_started' } });
  applyCodex(s, { timestamp: new Date(now).toISOString(), type: 'turn_context', payload: { model: 'new-model' } });
  assert.equal(s.lastEventAt, now);
  assert.equal(presence(s, now).status, 'unknown', 'model metadata must not refresh an unfinished turn');
  applyCodex(s, { timestamp: new Date(now).toISOString(), type: 'event_msg', payload: { type: 'task_complete' } });
  assert.equal(presence(s, now + 300_000).status, 'done');
});

test('snapshots expose truthful provenance, unavailable counts and last-known tool details', () => {
  const { snapshot } = require('../src/server');
  const now = Date.now();
  const { sessions: dot } = require('../src/dot-snapshot').readDotSnapshot('/does-not-exist', now);
  const value = snapshot({ sessions: () => [...dot, { agent: 'codex', id: 'old', status: 'tool',
    lastEventAt: now - 300_000, activity: 'Shell: npm test', title: 'Fixture', cwd: '/fixture' }] });
  const root = value.sessions.find(s => s.agent === 'dot');
  assert.equal(root.key, 'dot:/root');
  assert.equal(root.status, 'unknown');
  assert.equal(root.activeSubagents, null);
  assert.equal(root.presence.source, 'dot-snapshot');
  assert.equal(root.presence.live, false);
  const old = value.sessions.find(s => s.agent === 'codex');
  assert.equal(old.status, 'unknown');
  assert.equal(old.activity, 'Shell: npm test');
  assert.equal(old.presence.lastKnownStatus, 'tool');
  const safe = snapshot({ sessions: () => [{ agent: 'codex', id: 'old', status: 'tool',
    lastEventAt: now - 300_000, activity: 'Shell: private command', prompt: 'private prompt' }] }, { privacy: true });
  assert.equal(safe.sessions[0].activity, 'Shell');
  assert.equal(safe.sessions[0].prompt, null);
});

test('only a fresh reliable in-flight feed can claim live presence', () => {
  const { presence } = require('../src/server');
  const now = Date.now();
  const s = { source: 'magpie', status: 'thinking', lastEventAt: now - 1_200_000, liveObservedAt: now };
  assert.equal(presence(s, now).presence.live, true);
  assert.equal(presence(s, now).status, 'thinking');
  assert.equal(presence(s, now + 15_001).status, 'unknown');
  assert.equal(presence({ ...s, status: 'idle', liveObservedAt: null }, now).status, 'unknown');
  assert.equal(presence({ status: 'tool', lastEventAt: now - 300_000 }, now, true).presence.source, 'demo');
});

test('demo includes one unknown Dot without importing real observations or invented worker counts', () => {
  const { snapshot } = require('../src/server');
  const value = snapshot({ sessions: () => [] }, { demo: true, dotSnapshot: true });
  assert.equal(value.sessions.length, 1);
  assert.equal(value.sessions[0].key, 'dot:/root');
  assert.equal(value.sessions[0].status, 'unknown');
  assert.equal(value.sessions[0].activeSubagents, null);
  assert.equal(value.sessions[0].model, undefined);
  assert.equal(value.dotConnection.available, false);
});

test('connections endpoint is read-only, private-aware, uncached and protected by the loopback host guard', async t => {
  const { EventEmitter, once } = require('node:events');
  const { createServer } = require('../src/server');
  const watcher = new EventEmitter(); watcher.sessions = () => [];
  const options = [];
  watcher.connections = opts => {
    options.push(opts);
    return { checkedAt: 1, live: false, providers: [{ id: 'hermes', paths: opts.privacy ? [] : [{ path: '/fixture/state.db' }] }] };
  };
  const server = createServer(watcher, { privacy: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/connections`;
  const response = await fetch(url);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).providers[0].paths, []);
  assert.deepEqual(options, [{ privacy: true }]);
  const post = await fetch(url, { method: 'POST' });
  assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET');
  const forbidden = await new Promise((resolve, reject) => {
    require('node:http').get(url, { headers: { host: 'untrusted.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(forbidden, 403);
  assert.equal(options.length, 1, 'forbidden requests do not query local connection state');
});
