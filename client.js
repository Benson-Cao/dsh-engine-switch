/**
 * Browser half of dsh-engine-switch.
 *
 * The gateway (Host half) stays a plain HTTP listener; this module only adds the
 * in-app entry: a left-sidebar row "引擎" plus the panel it opens in the main
 * area. Nothing here navigates the page — switching engines changes what the
 * gateway forwards to, so the current conversation is never replaced by a
 * separate web page.
 *
 * Loaded through the DSH client module table: the factory registers exports and
 * every side effect (style tag, slots, locale) is owned by ctx.effect, so
 * disabling the plugin removes the row and the panel again.
 */
window.__ModuleLoader__.load({
  id: 'dsh-engine-switch',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const NS = 'engineSwitch';
    const PANEL_ID = 'engine-switch';
    /** Default gateway listener; must match `port` in cordis.patch.yml. */
    const DEFAULT_BASE = 'http://127.0.0.1:3082';

    const zh = {
      panel: '引擎',
      title: '引擎切换',
      intro: '一个入口，在本机 / 电脑 / 服务器引擎之间切换',
      refresh: '刷新',
      probe: '探测可达性',
      probing: '探测中…',
      current: '当前',
      kindLocal: '本机',
      kindPc: '电脑',
      kindServer: '服务器',
      switch: '切换',
      switching: '切换中…',
      remove: '删除',
      engines: '已登记引擎',
      empty: '还没有登记引擎',
      addEngine: '添加引擎',
      labelPlaceholder: '名称，如 书房 5060Ti / 腾讯云 dsh',
      urlPlaceholder: 'http://192.168.1.10:3080 或 https://dsh.example.com',
      add: '添加',
      adding: '添加中…',
      upstream: '当前转发到',
      gateway: '网关',
      back: '返回会话',
      tip: '切换只改变请求转发目标，不迁移会话：每个引擎有自己的 $DSH_HOME 与会话日志，跨引擎历史需另配 NAS 同步。上游自签 HTTPS 默认放行，请只登记你信任的主机。',
      loadFailed: '读取引擎列表失败',
      gatewayUnreachable: '连不上引擎网关，请确认插件已随 DSH 启动',
      switched: '已切换引擎',
      alreadyCurrent: '已经是当前引擎',
      added: '已添加',
      removed: '已删除',
      switchFailed: '切换失败',
      addFailed: '添加失败',
      removeFailed: '删除失败',
      probeFailed: '探测失败',
      probeDone: '探测完成',
    };

    const en = {
      panel: 'Engines',
      title: 'Engine switch',
      intro: 'One entry point across local, desktop and server engines',
      refresh: 'Refresh',
      probe: 'Check reachability',
      probing: 'Checking…',
      current: 'Current',
      kindLocal: 'Local',
      kindPc: 'Desktop',
      kindServer: 'Server',
      switch: 'Switch',
      switching: 'Switching…',
      remove: 'Remove',
      engines: 'Registered engines',
      empty: 'No engine registered yet',
      addEngine: 'Add an engine',
      labelPlaceholder: 'Name, e.g. Study 5060Ti / Tencent Cloud dsh',
      urlPlaceholder: 'http://192.168.1.10:3080 or https://dsh.example.com',
      add: 'Add',
      adding: 'Adding…',
      upstream: 'Currently forwarding to',
      gateway: 'Gateway',
      back: 'Back to chat',
      tip: 'Switching only changes the forwarding target; sessions are not migrated. Each engine keeps its own $DSH_HOME and session log, so cross-engine history needs NAS sync. Self-signed upstreams are allowed by default — register only hosts you trust.',
      loadFailed: 'Could not load the engine list',
      gatewayUnreachable: 'Engine gateway unreachable — check that the plugin started with DSH',
      switched: 'Engine switched',
      alreadyCurrent: 'Already the current engine',
      added: 'Added',
      removed: 'Removed',
      switchFailed: 'Switch failed',
      addFailed: 'Add failed',
      removeFailed: 'Remove failed',
      probeFailed: 'Check failed',
      probeDone: 'Check finished',
    };

    /* ------------------------------------------------------------------ */
    /* Gateway API                                                        */
    /* ------------------------------------------------------------------ */

    let base = null;

    function candidates() {
      const out = [];
      const override = typeof window === 'undefined' ? undefined : window.__DSH_ENGINE_SWITCH__;
      if (typeof override === 'string' && override.trim()) out.push(override.trim().replace(/\/+$/, ''));
      // Served by the gateway itself (phone browser, or a WebView pointed at it).
      if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
        const origin = location.origin;
        if (out.indexOf(origin) === -1) out.push(origin);
      }
      if (out.indexOf(DEFAULT_BASE) === -1) out.push(DEFAULT_BASE);
      return out;
    }

    async function resolveBase() {
      if (base) return base;
      const tried = [];
      for (const candidate of candidates()) {
        tried.push(candidate);
        try {
          const r = await fetch(candidate + '/api/engines', {
            cache: 'no-store',
            headers: { accept: 'application/json' },
          });
          if (!r.ok) continue;
          const j = await r.json();
          if (j && j.ok) {
            base = candidate;
            return base;
          }
        } catch (e) { /* try the next candidate */ }
      }
      throw new Error(tried.join(' · '));
    }

    async function api(path, init) {
      const root = await resolveBase();
      const r = await fetch(root + path, Object.assign({
        cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
      }, init));
      return r.json();
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                             */
    /* ------------------------------------------------------------------ */

    const CSS = `
.dshes_page{box-sizing:border-box;height:100%;overflow:auto;display:flex;flex-direction:column;align-items:center;
  padding:0 clamp(24px,4vw,48px) 40px;color:var(--dsw-alias-label-primary);
  font-family:inherit;font-size:13px;line-height:1.55}
.dshes_page>*{flex:none;width:100%;max-width:960px}
.dshes_head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.dshes_heading{min-width:0}
.dshes_title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dshes_intro{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dshes_toolbar{display:flex;align-items:center;gap:8px;white-space:nowrap}
.dshes_btn{height:32px;padding:0 12px;border-radius:8px;font:inherit;font-size:13px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary)}
.dshes_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshes_btn:disabled{opacity:.55;cursor:default}
.dshes_btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dshes_btn.is_primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;
  color:var(--dsw-alias-label-primary-inverted)}
.dshes_btn.is_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshes_btn.is_danger{color:var(--dsw-alias-state-error-primary);border-color:transparent;background:transparent}
.dshes_btn.is_danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dshes_meta{margin:14px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary);
  display:flex;flex-wrap:wrap;gap:4px 14px}
.dshes_meta code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  color:var(--dsw-alias-label-secondary)}
.dshes_alert{margin-top:14px;padding:10px 12px;border-radius:9px;font-size:12.5px;
  border:1px solid var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary);
  background:var(--dsw-alias-bg-layer-1);word-break:break-all}
.dshes_toast{margin-top:12px;font-size:12.5px;color:var(--dsw-alias-state-success-primary);min-height:18px}
.dshes_toast.is_bad{color:var(--dsw-alias-state-error-primary)}
.dshes_card{margin-top:20px;padding:16px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.dshes_cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.dshes_cardTitle{margin:0;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dshes_row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;
  padding:10px 12px;margin-bottom:8px;border-radius:9px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit}
.dshes_row:last-of-type{margin-bottom:0}
.dshes_row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshes_row.is_current{border-color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-interactive-bg-hover-accent);cursor:default}
.dshes_dot{flex:none;width:8px;height:8px;border-radius:50%;border:1px solid var(--dsw-alias-label-tertiary)}
.dshes_row.is_current .dshes_dot{border-color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-state-business-primary)}
.dshes_rowMain{flex:1;min-width:0}
.dshes_rowTop{display:flex;align-items:center;gap:6px;min-width:0}
.dshes_label{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshes_tag{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:4px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
.dshes_tag.is_current{color:var(--dsw-alias-state-business-primary)}
.dshes_url{margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);
  word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dshes_probe{margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dshes_probe.is_bad{color:var(--dsw-alias-state-warn-primary)}
.dshes_rowActions{flex:none;display:flex;align-items:center;gap:6px}
.dshes_form{display:flex;flex-wrap:wrap;gap:8px}
.dshes_field{display:flex;flex-direction:column;gap:4px;flex:1 1 180px;min-width:0}
.dshes_input,.dshes_select{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border-radius:8px;
  font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dshes_input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshes_input:focus-visible,.dshes_select:focus-visible{
  outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dshes_formAction{display:flex;align-items:flex-end}
.dshes_empty{padding:14px 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
.dshes_tip{margin:16px 0 0;font-size:11.5px;line-height:1.75;color:var(--dsw-alias-label-tertiary)}
@media (max-width:767px){.dshes_head{flex-direction:column}.dshes_toolbar{width:100%}}
`;

    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const id = 'dsh-engine-switch/panel.css';
      if (document.querySelector('style[data-plugin-css="' + id + '"]')) return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-engine-switch';
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        if (tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    /* ------------------------------------------------------------------ */
    /* Components                                                         */
    /* ------------------------------------------------------------------ */

    const IconEngine = React.memo(function IconEngine({ size }) {
      const s = size || 16;
      return h('svg', {
        width: s, height: s, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M2 5.2h8.4' }),
      h('path', { d: 'M8.2 3l2.2 2.2-2.2 2.2' }),
      h('path', { d: 'M14 10.8H5.6' }),
      h('path', { d: 'M7.8 13l-2.2-2.2 2.2-2.2' }));
    });

    let boundT = (key) => key;

    function kindLabel(t, engine) {
      if (engine && engine.local) return t('kindLocal');
      return engine && engine.kind === 'server' ? t('kindServer') : t('kindPc');
    }

    function EnginePanel(props) {
      const t = props && typeof props.t === 'function' ? props.t : boundT;
      const onBack = props && typeof props.onBack === 'function' ? props.onBack : null;

      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [toast, setToast] = React.useState({ text: '', bad: false });
      const [busy, setBusy] = React.useState('');
      const [probes, setProbes] = React.useState({});
      const [form, setForm] = React.useState({ label: '', url: '', kind: 'pc' });
      const [gateway, setGateway] = React.useState('');

      const say = React.useCallback((text, bad) => setToast({ text: text || '', bad: !!bad }), []);

      const load = React.useCallback(async () => {
        try {
          const j = await api('/api/engines');
          if (!j || !j.ok) throw new Error(j && j.error ? j.error : 'bad response');
          setData(j);
          setGateway(base || '');
          setError('');
        } catch (e) {
          setError(t('gatewayUnreachable') + (e && e.message ? '：' + e.message : ''));
        }
      }, [t]);

      React.useEffect(() => { load(); }, [load]);

      const switchTo = async (engine) => {
        if (!engine || busy) return;
        if (data && engine.id === data.currentId) { say(t('alreadyCurrent')); return; }
        setBusy(engine.id);
        try {
          const j = await api('/api/engines/switch', {
            method: 'POST',
            body: JSON.stringify({ id: engine.id }),
          });
          if (!j.ok) { say(j.error || t('switchFailed'), true); return; }
          say(t('switched') + '：' + engine.label);
          await load();
        } catch (e) {
          say(t('switchFailed') + '：' + e.message, true);
        } finally {
          setBusy('');
        }
      };

      const addEngine = async () => {
        if (busy) return;
        const label = form.label.trim();
        const url = form.url.trim();
        if (!url) return;
        setBusy('__add');
        try {
          const j = await api('/api/engines', {
            method: 'POST',
            body: JSON.stringify({ label, url, kind: form.kind }),
          });
          if (!j.ok) { say(j.error || t('addFailed'), true); return; }
          setForm({ label: '', url: '', kind: form.kind });
          say(t('added'));
          await load();
        } catch (e) {
          say(t('addFailed') + '：' + e.message, true);
        } finally {
          setBusy('');
        }
      };

      const removeEngine = async (engine) => {
        if (!engine || busy) return;
        setBusy(engine.id);
        try {
          const j = await api('/api/engines/' + encodeURIComponent(engine.id), { method: 'DELETE' });
          if (!j.ok) { say(j.error || t('removeFailed'), true); return; }
          say(t('removed'));
          await load();
        } catch (e) {
          say(t('removeFailed') + '：' + e.message, true);
        } finally {
          setBusy('');
        }
      };

      const probeAll = async () => {
        if (busy) return;
        setBusy('__probe');
        try {
          const j = await api('/api/engines/probe');
          if (!j.ok) { say(t('probeFailed'), true); return; }
          const next = {};
          for (const r of j.results || []) next[r.id] = r.state;
          setProbes(next);
          say(t('probeDone'));
        } catch (e) {
          say(t('probeFailed') + '：' + e.message, true);
        } finally {
          setBusy('');
        }
      };

      const engines = (data && data.engines) || [];

      return h('div', { className: 'dshes_page' },
        h('div', { className: 'dshes_head' },
          h('div', { className: 'dshes_heading' },
            h('h1', { className: 'dshes_title' }, t('title')),
            h('p', { className: 'dshes_intro' }, t('intro'))),
          h('div', { className: 'dshes_toolbar' },
            onBack ? h('button', {
              type: 'button', className: 'dshes_btn', onClick: onBack,
            }, t('back')) : null,
            h('button', {
              type: 'button', className: 'dshes_btn',
              disabled: busy === '__probe' || !data,
              onClick: probeAll,
            }, busy === '__probe' ? t('probing') : t('probe')),
            h('button', {
              type: 'button', className: 'dshes_btn', disabled: !!busy || !data, onClick: load,
            }, t('refresh')))),

        h('div', { className: 'dshes_meta' },
          h('span', null, t('upstream') + ' ',
            h('code', null, (data && data.upstream) || '—')),
          h('span', null, t('gateway') + ' ', h('code', null, gateway || DEFAULT_BASE))),

        error ? h('div', { className: 'dshes_alert' }, error) : null,
        toast.text ? h('div', {
          className: 'dshes_toast' + (toast.bad ? ' is_bad' : ''),
        }, toast.text) : null,

        h('section', { className: 'dshes_card' },
          h('div', { className: 'dshes_cardHead' },
            h('h2', { className: 'dshes_cardTitle' }, t('engines'))),
          engines.length === 0
            ? h('div', { className: 'dshes_empty' }, data ? t('empty') : '…')
            : engines.map(engine => {
              const current = !!data && engine.id === data.currentId;
              const state = probes[engine.id];
              const working = busy === engine.id;
              return h('div', {
                key: engine.id,
                className: 'dshes_row' + (current ? ' is_current' : ''),
                role: 'button',
                tabIndex: 0,
                onClick: () => switchTo(engine),
                onKeyDown: (ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); switchTo(engine); }
                },
              },
              h('span', { className: 'dshes_dot' }),
              h('div', { className: 'dshes_rowMain' },
                h('div', { className: 'dshes_rowTop' },
                  h('span', { className: 'dshes_label' }, engine.label),
                  h('span', { className: 'dshes_tag' }, kindLabel(t, engine)),
                  current ? h('span', { className: 'dshes_tag is_current' }, t('current')) : null),
                h('div', { className: 'dshes_url' }, engine.url),
                state ? h('div', {
                  className: 'dshes_probe' + (/unreachable|failed|401|403|404|5\d\d/i.test(state) ? ' is_bad' : ''),
                }, state) : null),
              h('div', { className: 'dshes_rowActions' },
                current ? null : h('button', {
                  type: 'button',
                  className: 'dshes_btn is_primary',
                  disabled: working || !!busy,
                  onClick: (ev) => { ev.stopPropagation(); switchTo(engine); },
                }, working ? t('switching') : t('switch')),
                engine.local ? null : h('button', {
                  type: 'button',
                  className: 'dshes_btn is_danger',
                  disabled: !!busy,
                  onClick: (ev) => { ev.stopPropagation(); removeEngine(engine); },
                }, t('remove'))));
            })),

        h('section', { className: 'dshes_card' },
          h('div', { className: 'dshes_cardHead' },
            h('h2', { className: 'dshes_cardTitle' }, t('addEngine'))),
          h('div', { className: 'dshes_form' },
            h('label', { className: 'dshes_field' },
              h('input', {
                className: 'dshes_input', value: form.label, placeholder: t('labelPlaceholder'),
                autoComplete: 'off',
                onChange: (ev) => setForm(Object.assign({}, form, { label: ev.target.value })),
              })),
            h('label', { className: 'dshes_field' },
              h('input', {
                className: 'dshes_input', value: form.url, placeholder: t('urlPlaceholder'),
                autoComplete: 'off', inputMode: 'url',
                onChange: (ev) => setForm(Object.assign({}, form, { url: ev.target.value })),
                onKeyDown: (ev) => { if (ev.key === 'Enter') addEngine(); },
              })),
            h('label', { className: 'dshes_field', style: { flex: '0 0 120px' } },
              h('select', {
                className: 'dshes_select', value: form.kind,
                onChange: (ev) => setForm(Object.assign({}, form, { kind: ev.target.value })),
              },
              h('option', { value: 'pc' }, t('kindPc')),
              h('option', { value: 'server' }, t('kindServer')))),
            h('div', { className: 'dshes_formAction' },
              h('button', {
                type: 'button',
                className: 'dshes_btn is_primary',
                disabled: busy === '__add' || !form.url.trim() || !data,
                onClick: addEngine,
              }, busy === '__add' ? t('adding') : t('add'))))),

        h('p', { className: 'dshes_tip' }, t('tip')));
    }

    /* ------------------------------------------------------------------ */
    /* Plugin                                                             */
    /* ------------------------------------------------------------------ */

    const inject = ['slots', 'locale', 'layout'];

    function apply(ctx) {
      ctx.effect(() => installStyles());

      ctx.effect(() => ctx.locale.register(NS, { zh, en }));
      try {
        boundT = ctx.locale.bind(NS);
      } catch (e) { /* keep the identity lookup */ }

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 12,
        locale: NS,
        label: () => boundT('panel'),
      }, IconEngine));

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({
          // The layout service owns panel selection; null returns to the conversation.
          onBack: () => ctx.layout.selectPanel(null),
        }),
      }, EnginePanel));
    }

    return { inject, apply };
  },
});
