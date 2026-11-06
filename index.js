import os from 'node:os';
import path from 'node:path';
import { createGateway } from './src/gateway.js';

/** Stable row id — must match the `id` in cordis.patch.yml. */
export const name = 'dsh-engine-switch';

/**
 * Cordis entry. Everything this plugin owns (http listener, sockets, timers)
 * is released through one ctx.effect disposer so unload is clean and ordered.
 *
 * No `inject` is declared: the gateway uses only Node built-ins and does not
 * reach into DSH services. That keeps it installable on web / desktop / headless
 * profiles without coupling to a specific host version.
 */
export function apply(ctx, config = {}) {
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
  gateway.listen();

  ctx.effect(() => {
    // One disposer owns both the listener and every live socket, so close()
    // can await them in the right order.
    return () => gateway.close();
  });

  console.log(`[dsh-engine-switch] ready on http://${host}:${settings.port}/`);
}
