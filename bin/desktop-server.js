'use strict';
process.env.WMAD_NO_UPDATE_CHECK = '1';
process.env.WMAD_LOCAL_VARIANT = '1';
const { Watcher } = require('../src/watcher');
const { DemoWatcher } = require('../src/demo');
const { createServer } = require('../src/server');
const demo = process.env.BUREAU_DEMO === '1';
const watcher = demo ? new DemoWatcher() : new Watcher();
const server = createServer(watcher, { privacy: process.env.BUREAU_PRIVATE === '1', demo, dotSnapshot: !demo });
watcher.start();
const requested = process.env.BUREAU_PORT === undefined ? 4547 : Number(process.env.BUREAU_PORT);
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && requested !== 0) server.listen(0, '127.0.0.1');
  else { console.error(error.message); watcher.stop(); process.exit(1); }
});
server.on('listening', () => console.log(JSON.stringify({ port: server.address().port })));
server.listen(Number.isInteger(requested) && requested >= 0 && requested <= 65535 ? requested : 4547, '127.0.0.1');
const stop = () => { watcher.stop(); server.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
