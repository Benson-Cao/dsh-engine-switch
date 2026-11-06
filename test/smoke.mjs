import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGateway } from '../src/gateway.js';

const UPSTREAM_PORT = 39081;
const GATEWAY_PORT = 39082;
const GATEWAY_PORT_AUTH = 39083;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-engine-switch-'));
const upstreamUrl = `http://127.0.0.1:${UPSTREAM_PORT}`;
const gwUrl = `http://127.0.0.1:${GATEWAY_PORT}`;

const upstream = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<html><body><h1>UPSTREAM OK</h1></body></html>');
  }
  if (req.url === '/api/ping') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ from: 'upstream', host: req.headers.host }));
  }
  if (req.url === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: one\n\n');
    setTimeout(() => { res.write('data: two\n\n'); res.end(); }, 40);
    return;
  }
  res.writeHead(404); res.end('not found');
});

function makeGateway(port, token = '') {
  return createGateway({
    host: '127.0.0.1',
    port,
    selfUrl: upstreamUrl,
    token,
    allowSelfSigned: true,
    dataDir: path.join(tmp, 'gw-' + port),
  });
}

async function main() {
  await new Promise(r => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));
  const gw = makeGateway(GATEWAY_PORT);
  const authed = makeGateway(GATEWAY_PORT_AUTH, 's3cret');
  await gw.listen();
  await authed.listen();

  try {
    // 1. picker page
    let r = await fetch(`${gwUrl}/__switch/`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /DSH 引擎切换/);
    console.log('  ok  /__switch/ serves the picker');

    // 2. registry seeded with one local engine
    r = await fetch(`${gwUrl}/api/engines`);
    let j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.engines.length, 1);
    assert.equal(j.engines[0].local, true);
    console.log('  ok  registry seeded with local engine');

    // 3. add + switch
    r = await fetch(`${gwUrl}/api/engines`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '书房', url: 'http://192.168.1.10:3080', kind: 'pc' }),
    });
    j = await r.json();
    assert.equal(j.ok, true);
    const pcId = j.engine.id;

    r = await fetch(`${gwUrl}/api/engines/switch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pcId }),
    });
    assert.equal((await r.json()).ok, true);
    r = await fetch(`${gwUrl}/api/engines`);
    j = await r.json();
    assert.equal(j.currentId, pcId);
    assert.equal(j.upstream, 'http://192.168.1.10:3080');
    console.log('  ok  add + switch updates upstream live');

    // switch back so proxy assertions hit the mock
    await fetch(`${gwUrl}/api/engines/switch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'local' }),
    });

    // 4. HTML proxy + floating button injection + Host rewrite
    r = await fetch(`${gwUrl}/`);
    let body = await r.text();
    assert.match(body, /UPSTREAM OK/);
    assert.match(body, /__switch\//);
    console.log('  ok  "/" proxies HTML with picker button injected');

    r = await fetch(`${gwUrl}/api/ping`);
    j = await r.json();
    assert.equal(j.from, 'upstream');
    assert.equal(j.host, new URL(upstreamUrl).host);
    console.log('  ok  Host header rewritten to upstream');

    // 5. streaming response must not be buffered into a single chunk
    r = await fetch(`${gwUrl}/stream`);
    body = await r.text();
    assert.match(body, /data: one/);
    assert.match(body, /data: two/);
    console.log('  ok  streaming / SSE response passes through');

    // 6. token gate
    r = await fetch(`http://127.0.0.1:${GATEWAY_PORT_AUTH}/api/engines`);
    assert.equal(r.status, 401);
    r = await fetch(`http://127.0.0.1:${GATEWAY_PORT_AUTH}/api/engines?token=s3cret`);
    assert.equal(r.status, 200);
    console.log('  ok  token gate rejects anonymous requests');

    // 7. remove + last-engine guard
    r = await fetch(`${gwUrl}/api/engines/${pcId}`, { method: 'DELETE' });
    assert.equal((await r.json()).ok, true);
    r = await fetch(`${gwUrl}/api/engines/local`, { method: 'DELETE' });
    assert.equal((await r.json()).ok, false);
    console.log('  ok  remove works and keeps the last engine');

    console.log('\nALL SMOKE TESTS PASSED');
  } finally {
    await gw.close();
    await authed.close();
    await new Promise(r => upstream.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
