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

    // 3. the shared handler the Host mounts at /engine-switch/api answers the
    //    same route table (desktop shells can only reach same-origin paths)
    assert.equal(typeof gw.handleApi, 'function', 'gateway exports handleApi for the Host mount');
    const seen = await new Promise(resolve => {
      const res = {
        headersSent: false,
        status: 0,
        body: '',
        writeHead(code) { this.status = code; this.headersSent = true; return this; },
        setHeader() {},
        end(chunk) { this.body = chunk || ''; resolve({ status: this.status, body: this.body }); },
      };
      gw.handleApi({ method: 'GET', headers: {}, url: '/api/engines' }, res, new URL('http://x/api/engines'));
    });
    assert.equal(seen.status, 200);
    assert.equal(JSON.parse(seen.body).ok, true);
    console.log('  ok  handleApi serves the registry for the Host mount');

    // 4. add + switch
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

    // 5. HTML proxy stays byte-clean (no injected entry: the sidebar panel owns it)
    r = await fetch(`${gwUrl}/`);
    let body = await r.text();
    assert.match(body, /UPSTREAM OK/);
    assert.ok(!body.includes('__switch/'), 'proxy must not inject a picker button');
    assert.ok(!body.includes('<a href'), 'proxy must not inject markup');
    console.log('  ok  "/" proxies HTML untouched (no injected entry)');

    r = await fetch(`${gwUrl}/api/ping`);
    j = await r.json();
    assert.equal(j.from, 'upstream');
    assert.equal(j.host, new URL(upstreamUrl).host);
    console.log('  ok  Host header rewritten to upstream');

    // 6. streaming response must not be buffered into a single chunk
    r = await fetch(`${gwUrl}/stream`);
    body = await r.text();
    assert.match(body, /data: one/);
    assert.match(body, /data: two/);
    console.log('  ok  streaming / SSE response passes through');

    // 7. CORS: the in-app panel calls the API from the DSH page origin
    let opt = await fetch(`${gwUrl}/api/engines`, {
      method: 'OPTIONS',
      headers: { origin: 'dsh://host', 'access-control-request-method': 'POST' },
    });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('access-control-allow-origin'), 'dsh://host');
    opt = await fetch(`${gwUrl}/api/engines`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    assert.equal(opt.headers.get('access-control-allow-origin'), null);
    r = await fetch(`${gwUrl}/api/engines`, { headers: { origin: 'http://127.0.0.1:3080' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3080');
    console.log('  ok  CORS answers local shells only');

    // 8. token gate
    r = await fetch(`http://127.0.0.1:${GATEWAY_PORT_AUTH}/api/engines`);
    assert.equal(r.status, 401);
    r = await fetch(`http://127.0.0.1:${GATEWAY_PORT_AUTH}/api/engines?token=s3cret`);
    assert.equal(r.status, 200);
    console.log('  ok  token gate rejects anonymous requests');

    // 9. remove + last-engine guard
    r = await fetch(`${gwUrl}/api/engines/${pcId}`, { method: 'DELETE' });
    assert.equal((await r.json()).ok, true);
    r = await fetch(`${gwUrl}/api/engines/local`, { method: 'DELETE' });
    assert.equal((await r.json()).ok, false);
    console.log('  ok  remove works and keeps the last engine');

    // 10. A second listener on the same port must degrade, never crash the host.
    const dup = makeGateway(GATEWAY_PORT);
    const dupAddr = await dup.listen();
    assert.equal(dupAddr, null, 'duplicate listen should resolve null, not throw');
    await dup.close();
    console.log('  ok  duplicate mount degrades gracefully (no EADDRINUSE crash)');

    console.log('\nALL SMOKE TESTS PASSED');
  } finally {
    await gw.close();
    await authed.close();
    await new Promise(r => upstream.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
