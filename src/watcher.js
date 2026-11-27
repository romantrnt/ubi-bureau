'use strict';

// Finds recent session logs on disk and keeps reading them as they grow.
// Polling (not fs.watch) because it behaves the same on macOS, Linux and
// Windows, and a 1s stat loop over a few hundred files is cheap.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');
const crypto = require('crypto');
const { newSession, applyClaude, applyCodex, applyGemini, applyGeminiDocument, applyCopilot, applyOMP, applyAntigravity } = require('./parsers');
const { Magpie } = require('./magpie');
const { clientFiles, metadata, applyKimi, applyDsh, applyGrok, readDsh } = require('./clients');
const external = require('./external');
const { ompDirs, piDirs } = require('./omp');
const hook = require('./hook');
const { transcript } = require('./transcript');

const HEAD_BYTES = 128 * 1024;
const TAIL_BYTES = 768 * 1024;
// OMP, Kimi and Grok logs are replayed whole up to this size, then read head + tail like the others.
const OMP_FULL_BYTES = 32 * 1024 * 1024;
// Pi writes the logs OMP does, so both take the same path through the watcher.
const OMP_LIKE = new Set(['omp', 'pi']);
// DSH logs are decoded and replayed whole, so a busy log is re-read at most this often.
const DSH_REPLAY_MS = 5000;

const home = os.homedir();
const CLAUDE_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects');
const CODEX_HOME = process.env.CODEX_HOME || path.join(home, '.codex');
const CODEX_DIR = path.join(CODEX_HOME, 'sessions');
const CODEX_INDEX = path.join(CODEX_HOME, 'session_index.jsonl');
// Gemini CLI: ~/.gemini (or $GEMINI_CLI_HOME/.gemini); sandboxed runs on
// macOS keep their state under ~/.cache/.gemini instead.
const GEMINI_HOMES = [
  path.join(process.env.GEMINI_CLI_HOME || home, '.gemini'),
  path.join(home, '.cache', '.gemini'),
];
const GEMINI_DIR = path.join(GEMINI_HOMES[0], 'tmp');
const COPILOT_DIR = path.join(home, '.copilot', 'session-state');
const ANTIGRAVITY_HOME = process.env.ANTIGRAVITY_HOME || path.join(home, '.gemini', 'antigravity-cli');
const ANTIGRAVITY_DIR = path.join(ANTIGRAVITY_HOME, 'brain');
const ANTIGRAVITY_ROOTS = [
  { id: 'antigravity-cli', home: ANTIGRAVITY_HOME },
  { id: 'antigravity-app', home: process.env.ANTIGRAVITY_APP_HOME || path.join(home, '.gemini', 'antigravity') },
  { id: 'antigravity-ide', home: process.env.ANTIGRAVITY_IDE_HOME || path.join(home, '.gemini', 'antigravity-ide') },
];
const CLIENT_DIRS = {
  kimi: path.join(process.env.KIMI_CODE_HOME || path.join(home, '.kimi-code'), 'sessions'),
  dsh: path.join(process.env.DSH_HOME || path.join(home, '.dsh'), 'sessions'),
  grok: path.join(process.env.GROK_HOME || path.join(home, '.grok'), 'sessions'),
};

function ls(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function statSafe(f) {
  try { return fs.statSync(f); } catch { return null; }
}

function readRange(file, start, end, decoder) {
  const len = Math.max(0, end - start);
  if (!len) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return decoder ? decoder.write(buf) : buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function claudeFiles() {
  const out = [];
  for (const proj of ls(CLAUDE_DIR)) {
    if (!proj.isDirectory()) continue;
    const pdir = path.join(CLAUDE_DIR, proj.name);
    for (const e of ls(pdir)) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push({ agent: 'claude', file: path.join(pdir, e.name), id: e.name.slice(0, -6) });
      } else if (e.isDirectory()) {
        const sub = path.join(pdir, e.name, 'subagents');
        for (const s of ls(sub)) {
          if (s.isFile() && s.name.endsWith('.jsonl')) {
            out.push({ agent: 'claude', file: path.join(sub, s.name), id: s.name.slice(0, -6), parentId: e.name });
          }
        }
      }
    }
  }
  return out;
}

function geminiFiles() {
  // <root>/tmp/<project>/chats/session-*.jsonl (+ legacy .json), and
  // subagents in <root>/tmp/<project>/chats/<parentSessionId>/<id>.jsonl
  const out = [];
  for (const root of GEMINI_HOMES) {
    const tmp = path.join(root, 'tmp');
    for (const proj of ls(tmp)) {
      if (!proj.isDirectory()) continue;
      const chats = path.join(tmp, proj.name, 'chats');
      for (const e of ls(chats)) {
        if (e.isFile() && /^session-.*\.jsonl?$/.test(e.name)) {
          out.push({ agent: 'gemini', file: path.join(chats, e.name), id: e.name.replace(/\.jsonl?$/, ''), project: proj.name, root });
        } else if (e.isDirectory()) {
          for (const f of ls(path.join(chats, e.name))) {
            if (f.isFile() && /\.jsonl$/.test(f.name)) {
              out.push({ agent: 'gemini', file: path.join(chats, e.name, f.name), id: f.name.slice(0, -6), project: proj.name, root, parentId: e.name });
            }
          }
        }
      }
    }
  }
  return out;
}

function codexFiles(sinceMs) {
  // Date folders record when a chat began, not when it was last used. Walk
  // every date so a months-old chat can be discovered when it resumes.
  // Check mtime here to keep inactive history out of the 1s polling list;
  // only the 5s discovery scan stats those files, without reading their logs.
  const out = [];
  for (const y of ls(CODEX_DIR)) {
    if (!y.isDirectory()) continue;
    for (const m of ls(path.join(CODEX_DIR, y.name))) {
      if (!m.isDirectory()) continue;
      for (const d of ls(path.join(CODEX_DIR, y.name, m.name))) {
        if (!d.isDirectory()) continue;
        const dir = path.join(CODEX_DIR, y.name, m.name, d.name);
        for (const f of ls(dir)) {
          if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
          const file = path.join(dir, f.name);
          const st = statSafe(file);
          if (!st || st.mtimeMs < sinceMs) continue;
          const id = (f.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/) || [])[1] || f.name;
          out.push({ agent: 'codex', file, id });
        }
      }
    }
  }
  return out;
}

function copilotFiles() {
  const out = [];
  for (const session of ls(COPILOT_DIR)) {
    if (!session.isDirectory()) continue;
    const events = path.join(COPILOT_DIR, session.name, 'events.jsonl');
    if (statSafe(events)) out.push({ agent: 'copilot', file: events, id: session.name });
  }
  return out;
}

function antigravityFiles(sinceMs) {
  const out = [];
  const seen = new Set();
  for (const root of ANTIGRAVITY_ROOTS) for (const e of ls(path.join(root.home, 'brain'))) {
    if (!e.isDirectory()) continue;
    const file = path.join(root.home, 'brain', e.name, '.system_generated', 'logs', 'transcript.jsonl');
    const st = statSafe(file);
    if (!st || st.mtimeMs < sinceMs) continue;
    let real;
    try { real = fs.realpathSync(file); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push({ agent: 'antigravity', file, id: e.name, connectionId: root.id, antigravityHome: root.home });
  }
  return out;
}

// A protobuf text-format string body: non-ASCII text is written as octal
// UTF-8 bytes (\346\226\207), alongside the usual C escapes.
function pbtxtString(raw) {
  const out = [];
  for (const m of raw.matchAll(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|([\s\S]))|([^\\]+)/g)) {
    if (m[4]) out.push(Buffer.from(m[4]));
    else if (m[1]) out.push(Buffer.from([parseInt(m[1], 8) & 255]));
    else if (m[2]) out.push(Buffer.from([parseInt(m[2], 16)]));
    else out.push(Buffer.from({ n: '\n', t: '\t', r: '\r' }[m[3]] ?? m[3]));
  }
  return Buffer.concat(out).toString('utf8');
}

function ompFiles(sinceMs, roots, agent = 'omp') {
  const out = [], seen = new Set();
  const add = (dir, profile, parentFile = null, depth = 0) => {
    if (depth > 20) return;
    const entries = ls(dir);
    // OMP keeps each agent's children in a directory named after its own log.
    // Dirents don't follow symlinks, so a linked directory is never walked.
    const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl') || e.name.includes('.bak')) continue;
      if (!parentFile && e.name.startsWith('__advisor')) continue;
      const file = path.join(dir, e.name), st = statSafe(file);
      if (!st) continue;
      const fresh = st.mtimeMs >= sinceMs;
      if (fresh && !seen.has(file)) {
        seen.add(file);
        out.push({ agent, file, id: null, profile, parentFile });
      }
      const stem = e.name.slice(0, -6);
      if (!dirs.has(stem)) continue;
      const children = path.join(dir, stem);
      // A quiet parent whose child directory gained no entries in the window
      // has no new children, so old history isn't walked on every scan.
      if (!fresh && (statSafe(children)?.mtimeMs || 0) < sinceMs) continue;
      add(children, profile, file, depth + 1);
    }
  };
  for (const { dir, profile } of roots) {
    add(dir, profile); // --session-dir may point straight at a log directory
    for (const e of ls(dir)) {
      // A root-level log's sibling artifact directory is not a project directory.
      if (e.isDirectory() && !statSafe(path.join(dir, e.name + '.jsonl'))) add(path.join(dir, e.name), profile);
    }
  }
  return out;
}

// OMP may record a parent through a symlink (macOS /var, a linked ~/.omp) or,
// on Windows, with different case; compare real paths. Cached per session.
function sameOMPPath(s, a, b) {
  const key = `${a}\0${b}`;
  if (s._ompPathKey === key) return s._ompPathSame;
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  s._ompPathKey = key;
  s._ompPathSame = path.resolve(a) === path.resolve(b) || real(a) === real(b);
  return s._ompPathSame;
}

class Watcher extends EventEmitter {
  constructor({ hours = 24, interval = 1000, ompDir, magpieSources = process.env.WMAD_MAGPIE_SOURCES,
    magpieUrl = process.env.WMAD_MAGPIE_URL, magpieKey = process.env.WMAD_MAGPIE_KEY } = {}) {
    super();
    this.windowMs = hours * 3600 * 1000;
    this.interval = interval;
    this.trackers = new Map(); // file -> { session, offset, partial, apply }
    this.failed = new Map();   // file -> retry-after time, for logs we couldn't read
    this.dshWarned = false;
    this.codexNames = new Map();
    this.geminiProjects = new Map(); // tmp dir name -> project path
    this.geminiRegistryMtime = 0;
    this.codexIndexMtime = 0;
    this.lastScan = 0;
    this.candidates = [];
    if (typeof magpieSources === 'string') {
      try { magpieSources = JSON.parse(magpieSources); } catch { throw new Error('WMAD_MAGPIE_SOURCES must be a JSON array of {url, key} objects'); }
    }
    const sources = magpieSources ?? (magpieUrl ? [{ url: magpieUrl, key: magpieKey }] : []);
    if (!Array.isArray(sources) || sources.some((s) => !s || typeof s.url !== 'string' || typeof s.key !== 'string')) {
      throw new Error('WMAD_MAGPIE_SOURCES must be an array of {url, key} objects');
    }
    this.magpies = sources.map(({ url, key }, i) => {
      const source = new Magpie({ url, key, hours });
      source.on('change', () => this.emit('change'));
      source.on('warning', (message) => console.error(`Magpie source ${i + 1}: ${message}; current presence is unknown. Retrying.`));
      return source;
    });
    this.ompDir = ompDir;
    this.ompParentIds = new Map(); // parent log -> { mtime, size, id }
    this.waiting = new Map(); // Claude session ID -> { at, message } from the optional hook
    this.antigravityWorkspaces = new Map();
    this.antigravityTitles = new Map();
    // opencode and hermes sessions, refreshed from their databases on each scan.
    this.external = [];
    this.externalKey = '';
  }

  start() {
    this.tick();
    for (const source of this.magpies) source.start();
    this.timer = setInterval(() => this.tick(), this.interval);
    return this;
  }

  stop() { clearInterval(this.timer); for (const source of this.magpies) source.stop(); }

  loadCodexIndex() {
    const st = statSafe(CODEX_INDEX);
    if (!st || st.mtimeMs === this.codexIndexMtime) return false;
    this.codexIndexMtime = st.mtimeMs;
    const start = Math.max(0, st.size - 2 * 1024 * 1024);
    for (const line of readRange(CODEX_INDEX, start, st.size).split('\n')) {
      try {
        const d = JSON.parse(line);
        if (d.id && d.thread_name) this.codexNames.set(d.id, d.thread_name);
      } catch {}
    }
    return true;
  }

  loadAntigravityHistory() {
    let changed = false;
    this.antigravityHistoryTimes ||= new Map();
    for (const root of ANTIGRAVITY_ROOTS) {
      const file = path.join(root.home, 'history.jsonl');
      const st = statSafe(file);
      if (!st || st.mtimeMs === this.antigravityHistoryTimes.get(file)) continue;
      this.antigravityHistoryTimes.set(file, st.mtimeMs);
      changed = true;
      const start = Math.max(0, st.size - 2 * 1024 * 1024);
      for (const line of readRange(file, start, st.size).split('\n')) {
        try {
          const d = JSON.parse(line);
          if (d.conversationId && d.workspace) this.antigravityWorkspaces.set(`${root.home}:${d.conversationId}`, d.workspace);
        } catch {}
      }
    }
    return changed;
  }

  antigravityTitle(id, root = ANTIGRAVITY_HOME) {
    const file = path.join(root, 'annotations', `${id}.pbtxt`);
    const st = statSafe(file);
    if (!st) return null;
    const cached = this.antigravityTitles.get(file);
    if (cached && cached.mtime === st.mtimeMs) return cached.title;
    let title = null;
    try {
      const raw = readRange(file, 0, Math.min(st.size, 4096));
      const m = raw.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) title = pbtxtString(m[1]).replace(/\s+/g, ' ').trim() || null;
    } catch {}
    this.antigravityTitles.set(file, { mtime: st.mtimeMs, title });
    return title;
  }

  // ~/.gemini/projects.json maps project paths to the short slugs used as
  // tmp dir names; older versions used sha256(path) instead.
  loadGeminiProjects() {
    let mt = 0;
    const files = GEMINI_HOMES.map((r) => path.join(r, 'projects.json'));
    for (const f of files) mt += (statSafe(f) || {}).mtimeMs || 0;
    if (mt === this.geminiRegistryMtime) return false;
    this.geminiRegistryMtime = mt;
    for (const f of files) {
      try {
        const reg = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const [dir, slug] of Object.entries(reg.projects || {})) {
          this.geminiProjects.set(slug, dir);
          this.geminiProjects.set(crypto.createHash('sha256').update(dir).digest('hex'), dir);
        }
      } catch {}
    }
    return true;
  }

  // opencode and hermes have no per-session file to tail, so their whole
  // listing is rebuilt here and every row is compared to the last one.
  loadExternal(since) {
    let rows;
    this.databaseHealth = [];
    try { rows = external.poll(since, { home, env: process.env, diagnostics: this.databaseHealth }); } catch { return false; }
    const key = JSON.stringify(rows);
    if (key === this.externalKey) return false;
    this.externalKey = key;
    this.external = rows;
    return true;
  }

  tick() {
    const now = Date.now();
    const since = now - this.windowMs;
    let changed = this.loadCodexIndex();
    if (this.loadWaiting(since)) changed = true;
    if (this.loadGeminiProjects()) changed = true;
    if (this.loadAntigravityHistory()) changed = true;

    // Directory walk every 5s; stat known files every tick.
    if (now - this.lastScan > 5000) {
      this.lastScan = now;
      const ompRoots = ompDirs(this.ompDir, process.env, home, process.platform);
      // PI_CODING_AGENT_DIR can point both at one directory; its logs stay OMP's then.
      const piRoots = piDirs(process.env, home).filter((r) => !ompRoots.some((o) => path.resolve(o.dir) === path.resolve(r.dir)));
      this.candidates = [...claudeFiles(), ...codexFiles(since), ...geminiFiles(), ...copilotFiles(),
        ...clientFiles(CLIENT_DIRS, since), ...ompFiles(since, ompRoots), ...ompFiles(since, piRoots, 'pi'),
        ...antigravityFiles(since)];
      // These have no file to tail, so they refresh with the walk.
      if (this.loadExternal(since)) changed = true;
    }

    for (const c of this.candidates) {
      // A log we can't read (permissions, deleted mid-read…) is skipped and
      // retried a minute later; it must never take the server down.
      if ((this.failed.get(c.file) || 0) > now) continue;
      try {
        if (this.track(c, since)) changed = true;
      } catch (e) {
        if (c.agent === 'dsh') {
          // A zstd frame may be half-written. Keep the last readable snapshot.
          // A log over the replay limit stays too big, so don't decode it again soon.
          this.failed.set(c.file, now + (e?.tooLarge ? 60000 : DSH_REPLAY_MS));
          if (!this.dshWarned) {
            console.error('DSH: log decoding failed; keeping the last readable state and retrying. See the zstd requirements and size limit in README.');
            this.dshWarned = true;
          }
        } else {
          this.failed.set(c.file, now + 60000);
          this.trackers.delete(c.file);
        }
      }
    }

    for (const [file, t] of this.trackers) {
      if (!statSafe(file)) { this.trackers.delete(file); changed = true; continue; }
      const activity = OMP_LIKE.has(t.session.agent) ? Math.max(t.session.lastEventAt || 0, t.session.mtime || 0) : (t.session.lastEventAt || t.session.mtime || 0);
      if (activity < since) { this.trackers.delete(file); changed = true; }
    }
    for (const [file, retryAt] of this.failed) if (retryAt <= now) this.failed.delete(file);

    if (changed) this.emit('change');
  }

  // Returns true when this file's session changed.
  track(c, since) {
    const st = statSafe(c.file);
    const t = this.trackers.get(c.file);
    if (!st) return this.trackers.delete(c.file);
    if (!t) {
      if (st.mtimeMs < since) return false;
      this.open(c, st);
      return true;
    }
    if (OMP_LIKE.has(c.agent)) {
      // The title slot is rewritten in place, sometimes without changing the size.
      const modified = st.mtimeMs !== t.mtime || st.ctimeMs !== t.ctime || st.ino !== t.ino;
      if (st.size < t.offset || (modified && st.size === t.offset) || st.ino !== t.ino) {
        this.open(c, st);
        return true;
      }
      if (st.size > t.offset) {
        this.feedOMP(t, c.file, t.offset, st.size);
        this.ompTitle(t, c.file, st.size);
        t.offset = st.size;
        t.mtime = t.session.mtime = st.mtimeMs;
        t.ctime = st.ctimeMs;
        return true;
      }
      return false;
    }
    let changed = false;
    if (t.whole && (st.mtimeMs !== t.mtime || st.size !== t.offset)) {
      // Whole documents and compressed streams are replaced only after reading.
      if (c.agent === 'dsh' && Date.now() - t.readAt < DSH_REPLAY_MS) return false;
      this.open(c, st);
      return true;
    } else if (!t.whole && (st.ino !== t.ino || (st.size === t.offset && st.mtimeMs !== t.mtime))) {
      // Rotated JSONL files can be the same size or larger than the previous
      // inode. Reading from the old offset would mix two unrelated histories.
      this.open(c, st);
      return true;
    } else if (st.size > t.offset) {
      t.geminiAnyStatusWritten = false;
      this.feed(t, readRange(c.file, t.offset, st.size, t.decoder), false);
      if (c.agent === 'gemini' && t.geminiAnyStatusWritten) t.session.statusObservedAt = st.mtimeMs;
      t.offset = st.size;
      changed = true;
    } else if (st.size < t.offset) {
      // Publish the replacement in the same tick; no stale row or empty tick.
      this.open(c, st);
      return true;
    }
    if (c.metadata) {
      const meta = statSafe(c.metadata);
      if (meta && (meta.mtimeMs !== t.metaMtime || meta.size !== t.metaSize)) {
        metadata(t.session, c.agent, c.metadata);
        t.metaMtime = meta.mtimeMs; t.metaSize = meta.size;
        changed = true;
      }
    }
    t.mtime = t.session.mtime = st.mtimeMs;
    return changed;
  }

  open(c, st) {
    const session = newSession(c.agent, c.id, c.file);
    if (c.connectionId) session.connectionId = c.connectionId;
    if (c.antigravityHome) session.antigravityHome = c.antigravityHome;
    if (c.sessionId) session.sessionId = c.sessionId;
    if (c.parentId) { session.parentId = c.parentId; session.subagent = true; }
    session.mtime = st.mtimeMs;
    if (c.agent === 'gemini') session.geminiProject = c.project;
    const apply = { claude: applyClaude, codex: applyCodex, gemini: applyGemini, copilot: applyCopilot, kimi: applyKimi, dsh: applyDsh, grok: applyGrok, omp: applyOMP, pi: applyOMP, antigravity: applyAntigravity }[c.agent];
    const t = { session, offset: st.size, partial: '', apply, mtime: st.mtimeMs, ino: st.ino };
    if (c.agent === 'dsh') {
      t.whole = true;
      t.readAt = Date.now();
      this.feed(t, readDsh(c.file), false);
      if (!session._dshHeader) throw new Error('DSH header is not readable yet');
      for (const [file, old] of this.trackers) {
        if (old.session.agent === 'dsh' && old.session.id === session.id) this.trackers.delete(file);
      }
      this.trackers.set(c.file, t);
      return t;
    }
    if (OMP_LIKE.has(c.agent)) {
      session.ompProfile = c.profile;
      if (c.parentFile) {
        session.subagent = true;
        session.ompParentFile = c.parentFile;
        session.ompAgentName = path.basename(c.file, '.jsonl');
      }
      t.decoder = new StringDecoder('utf8');
      t.ctime = st.ctimeMs;
      t.ino = st.ino;
      // A full chunked replay keeps metadata and every open toolCall; past
      // OMP_FULL_BYTES only calls still open in the tail are seen.
      if (st.size <= OMP_FULL_BYTES) this.feedOMP(t, c.file, 0, st.size);
      else {
        this.feed(t, readRange(c.file, 0, HEAD_BYTES), true);
        t.partial = '';
        this.feedOMP(t, c.file, st.size - TAIL_BYTES, st.size, true);
      }
      this.ompTitle(t, c.file, st.size);
      this.trackers.set(c.file, t);
      return t;
    }
    if (c.agent === 'gemini' && c.file.endsWith('.json')) {
      t.whole = true;
      try { applyGeminiDocument(session, JSON.parse(readRange(c.file, 0, st.size))); } catch {}
      const old = this.trackers.get(c.file)?.session;
      // On first load, the document mtime might describe a title-only edit.
      // Only a changed message observed by this watcher can use that clock.
      if (session._statusRevision && old) session.statusObservedAt = old._geminiLastMessage === session._geminiLastMessage
        ? old.statusObservedAt : st.mtimeMs;
      this.trackers.set(c.file, t);
      return t;
    }
    // Keep a decoder for later Kimi/Grok appends that split a UTF-8 character.
    if (c.agent === 'kimi' || c.agent === 'grok') t.decoder = new StringDecoder('utf8');
    if (t.decoder && st.size <= OMP_FULL_BYTES) {
      // Pending tools and approvals need every event, including the middle.
      for (let start = 0; start < st.size; start += TAIL_BYTES) {
        this.feed(t, readRange(c.file, start, Math.min(start + TAIL_BYTES, st.size), t.decoder), false);
      }
    } else if (st.size <= HEAD_BYTES + TAIL_BYTES) {
      this.feed(t, readRange(c.file, 0, st.size), false);
    } else {
      // Big log: head for metadata (cwd, title, model), tail for current state.
      this.feed(t, readRange(c.file, 0, HEAD_BYTES), true);
      t.partial = '';
      this.feed(t, readRange(c.file, st.size - TAIL_BYTES, st.size, t.decoder), false, true);
    }
    if (c.metadata) {
      metadata(session, c.agent, c.metadata);
      const meta = statSafe(c.metadata);
      t.metaMtime = meta?.mtimeMs; t.metaSize = meta?.size;
    }
    // Gemini re-appends its current message with its original timestamp.
    // Only a lifecycle-bearing record can use the file's write time; a later
    // title/model/$set record must not revive the previous message.
    if (c.agent === 'gemini' && t.geminiStatusWritten) session.statusObservedAt = st.mtimeMs;
    this.trackers.set(c.file, t);
    return t;
  }

  feedOMP(t, file, start, end, skipFirstLine = false) {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(128 * 1024);
      while (start < end) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, end - start), start);
        if (!n) break;
        let text = t.decoder.write(buf.subarray(0, n));
        if (skipFirstLine) {
          // a tail read starts mid-line: drop everything up to the first newline
          const nl = text.indexOf('\n');
          text = nl < 0 ? '' : text.slice(nl + 1);
          if (nl >= 0) skipFirstLine = false;
        }
        this.feed(t, text, false);
        start += n;
      }
    } finally { fs.closeSync(fd); }
  }

  ompTitle(t, file, size) {
    const first = readRange(file, 0, Math.min(size, 4096)).split('\n')[0];
    try {
      const slot = JSON.parse(first);
      if (slot.type === 'title') applyOMP(t.session, slot);
    } catch {}
  }

  feed(t, chunk, dropLastPartial, dropFirst = false) {
    const lines = (t.partial + chunk).split('\n');
    t.partial = lines.pop();
    if (dropFirst) lines.shift();
    if (dropLastPartial) t.partial = '';
    for (const line of lines) {
      if (!line) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      const revision = t.session._statusRevision || 0;
      try { t.apply(t.session, d); } catch {}
      if (t.session.agent === 'gemini') {
        t.geminiStatusWritten = revision !== (t.session._statusRevision || 0);
        // Incremental reads may include a message and metadata in one batch.
        // Startup still uses only the last record to avoid reviving history.
        if (t.geminiStatusWritten) t.geminiAnyStatusWritten = true;
      }
    }
  }

  // The parent's session ID, from its tracker or (when it is outside the
  // window) from its header, cached until the parent log changes.
  ompParentId(file) {
    const tracked = this.trackers.get(file)?.session?.sessionId;
    if (tracked) return tracked;
    const st = statSafe(file);
    if (!st) return null;
    const cached = this.ompParentIds.get(file);
    if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached.id;
    let id = null;
    try {
      for (const line of readRange(file, 0, Math.min(st.size, HEAD_BYTES)).split('\n')) {
        try { const d = JSON.parse(line); if (d.type === 'session' && typeof d.id === 'string' && d.id) { id = d.id; break; } } catch {}
      }
    } catch {}
    this.ompParentIds.set(file, { mtime: st.mtimeMs, size: st.size, id });
    return id;
  }

  // Markers written by `cli.js --hook`; returns true when they changed.
  loadWaiting(since) {
    const next = hook.markers(since);
    const key = (m) => [...m].map(([id, w]) => `${id}:${w.at}`).sort().join();
    const changed = key(next) !== key(this.waiting);
    this.waiting = next;
    return changed;
  }

  // Recent messages of one tracked session, looked up by its key — never by a path from the client.
  transcript(key) {
    for (const t of this.trackers.values()) {
      if (`${t.session.agent}:${t.session.id}` === key) return transcript(t.session, t.apply);
    }
    return null;
  }

  sessions() {
    const out = [];
    for (const t of this.trackers.values()) {
      const s = t.session;
      if (OMP_LIKE.has(s.agent)) {
        // Skip stray JSONL files and logs whose header isn't written yet.
        if (!s.sessionId || !s.cwd) continue;
        if (s.subagent && s.ompParentFile) {
          // parentSession alone also describes ordinary branched conversations;
          // require the artifact directory it was found in to match its parent.
          const advisor = /^__advisor(?:[._-].*)?$/.test(s.ompAgentName);
          if (s.parentSession && !sameOMPPath(s, s.parentSession, s.ompParentFile)) continue;
          if (!s.parentSession && !advisor) continue;
          s.parentId = this.ompParentId(s.ompParentFile);
          if (!s.title) s.title = advisor ? 'Advisor' : s.ompAgentName.replace(/\./g, ' > ');
        }
        s.lastEventAt = Math.max(s.lastEventAt || 0, s.mtime || 0);
      }
      if (s.agent === 'gemini' && !s.cwd && this.geminiProjects.has(s.geminiProject)) {
        s.cwd = this.geminiProjects.get(s.geminiProject);
      }
      if (s.agent === 'gemini' && !s.cwd) s.cwd = s.geminiProject;
      // Gemini re-appends whole messages with their original timestamps, so
      // the file's own write time is the best "last activity" signal.
      if (s.agent === 'gemini') s.lastEventAt = Math.max(s.lastEventAt || 0, s.mtime || 0);
      if (s.agent === 'codex' && !s.title) {
        const name = this.codexNames.get(s.id);
        if (name) s.title = name;
      }
      if (s.agent === 'antigravity') {
        const root = s.antigravityHome || ANTIGRAVITY_HOME;
        if (!s.cwd) s.cwd = this.antigravityWorkspaces.get(`${root}:${s.id}`) || (s.parentId && this.antigravityWorkspaces.get(`${root}:${s.parentId}`)) || null;
        // Cached by mtime, so a renamed conversation picks up its new title.
        const t = this.antigravityTitle(s.id, root);
        if (t) s.title = t;
      }
      // A permission prompt from the optional Claude Code hook, until the log moves on.
      const wait = s.agent === 'claude' && !s.subagent && this.waiting.get(s.id);
      if (wait && wait.at > (s.lastEventAt || 0)) {
        out.push({ ...s, status: 'waiting', activity: wait.message || null, lastEventAt: wait.at, statusObservedAt: wait.at });
        continue;
      }
      out.push(s);
    }
    // Copied histories (see applyClaude's _rootUuid) are one conversation:
    // show the copy that was active most recently and hide the rest.
    const newestByRoot = new Map();
    for (const s of out) {
      if (s.agent !== 'claude' || s.subagent || !s._rootUuid) continue;
      const prev = newestByRoot.get(s._rootUuid);
      if (!prev || (s.lastEventAt || 0) > (prev.lastEventAt || 0)
        || ((s.lastEventAt || 0) === (prev.lastEventAt || 0) && (s.mtime || 0) > (prev.mtime || 0))) {
        newestByRoot.set(s._rootUuid, s);
      }
    }
    if (newestByRoot.size) {
      const kept = new Set(newestByRoot.values());
      for (let i = out.length - 1; i >= 0; i--) {
        const s = out[i];
        if (s.agent === 'claude' && !s.subagent && s._rootUuid && !kept.has(s)) out.splice(i, 1);
      }
    }
    // App and IDE can mirror the same conversation. Keep one body and choose
    // by recorded event time, so copying a stale log cannot revive its turn.
    const antigravityById = new Map();
    for (const s of out) if (s.agent === 'antigravity') {
      const previous = antigravityById.get(s.id);
      if (!previous || (s.lastEventAt || 0) > (previous.lastEventAt || 0)) antigravityById.set(s.id, s);
    }
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].agent === 'antigravity' && antigravityById.get(out[i].id) !== out[i]) out.splice(i, 1);
    }
    out.push(...this.external);
    if (!this.magpies.length) return out;
    const remote = new Map();
    // Magpie's native records carry richer metadata than gateway projections.
    // Prefer those, then the newest record; any healthy in-flight call counts.
    const records = this.magpies.flatMap((m) => m.sessions())
      .sort((a, b) => Number(a.gateway) - Number(b.gateway) || b.lastEventAt - a.lastEventAt);
    for (const s of records) {
      const key = `${s.agent}:${s.id}`;
      const other = remote.get(key);
      if (!other) { remote.set(key, { ...s }); continue; }
      for (const field of ['title', 'cwd', 'model', 'agentName', 'parentId', 'startedAt']) {
        if (!other[field]) other[field] = s[field];
      }
      other.subagent ||= s.subagent;
      if (s.status === 'thinking') {
        other.status = 'thinking';
        other.liveObservedAt = Math.max(other.liveObservedAt || 0, s.liveObservedAt || 0);
        other.statusObservedAt = Math.max(other.statusObservedAt || 0, s.statusObservedAt || 0);
      }
      other.lastEventAt = Math.max(other.lastEventAt, s.lastEventAt);
    }
    const merged = out.map((s) => {
      // Gemini's file name can differ from its ID. Kimi children instead carry
      // the parent sessionId for resume, which must not consume the parent's row.
      const alias = s.agent === 'gemini' && s.sessionId;
      const other = remote.get(`${s.agent}:${s.id}`) || (alias && remote.get(`${s.agent}:${alias}`));
      remote.delete(`${s.agent}:${s.id}`);
      if (alias) remote.delete(`${s.agent}:${alias}`);
      // Do not write fallback metadata into the native tracker: its own title
      // may arrive later, or the gateway may disappear.
      return other ? { ...s, title: s.title || other.title, cwd: s.cwd || other.cwd, model: s.model || other.model,
        parentId: s.parentId || other.parentId, subagent: s.subagent || other.subagent } : s;
    });
    return merged.concat([...remote.values()]);
  }

  health() {
    return {
      logs: { mode: 'local-files', live: false, available: this.lastScan > 0, lastScanAt: this.lastScan || null,
        sessions: this.trackers.size + this.external.length, unreadableFiles: this.failed.size,
        discoveryIntervalMs: 5000, freshnessMs: 120000 },
      magpie: this.magpies.map((m, index) => ({ index, mode: 'request-feed', available: !!m.lastPolledAt && !m.error,
        lastPolledAt: m.lastPolledAt || null, reason: m.error || null })),
    };
  }

  connections({ privacy = false } = {}) {
    const databases = external.candidates(home, process.env);
    const definitions = [
      ['claude', 'Claude Code', [CLAUDE_DIR], 'Run Claude Code locally. Set CLAUDE_CONFIG_DIR before starting Bureau for a custom configuration directory.', 'https://code.claude.com/docs/en/how-claude-code-works'],
      ['codex', 'Codex CLI & Desktop', [CODEX_DIR], 'Run a local Codex chat. Set CODEX_HOME before starting Bureau for another local session directory. Cloud-only chats are not local session logs.', 'https://github.com/openai/codex'],
      ['gemini', 'Gemini CLI', GEMINI_HOMES.map(r => path.join(r, 'tmp')), 'Run Gemini CLI locally. Set GEMINI_CLI_HOME before starting Bureau for a custom home (the CLI appends .gemini).', 'https://github.com/google-gemini/gemini-cli'],
      ...ANTIGRAVITY_ROOTS.map(r => [r.id, `Antigravity ${r.id.endsWith('cli') ? 'CLI' : r.id.endsWith('ide') ? 'IDE' : 'App'}`, [path.join(r.home, 'brain')], 'Open a local Antigravity conversation. Requires readable .system_generated/logs/transcript.jsonl logs; older encrypted/binary stores are not supported. Custom roots: ANTIGRAVITY_HOME, ANTIGRAVITY_APP_HOME, ANTIGRAVITY_IDE_HOME.', 'https://antigravity.google/docs/hooks']),
      ['copilot', 'GitHub Copilot CLI', [COPILOT_DIR], 'Run GitHub Copilot CLI locally. Browser and editor chats without local events.jsonl files are not supported.', 'https://github.com/github/copilot-cli'],
      ['hermes', 'Hermes Agent', databases.hermes, 'Run Hermes Agent locally. Set HERMES_HOME before starting Bureau for an isolated profile; default named profiles are discovered automatically. Requires Node.js 22.13 or newer with node:sqlite.', 'https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/session-storage.md'],
      ['opencode', 'OpenCode', databases.opencode, 'Run OpenCode locally. Set OPENCODE_DB before starting Bureau for a custom SQLite database. Requires Node.js 22.13 or newer with node:sqlite.', 'https://github.com/anomalyco/opencode'],
      ['omp', 'Oh My Pi', ompDirs(this.ompDir, process.env, home).map(r => r.dir), 'Run Oh My Pi locally. Custom session root: WMAD_OMP_SESSIONS_DIR. Named OMP profiles are discovered automatically.', null],
      ['pi', 'Pi', piDirs(process.env, home).map(r => r.dir), 'Run Pi locally. Custom session root: PI_CODING_AGENT_SESSION_DIR or PI_CODING_AGENT_DIR.', 'https://github.com/badlogic/pi-mono'],
      ['kimi', 'Kimi Code', [CLIENT_DIRS.kimi], 'Run Kimi Code locally. Set KIMI_CODE_HOME before starting Bureau for a custom home.', 'https://github.com/MoonshotAI/kimi-cli'],
      ['dsh', 'DeepSeek Harness', [CLIENT_DIRS.dsh], 'Run DeepSeek Harness locally. Set DSH_HOME before starting Bureau for a custom home. Compressed logs need native multi-frame zstd support or the zstd executable. A DeepSeek model used in another client appears under that client.', 'https://github.com/deepseek-ai/deepseek-harness'],
      ['grok', 'Grok Build', [CLIENT_DIRS.grok], 'Run Grok Build locally. Set GROK_HOME before starting Bureau for a custom home.', null],
    ];
    const sessions = this.sessions();
    const providers = definitions.map(([id, name, roots, instructions, docsUrl]) => {
      const agent = id.startsWith('antigravity-') ? 'antigravity' : id;
      const rows = sessions.filter(s => s.agent === agent && (!s.connectionId || s.connectionId === id));
      const paths = [...new Set(roots)].map(file => {
        const st = statSafe(file);
        let readable = false;
        try { fs.accessSync(file, fs.constants.R_OK | (st?.isDirectory() ? fs.constants.X_OK : 0)); readable = true; } catch {}
        return { path: file, exists: !!st, readable };
      });
      const dbHealth = (this.databaseHealth || []).filter(d => d.agent === agent);
      const database = ['hermes', 'opencode'].includes(agent);
      const detected = paths.some(p => p.exists);
      const readable = database ? dbHealth.some(d => d.readable) : paths.some(p => p.readable);
      const failed = [...this.failed.keys()].some(file => roots.some(root => file.startsWith(root + path.sep)));
      const databaseFailure = dbHealth.find(d => d.detected && !d.readable);
      const status = !detected ? 'missing' : !readable || failed || databaseFailure ? 'unreadable' : rows.length ? 'connected' : 'ready';
      const reason = !detected ? 'No local session source found.'
        : failed ? 'Some session logs could not be decoded or read. Retrying automatically.'
        : databaseFailure ? databaseFailure.reason
        : database && !readable ? 'The database has not been checked yet.'
        : !readable ? 'The session source exists but cannot be read. Check directory permissions.'
        : rows.length ? 'Local sessions found. Recorded evidence does not prove a process is live.'
        : 'Source is readable. No sessions found in the selected time window; unsupported log formats are not inferred.';
      return { id, agent, name, supported: true, status, detected, readable, paths: privacy ? [] : paths,
        sessions: rows.length, lastEventAt: rows.reduce((at, s) => Math.max(at || 0, s.lastEventAt || 0), 0) || null,
        source: database ? 'database' : 'session-log', live: false, reason, instructions, docsUrl };
    });
    return { checkedAt: Date.now(), discoveryIntervalMs: 5000, live: false, providers };
  }
}

module.exports = { Watcher, CLAUDE_DIR, CODEX_DIR, GEMINI_DIR, CLIENT_DIRS, ompDirs, ANTIGRAVITY_DIR };
