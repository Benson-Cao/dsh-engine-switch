import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Engine registry persisted under $DSH_HOME/engine-switch/engines.json.
 * Writes are atomic (tmp + rename) because the switch UI and the gateway
 * can touch the file from different requests.
 */
export class EngineRegistry {
  constructor(dataDir, selfUrl) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'engines.json');
    this.selfUrl = String(selfUrl).replace(/\/+$/, '');
    fs.mkdirSync(this.dir, { recursive: true });
    this.state = this.#read();
  }

  #read() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(j.engines) && j.engines.length) {
        return { engines: j.engines, currentId: j.currentId || j.engines[0].id };
      }
    } catch (e) {
      // Missing or corrupt config: fall back to a single local engine.
    }
    const local = {
      id: 'local', label: '本机引擎', url: this.selfUrl, kind: 'local', local: true,
    };
    const state = { engines: [local], currentId: 'local' };
    this.#write(state);
    return state;
  }

  #write(state) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this.file);
  }

  list() { return this.state.engines.slice(); }

  current() {
    return this.state.engines.find(e => e.id === this.state.currentId)
      || this.state.engines[0];
  }

  upstream() {
    const e = this.current();
    return e.local ? this.selfUrl : e.url;
  }

  toJSON() {
    return {
      ok: true,
      engines: this.list(),
      currentId: this.state.currentId,
      upstream: this.upstream(),
    };
  }

  add({ label, url, kind = 'pc' }) {
    const clean = normalizeUrl(url);
    if (!clean) return { ok: false, error: 'invalid URL' };
    if (this.state.engines.some(e => e.url === clean)) {
      return { ok: false, error: 'engine already registered' };
    }
    const engine = {
      id: randomUUID().slice(0, 8),
      label: String(label || clean).trim() || clean,
      url: clean,
      kind: kind === 'server' ? 'server' : 'pc',
      local: false,
    };
    this.state.engines.push(engine);
    this.#write(this.state);
    return { ok: true, engine };
  }

  remove(id) {
    if (this.state.engines.length <= 1) {
      return { ok: false, error: 'at least one engine is required' };
    }
    const before = this.state.engines.length;
    this.state.engines = this.state.engines.filter(e => e.id !== id);
    if (this.state.engines.length === before) return { ok: false, error: 'unknown id' };
    if (this.state.currentId === id) this.state.currentId = this.state.engines[0].id;
    this.#write(this.state);
    return { ok: true };
  }

  select(id) {
    const e = this.state.engines.find(x => x.id === id);
    if (!e) return { ok: false, error: 'unknown id' };
    this.state.currentId = id;
    this.#write(this.state);
    return { ok: true, engine: e };
  }
}

export function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname) return null;
    return u.replace(/\/+$/, '');
  } catch (e) {
    return null;
  }
}
