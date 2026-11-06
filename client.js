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
      engines: '引擎状态',
      groupSub: '选中哪个，网关就转发到哪个；只换执行者，不迁移会话。',
      kindLabel: '类型',
      empty: '还没有登记引擎',
      addEngine: '添加引擎',
      nameLabel: '名称',
      urlLabel: '地址',
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
      engines: 'Engines',
      groupSub: 'Whichever you pick becomes the gateway upstream; sessions are not migrated.',
      kindLabel: 'Type',
      empty: 'No engine registered yet',
      addEngine: 'Add an engine',
      nameLabel: 'Name',
      urlLabel: 'Address',
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

    /**
     * Where the panel may read the registry, in priority order. The suffixes are
     * gateway-shaped ("/engines"), so each candidate only owns the prefix:
     *
     *   1. an explicit override, for a port other than the default
     *   2. the current origin — a page served *by* the gateway answers /api here
     *   3. /engine-switch/api — the Host-mounted copy, the only reachable path
     *      when the desktop shell forwards same-origin paths to the Host
     *   4. the default loopback listener, last resort for plain browsers
     */
    let endpoint = null;

    function candidates() {
      const out = [];
      const override = typeof window === 'undefined' ? undefined : window.__DSH_ENGINE_SWITCH__;
      if (typeof override === 'string' && override.trim()) {
        const root = override.trim().replace(/\/+$/, '');
        out.push({ display: root, build: (suffix) => root + '/api' + suffix });
      }
      out.push({ display: 'origin', build: (suffix) => '/api' + suffix });
      out.push({ display: '/engine-switch/api', build: (suffix) => '/engine-switch/api' + suffix });
      out.push({ display: DEFAULT_BASE, build: (suffix) => DEFAULT_BASE + '/api' + suffix });
      return out;
    }

    async function resolveEndpoint() {
      if (endpoint) return endpoint;
      const tried = [];
      for (const candidate of candidates()) {
        tried.push(candidate.display);
        try {
          const r = await fetch(candidate.build('/engines'), {
            cache: 'no-store',
            headers: { accept: 'application/json' },
          });
          if (!r.ok) continue;
          const j = await r.json();
          if (j && j.ok) {
            endpoint = candidate;
            return endpoint;
          }
        } catch (e) { /* try the next candidate */ }
      }
      throw new Error(tried.join(' · '));
    }

    async function api(suffix, init) {
      const target = await resolveEndpoint();
      const r = await fetch(target.build(suffix), Object.assign({
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
.dshes_page>*{flex:none;width:100%;max-width:820px}
.dshes_head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.dshes_heading{min-width:0}
.dshes_title{margin:0;font-size:20px;font-weight:600;line-height:28px}
.dshes_intro{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dshes_toolbar{display:flex;align-items:center;gap:8px;white-space:nowrap}
.dshes_btn{height:32px;padding:0 12px;border-radius:9px;font:inherit;font-size:13px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-secondary)}
.dshes_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary)}
.dshes_btn:disabled{opacity:.5;cursor:default}
.dshes_btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dshes_meta{margin:12px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary);
  display:flex;flex-wrap:wrap;gap:4px 14px}
.dshes_meta code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  color:var(--dsw-alias-label-secondary)}
.dshes_alert{margin-top:14px;padding:10px 14px;border-radius:12px;font-size:12.5px;
  border:1px solid var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary);
  background:var(--dsw-alias-bg-layer-1);word-break:break-all}
.dshes_toast{margin-top:10px;font-size:12.5px;color:var(--dsw-alias-state-success-primary);min-height:18px}
.dshes_toast.is_bad{color:var(--dsw-alias-state-error-primary)}

/* 分组标题 + 卡片列表：与手机端同一套视觉语言 */
.dshes_group{margin:26px 0 2px;font-size:15px;font-weight:600}
.dshes_groupSub{margin:0 0 12px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dshes_card{display:flex;align-items:center;gap:13px;box-sizing:border-box;width:100%;
  padding:12px 16px;margin:0 0 10px;border-radius:14px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);
  color:inherit;font:inherit;text-align:left}
.dshes_card:last-of-type{margin-bottom:0}
.dshes_card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshes_card.is_current{cursor:default;
  border-color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshes_card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dshes_icon{flex:none;display:flex;align-items:center;justify-content:center;width:26px;
  color:var(--dsw-alias-label-secondary)}
.dshes_card.is_current .dshes_icon{color:var(--dsw-alias-state-business-primary)}
.dshes_main{flex:1;min-width:0}
.dshes_label{display:block;font-size:15px;font-weight:500;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshes_sub{display:block;margin-top:2px;font-size:12.5px;color:var(--dsw-alias-label-tertiary);
  word-break:break-all}
.dshes_probe{display:block;margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dshes_probe.is_bad{color:var(--dsw-alias-state-warn-primary)}
.dshes_badge{flex:none;font-size:11px;padding:2px 8px;border-radius:6px;
  color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshes_actions{flex:none;display:flex;align-items:center;gap:4px}
.dshes_link{border:0;background:none;padding:6px 8px;border-radius:7px;font:inherit;
  font-size:13px;cursor:pointer;color:var(--dsw-alias-state-business-primary)}
.dshes_link:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshes_danger{color:var(--dsw-alias-state-error-primary)}
.dshes_danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}

/* 表单：卡片化字段 + 分段控件 */
.dshes_fieldCard{display:block;box-sizing:border-box;width:100%;padding:12px 16px;margin:0 0 10px;
  border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.dshes_fieldCard>span{display:block;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
.dshes_input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:0;border:0;
  background:none;font:inherit;font-size:15px;color:var(--dsw-alias-label-primary);outline:none}
.dshes_input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshes_fieldCard:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.dshes_sectionLabel{margin:16px 2px 10px;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.dshes_seg{display:flex;gap:10px;max-width:360px}
.dshes_segBtn{flex:1;height:40px;border-radius:12px;font:inherit;font-size:14px;cursor:pointer;
  border:1px solid transparent;background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-secondary)}
.dshes_segBtn[aria-pressed="true"]{
  border-color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-interactive-bg-hover-accent);
  color:var(--dsw-alias-label-primary)}
.dshes_segBtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dshes_primary{margin-top:18px;height:40px;padding:0 22px;border:0;border-radius:12px;font:inherit;
  font-size:14px;font-weight:500;cursor:pointer;color:var(--dsw-alias-label-primary-inverted);
  background:var(--dsw-alias-button-primary-fill)}
.dshes_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshes_primary:disabled{opacity:.5;cursor:default}
.dshes_note{margin:22px 0 0;font-size:12px;line-height:1.75;color:var(--dsw-alias-label-tertiary)}
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
          const j = await api('/engines');
          if (!j || !j.ok) throw new Error(j && j.error ? j.error : 'bad response');
          setData(j);
          setGateway(endpoint ? endpoint.display : '');
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
          const j = await api('/engines/switch', {
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
          const j = await api('/engines', {
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
          const j = await api('/engines/' + encodeURIComponent(engine.id), { method: 'DELETE' });
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
          const j = await api('/engines/probe');
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

      const kindIcon = (engine) => {
        const open = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
        if (engine.local) {
          return h('svg', open,
            h('rect', { x: 4, y: 3, width: 16, height: 12, rx: 2 }),
            h('path', { d: 'M2 19h20' }));
        }
        if (engine.kind === 'server') {
          return h('svg', open,
            h('path', { d: 'M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.2 3.9 3.9 0 0 0 7 19h10.5Z' }));
        }
        return h('svg', open,
          h('rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }),
          h('path', { d: 'M8 20h8M12 16v4' }));
      };

      const row = (engine) => {
        const current = !!data && engine.id === data.currentId;
        const state = probes[engine.id];
        const working = busy === engine.id;
        return h('div', {
          key: engine.id,
          className: 'dshes_card' + (current ? ' is_current' : ''),
          role: 'button',
          tabIndex: 0,
          onClick: () => switchTo(engine),
          onKeyDown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); switchTo(engine); }
          },
        },
        h('span', { className: 'dshes_icon' }, kindIcon(engine)),
        h('span', { className: 'dshes_main' },
          h('span', { className: 'dshes_label' }, engine.label),
          h('span', { className: 'dshes_sub' }, kindLabel(t, engine) + ' · ' + engine.url),
          state ? h('span', {
            className: 'dshes_probe' + (/unreachable|failed|401|403|404|5\d\d/i.test(state) ? ' is_bad' : ''),
          }, state) : null),
        current
          ? h('span', { className: 'dshes_badge' }, t('current'))
          : h('span', { className: 'dshes_actions' },
            h('button', {
              type: 'button',
              className: 'dshes_link',
              disabled: working || !!busy,
              onClick: (ev) => { ev.stopPropagation(); switchTo(engine); },
            }, working ? t('switching') : t('switch')),
            engine.local ? null : h('button', {
              type: 'button',
              className: 'dshes_link dshes_danger',
              disabled: !!busy,
              onClick: (ev) => { ev.stopPropagation(); removeEngine(engine); },
            }, t('remove'))));
      };

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

        h('div', null,
          h('div', { className: 'dshes_group' }, t('engines')),
          h('p', { className: 'dshes_groupSub' }, t('groupSub')),
          data === null
            ? h('div', { className: 'dshes_card' },
              h('span', { className: 'dshes_main' }, h('span', { className: 'dshes_label' }, '…')))
            : (engines.length === 0
              ? h('div', { className: 'dshes_card' },
                h('span', { className: 'dshes_main' },
                  h('span', { className: 'dshes_label' }, t('empty'))))
              : engines.map(row)),
          h('p', { className: 'dshes_note' }, t('tip'))),

        h('div', null,
          h('div', { className: 'dshes_group' }, t('addEngine')),
          h('label', { className: 'dshes_fieldCard' },
            h('span', null, t('nameLabel')),
            h('input', {
              className: 'dshes_input', value: form.label, placeholder: t('labelPlaceholder'),
              autoComplete: 'off',
              onChange: (ev) => setForm(Object.assign({}, form, { label: ev.target.value })),
            })),
          h('label', { className: 'dshes_fieldCard' },
            h('span', null, t('urlLabel')),
            h('input', {
              className: 'dshes_input', value: form.url, placeholder: t('urlPlaceholder'),
              autoComplete: 'off', inputMode: 'url',
              onChange: (ev) => setForm(Object.assign({}, form, { url: ev.target.value })),
              onKeyDown: (ev) => { if (ev.key === 'Enter') addEngine(); },
            })),
          h('div', { className: 'dshes_sectionLabel' }, t('kindLabel')),
          h('div', { className: 'dshes_seg' },
            h('button', {
              type: 'button',
              className: 'dshes_segBtn',
              'aria-pressed': form.kind === 'pc' ? 'true' : 'false',
              onClick: () => setForm(Object.assign({}, form, { kind: 'pc' })),
            }, t('kindPc')),
            h('button', {
              type: 'button',
              className: 'dshes_segBtn',
              'aria-pressed': form.kind === 'server' ? 'true' : 'false',
              onClick: () => setForm(Object.assign({}, form, { kind: 'server' })),
            }, t('kindServer'))),
          h('button', {
            type: 'button',
            className: 'dshes_primary',
            disabled: busy === '__add' || !form.url.trim() || !data,
            onClick: addEngine,
          }, busy === '__add' ? t('adding') : t('add'))));
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
