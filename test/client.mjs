import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/**
 * Runs the browser half outside a browser: the module loader, React, the slot
 * registry and the locale service are all stubbed. It catches the failures that
 * a Host-side test cannot see — a factory that throws, a malformed registration,
 * or a panel component that crashes on its first render.
 */

const STYLE = [];

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      assert.equal(id, 'dsh-engine-switch', 'module id must equal the package name');
      globalThis.__loaded = factory(makeRequire());
    },
  },
};

function makeRequire() {
  return (specifier) => {
    if (specifier === 'react') return React;
    throw new Error('unexpected external: ' + specifier);
  };
}

/** Minimal React: enough hooks for one function-component render. */
const React = {
  memo: (fn) => fn,
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
  useEffect() {},
  useCallback(fn) { return fn; },
  createElement(type, props, ...children) {
    return { type, props: Object.assign({}, props, { children: children.flat() }) };
  },
};

globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, set textContent(v) { STYLE.push(v); } }),
  head: { appendChild() {} },
};

await import(pathToFileURL(path.resolve('client.js')).href);

const client = globalThis.__loaded;
assert.ok(client, 'factory must return the plugin exports');
assert.deepEqual([...client.inject].sort(), ['layout', 'locale', 'slots']);
assert.equal(typeof client.apply, 'function');

const registrations = [];
const localeDictionaries = {};
const panelSelections = [];

const ctx = {
  effect(fn) {
    const dispose = fn();
    assert.equal(typeof dispose, 'function', 'every effect must return a disposer');
    return dispose;
  },
  locale: {
    register(ns, dict) {
      localeDictionaries[ns] = dict;
      return () => {};
    },
    bind(ns) {
      return (key) => {
        const dict = localeDictionaries[ns] || {};
        const table = dict.zh || dict.en || {};
        return table[key] || key;
      };
    },
  },
  slots: {
    inject(name, register) {
      assert.equal(typeof register, 'function');
      register();
    },
    register(definition, component) {
      registrations.push({ definition, component });
      return () => {};
    },
  },
  layout: { selectPanel: (id) => panelSelections.push(id) },
};

client.apply(ctx);

assert.ok(localeDictionaries.engineSwitch, 'locale dictionary registered');
assert.ok(localeDictionaries.engineSwitch.zh.panel, 'zh copy present');
assert.ok(localeDictionaries.engineSwitch.en.panel, 'en copy present');

const row = registrations.find(r => r.definition.name === 'sidebar.panellist');
assert.ok(row, 'sidebar.panellist entry registered');
assert.equal(row.definition.id, 'engine-switch');
assert.equal(row.definition.locale, 'engineSwitch');
assert.equal(typeof row.definition.label, 'function');
assert.equal(row.definition.label(), '引擎', 'row label comes from the locale table');

const page = registrations.find(r => r.definition.name === 'main');
assert.ok(page, 'main panel registered');
assert.equal(page.definition.key, 'engine-switch', 'panel key must match the sidebar id');

const props = Object.assign({ t: row.definition.label && ctx.locale.bind('engineSwitch') }, page.definition.inject());
assert.equal(typeof props.onBack, 'function');
props.onBack();
assert.deepEqual(panelSelections, [null], 'Back returns to the conversation, not a new page');

const tree = page.component(props);
assert.equal(tree.type, 'div');
assert.equal(tree.props.className, 'dshes_page');

const text = collectText(tree);
for (const expected of ['引擎切换', '已登记引擎', '添加引擎', '刷新']) {
  assert.ok(text.includes(expected), `panel renders "${expected}"`);
}
assert.ok(STYLE.length > 0, 'panel styles installed');
assert.ok(/--dsw-alias-label-primary/.test(STYLE[0]), 'styles use host theme tokens');

function collectText(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  const kids = node.props && node.props.children;
  return collectText(kids);
}

console.log('  ok  browser half registers a sidebar row and a panel page');
console.log('  ok  panel renders with host theme tokens');
console.log('\nCLIENT SMOKE TESTS PASSED');
