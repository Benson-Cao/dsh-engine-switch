import os from 'node:os';
import path from 'node:path';
import { createGateway } from './src/gateway.js';

/** Stable row id — must match the `id` in cordis.patch.yml. */
export const name = 'dsh-engine-switch';

/**
 * DSH may mount the same bundle twice when patch layers stack (observed on
 * 0.2.1-rc.5). Guard at module scope so the second apply() is a no-op rather
 * than a second listener that crashes the host with EADDRINUSE.
 */
const INSTANCE_KEY = Symbol.for('dsh-engine-switch.instance');

/**
 * Cordis entry. Everything this plugin owns (http listener, sockets, timers)
 * is released through one ctx.effect disposer so unload is clean and ordered.
 *
 * No `inject` is declared: the gateway uses only Node built-ins and does not
 * reach into DSH services. That keeps it installable on web / desktop / headless
 * profiles without coupling to a specific host version.
 */
export function apply(ctx, config = {}) {
  if (globalThis[INSTANCE_KEY]) {
    console.log('[dsh-engine-switch] duplicate mount in this process, skipped');
    return;
  }
  const host = String(config.host || '127.0.0.1');
  const token = String(config.token || '');
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';

  // Fail loud: a non-loopback listener proxies a full agent, so it must be gated.
  if (!loopback && !token) {
    throw new Error('[dsh-engine-switch] host is not loopback: you must set config.token');
  }

  const settings = {
    host,
    port: Number(config.port || 3082),
    selfUrl: String(config.selfUrl || 'http://127.0.0.1:3080'),
    token,
    allowSelfSigned: config.allowSelfSigned !== false,
    dataDir: path.join(
      String(config.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')),
      'engine-switch',
    ),
  };

  const gateway = createGateway(settings);
  globalThis[INSTANCE_KEY] = gateway;

  gateway.listen().then(addr => {
    if (addr) console.log(`[dsh-engine-switch] ready on http://${host}:${addr.port}/`);
  }).catch(e => {
    console.warn('[dsh-engine-switch] listen rejected: ' + e.message);
  });

  ctx.effect(() => {
    // One disposer owns both the listener and every live socket, so close()
    // can await them in the right order.
    return () => {
      if (globalThis[INSTANCE_KEY] === gateway) delete globalThis[INSTANCE_KEY];
      return gateway.close();
    };
  });
}
