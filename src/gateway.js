import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineRegistry } from './registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_PAGE = path.join(HERE, 'web', 'index.html');

/**
 * One listener does three jobs:
 *   1. serve the phone-friendly engine picker at /
 *   2. expose /api/engines/* as a small JSON API
 *   3. reverse-proxy everything else (HTTP, SSE, WebSocket) to the selected engine
 *
 * The browser always talks to a single origin, so DSH's own Host/Origin checks,
 * cookies and injected mobile UI keep working after a switch.
 */
export function createGateway(settings) {
  const registry = new EngineRegistry(settings.dataDir, settings.selfUrl);
  const localOrigin = `http://${settings.host}:${settings.port}`;
  const sockets = new Set();
  let server = null;

  function json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', c => {
        raw += c;
        if (raw.length > 64 * 1024) { reject(new Error('body too large')); req.destroy(); }
      });
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); }
        catch (e) { reject(new Error('invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function authorized(req) {
    if (!settings.token) return true;
    let q = '';
    try { q = new URL(req.url, localOrigin).searchParams.get('token') || ''; }
    catch (e) { /* keep empty */ }
    return q === settings.token || req.headers.authorization === `Bearer ${settings.token}`;
  }

  /**
   * The in-app panel lives on the DSH page origin (dsh://host on desktop,
   * http://127.0.0.1:3080 when served by `dsh web`) and calls the gateway
   * directly, so `/api/engines/*` needs CORS. Only local shells may do that:
   * echoing any site's origin would let a random page repoint the proxy at a
   * host of its choosing.
   */
  function corsOrigin(req) {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !origin) return '';
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin)) return origin;
    if (/^(dsh|app|file):\/\//i.test(origin)) return origin;
    return '';
  }

  function applyCors(req, res) {
    const origin = corsOrigin(req);
    if (!origin) return;
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers',
      req.headers['access-control-request-headers'] || 'content-type, authorization, accept');
    res.setHeader('access-control-max-age', '600');
    res.setHeader('vary', 'Origin');
  }

  async function probeAll() {
    const out = [];
    for (const e of registry.list()) {
      const url = e.local ? settings.selfUrl : e.url;
      let state = 'unreachable';
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
        state = `HTTP ${r.status}`;
      } catch (err) {
        // A TCP connect may still succeed when TLS validation rejects a private CA.
        try {
          const u = new URL(url);
          const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
          const ok = await new Promise(resolve => {
            const s = net.connect({ host: u.hostname, port }, () => { s.destroy(); resolve(true); });
            s.setTimeout(1500, () => { s.destroy(); resolve(false); });
            s.on('error', () => resolve(false));
          });
          if (ok) state = 'TCP ok / TLS or handshake failed';
        } catch (ignored) { /* leave unreachable */ }
      }
      out.push({ id: e.id, label: e.label, url, state });
    }
    return out;
  }

  async function handleApi(req, res, url) {
    const p = url.pathname;
    if (p === '/api/engines' && req.method === 'GET') return json(res, 200, registry.toJSON());
    if (p === '/api/engines' && req.method === 'POST') {
      return json(res, 200, registry.add(await readBody(req)));
    }
    if (p.startsWith('/api/engines/') && req.method === 'DELETE') {
      return json(res, 200, registry.remove(decodeURIComponent(p.slice('/api/engines/'.length))));
    }
    if (p === '/api/engines/switch' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, registry.select(body.id));
    }
    if (p === '/api/engines/probe' && req.method === 'GET') {
      return json(res, 200, { ok: true, results: await probeAll() });
    }
    return json(res, 404, { ok: false, error: 'unknown API route' });
  }

  function rewriteRequestHeaders(headers, upstream) {
    const h = Object.assign({}, headers);
    h.host = upstream.host;
    if (h.origin) h.origin = upstream.origin;
    if (h.referer) {
      try {
        const r = new URL(h.referer);
        h.referer = upstream.origin + r.pathname + r.search;
      } catch (e) { /* keep as-is */ }
    }
    return h;
  }

  function rewriteResponseHeaders(headers, upstream) {
    const h = Object.assign({}, headers);
    if (h['set-cookie']) {
      h['set-cookie'] = h['set-cookie'].map(c =>
        c.replace(/;\s*Domain=[^;]+/ig, '').replace(/;\s*Secure\b/ig, ''));
    }
    if (h.location && h.location.startsWith(upstream.origin)) {
      h.location = localOrigin + h.location.slice(upstream.origin.length);
    }
    delete h['content-security-policy'];
    return h;
  }

  function proxy(req, res) {
    let upstream;
    try { upstream = new URL(registry.upstream()); }
    catch (e) { return json(res, 502, { ok: false, error: 'bad upstream URL' }); }
    const mod = upstream.protocol === 'https:' ? https : http;
    const options = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: Number(upstream.port) || (upstream.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: rewriteRequestHeaders(req.headers, upstream),
      rejectUnauthorized: !settings.allowSelfSigned,
    };
    let target;
    try {
      target = mod.request(options, r => {
        let headers;
        try { headers = rewriteResponseHeaders(r.headers, upstream); }
        catch (e) {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
          res.end('header rewrite failed: ' + e.message);
          r.destroy();
          return;
        }
        res.writeHead(r.statusCode || 502, headers);
        // Zero-copy for every response: the proxy never needs to look at the
        // body, so HTML / SSE / chunked / binary all stream through untouched.
        r.pipe(res);
      });
    } catch (e) {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('engine-switch: ' + e.message);
      return;
    }
    target.on('error', e => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('engine-switch upstream: ' + e.message);
    });
    req.pipe(target);
  }

  // Raw TCP pipe after the HTTP upgrade handshake: WebSocket frames are not parsed.
  function onUpgrade(req, socket, head) {
    if (!authorized(req)) {
      try { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch (ignored) { }
      return;
    }
    let upstream;
    try { upstream = new URL(registry.upstream()); }
    catch (e) { socket.destroy(); return; }

    const tlsUpstream = upstream.protocol === 'https:';
    const port = Number(upstream.port) || (tlsUpstream ? 443 : 80);
    const connect = tlsUpstream ? tls : net;
    const options = tlsUpstream
      ? { host: upstream.hostname, port, servername: upstream.hostname, rejectUnauthorized: false }
      : { host: upstream.hostname, port };
    let target;
    try { target = connect.connect(options); }
    catch (e) { socket.destroy(); return; }

    target.on(tlsUpstream ? 'secureConnect' : 'connect', () => {
      const h = rewriteRequestHeaders(req.headers, upstream);
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(h)) {
        if (v === undefined) continue;
        raw += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
      }
      raw += '\r\n';
      target.write(raw);
      if (head && head.length) target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, localOrigin); }
    catch (e) { return json(res, 400, { ok: false, error: 'bad URL' }); }

    // The in-app panel calls these endpoints from the DSH page origin, and a
    // preflight carries no credentials, so CORS answers before the token gate.
    if (url.pathname.startsWith('/api/')) {
      applyCors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'content-length': 0 });
        return res.end();
      }
    }

    if (!authorized(req)) return json(res, 401, { ok: false, error: 'token required' });

    try {
      // "/" belongs to the DSH frontend (proxied). The picker lives on its own
      // path so switching never fights with the SPA's own root route.
      if (url.pathname === '/__switch' || url.pathname === '/__switch/' ||
          url.pathname === '/__switch/index.html') {
        const html = fs.readFileSync(WEB_PAGE);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      }
      if (url.pathname.startsWith('/api/engines')) return await handleApi(req, res, url);
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
    return proxy(req, res);
  }

  function listen() {
    server = http.createServer((req, res) => {
      handle(req, res).catch(e => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('engine-switch: ' + e.message);
      });
    });
    server.on('upgrade', onUpgrade);
    server.on('connection', s => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    server.on('clientError', (e, s) => {
      try { s.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (ignored) { }
    });
    return new Promise(resolve => {
      // A duplicate mount (or a leftover listener during a DSH restart) must
      // never become an unhandled rejection: on Node 24 that is fatal and takes
      // the whole DSH process down with it. Degrade to a no-op instead.
      server.on('error', e => {
        console.warn('[dsh-engine-switch] listen failed: ' + e.message);
        const s = server;
        server = null;
        try { if (s) s.close(); } catch (ignored) { }
        resolve(null);
      });
      server.listen(settings.port, settings.host, () => resolve(server.address()));
    });
  }

  /**
   * Single disposer owns the listener and all live sockets (ordered cleanup).
   */
  function close() {
    return new Promise(resolve => {
      if (!server) return resolve();
      const s = server;
      server = null;
      for (const sock of sockets) { try { sock.destroy(); } catch (ignored) { } }
      sockets.clear();
      if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
      s.close(() => resolve());
      setTimeout(resolve, 1500).unref();
    });
  }

  // Exposed so the Host half can mount the same API on DSH's own web server:
  // the desktop shell forwards only same-origin paths to the Host, so the
  // in-app panel can never reach this loopback listener directly.
  return { listen, close, registry, handleApi };
}
