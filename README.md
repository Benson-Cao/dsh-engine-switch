# dsh-engine-switch

把「手机本地引擎 / 多台电脑引擎 / 服务器引擎」的切换做成一个 **DeepSeek Harness 插件**，而不是改 APK。

插件在 DSH 进程内起一个独立网关（默认 `127.0.0.1:3082`），它同时是：

1. **引擎注册表** —— 三类端点持久化在 `$DSH_HOME/engine-switch/engines.json`
2. **切换页** —— `/__switch/`，手机浏览器可直接加到主屏幕
3. **反向代理** —— `/` 及其它所有路径转发到当前选中的引擎，HTTP / SSE / WebSocket 全透传

浏览器（或手机 App 的 WebView）**始终只连一个 loopback origin**，因此 DSH 自身的 Host/Origin 校验、Cookie、移动端注入脚本、JS 桥信任边界都不用放宽。切引擎只换上游，不改安全模型。

> 典型场景：手机上的 DSH 装这个插件作为统一入口；家里台式机、公司电脑、云服务器的 `dsh web` 都登记进来。手机随时切到任意一台，会话各自留在对应引擎上。

---

## 安装

需要 Node.js `^22.19.0 || >=24.0.0`，以及 DeepSeek Harness（在 0.2.2-rc.1 上验证）。

```bash
# Web profile（最常用）
dsh plugin --profile web add github:Benson-Cao/dsh-engine-switch
dsh --profile web

# 或本地源码调试
dsh plugin --profile es-test add ./dsh-engine-switch
dsh --profile es-test --dump-config     # 应能看到 dsh-engine-switch 这一行
dsh --profile es-test
```

桌面版请在「插件」页安装后**完全退出并重开** DSH（bundle 需要进程重启才挂载）。

启动日志出现 `[dsh-engine-switch] ready on http://127.0.0.1:3082/` 即成功。

## 使用

| 地址 | 作用 |
|---|---|
| `http://127.0.0.1:3082/__switch/` | 引擎切换页：登记、删除、切换、探测 |
| `http://127.0.0.1:3082/` | 当前引擎的 DSH 主界面（反代） |

代理后的 DSH 页面左下角会注入一个「引擎」按钮，随时跳回切换页。手机浏览器可对切换页「添加到主屏幕」。

登记三类引擎：

- **本机**：默认已存在，指向 `selfUrl`（默认 `http://127.0.0.1:3080`），直连不绕代理之外的新跳
- **电脑**：`dsh web --host 192.168.1.10` 后登记 `http://192.168.1.10:3080`
- **服务器**：VPS 上 `dsh --profile web` + Caddy/Nginx 反代 + 正式证书，登记 `https://dsh.example.com`

DSH Web 默认拒绝 `0.0.0.0` 绑定，服务器引擎前面必须有反代；Tailscale / ZeroTier 私网地址同样适用。

## 配置

`cordis.patch.yml` 是整行配置（patch 的 `config` 为整行替换，缺省字段走代码内默认值）：

```yaml
- insert:
    - id: dsh-engine-switch
      name: dsh-engine-switch
      config:
        host: 127.0.0.1     # 只绑 loopback；改成 0.0.0.0 必须同时设 token
        port: 3082
        selfUrl: http://127.0.0.1:3080   # 本机 DSH 的地址
        token: ''            # 非空时所有请求需带 ?token= 或 Authorization: Bearer
        allowSelfSigned: true
```

`home` 可显式指定配置根目录，默认 `$DSH_HOME`（未设置时为 `~/.dsh`）。

**安全默认值**：`host` 不是 loopback 且未设 `token` 时插件直接抛错拒绝启动——网关代理的是一个能读写文件、执行命令的 Agent，不能裸奔在局域网上。

## HTTP API

全部返回 JSON；设了 `token` 时每个请求都要带凭证。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/engines` | 列表 + 当前 id + 当前上游 |
| POST | `/api/engines` | 添加 `{label, url, kind}`，`kind` 为 `pc` / `server` |
| DELETE | `/api/engines/:id` | 删除（至少保留一个） |
| POST | `/api/engines/switch` | 切换 `{id}`，即时生效，无需重启 |
| GET | `/api/engines/probe` | 逐个探测可达性（HTTP → TCP 降级） |

## 实现要点

- **Cordis 形态**：`package.json` 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`；`index.js` 导出 `name` + `apply(ctx, config)`；不声明 `inject`，只用 Node 内置模块，因此不耦合特定 DSH 服务版本。
- **可逆卸载**：listener 与所有活跃 socket 由**单个** `ctx.effect()` disposer 统一销毁，保证关闭顺序。
- **零依赖**：只用 `node:http/https/net/tls/fs/crypto`，不需要 `npm install`。
- **反代细节**：改写请求 `Host` / `Origin` / `Referer`，改写响应 `Set-Cookie` / `Location` / CSP；SSE 按 chunk 透传不缓冲；WebSocket 手写升级请求后走裸 TCP 双向管道（TLS 上游监听 `secureConnect`）。
- **HTML 注入**：仅对未压缩的 `text/html` 响应缓冲并插入悬浮按钮，其它响应保持零拷贝 pipe。

## 边界与已知限制

- **不迁移会话**。每个引擎有独立 `$DSH_HOME` 与 append-only session log；切换只换执行者。跨引擎历史需另配 NAS 同步。
- 远程引擎若挂了**配对型网关**（例如 dsh-mobile 的 3443 私有 CA + token），本插件不会替你完成那层握手；请登记裸 `dsh web` 或已完成认证的 HTTPS 反代地址。
- 上游自签证书默认放行（`allowSelfSigned: true`）；只登记你信任的主机。
- `/` 被反代占用，切换页放在 `/__switch/`；DSH SPA 前端若使用了 Service Worker，切换后建议强刷一次。
- DSH 处于 developer preview，上游 API 可能有破坏性变更。

## 与 Android App 配合

如果用的是自带完整 Node 运行时的 `com.dsh.harness` 手机 App：把 WebView 目标从 `127.0.0.1:3080` 改成 `127.0.0.1:3082`，或直接用手机浏览器访问切换页即可。App 侧的 A-02 安全模型（WebView 只信任 loopback）完全不用改。

## 开发

```bash
npm run check   # 语法检查
npm test        # 起 mock 上游 + 网关跑端到端冒烟测试
```

## License

MIT © 2026 Benson-Cao
