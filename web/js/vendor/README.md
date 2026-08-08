# web/js/vendor/ — 第三方前端依赖（手动 vendored）

> 依据 spec § 4.2 / § 4.3：DOMPurify 与 marked **不走 npm**，而是手动下载 minified 文件放到本目录。
> 原因：前端是纯 vanilla HTML/CSS/JS，**零前端构建工具**，但仍需保证外部脚本不被篡改 → SRI Subresource Integrity。

## 文件清单

| 文件 | 来源（npm 包名 + 版本） | CDN URL（下载用） | 本地大小 | sha384 SRI |
| --- | --- | --- | --- | --- |
| `dompurify.min.js` | [`dompurify@3.4.13`](https://www.npmjs.com/package/dompurify/v/3.4.13) | <https://cdn.jsdelivr.net/npm/dompurify@3.4.13/dist/purify.min.js> | 29,474 bytes | `sha384-ZuC+DIACqSIZTsp+7YF57cR5Y+6qXa7YFbEKdA/EHA/R0T+41dtorqucYl71Zp+t` |
| `marked.min.js` | [`marked@12.0.2`](https://www.npmjs.com/package/marked/v/12.0.2) | <https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js> | 35,479 bytes | `sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi` |

> 上述 CDN URL 用于**首次下载**。本目录的 minified 文件就是「锁版本 + 锁字节」的产物。
> 若需升级，见下方「升级步骤」。

## 用途

- **DOMPurify v3**（XSS 净化）
  - 在 `web/js/features/chat.js` 中：先用 `marked` 把 Markdown 转 HTML，再用 `DOMPurify.sanitize(html, ...)` 过滤后再插入 DOM。
  - spec § 6.6「不**使用 eval/Function(...)/innerHTML 含未净化内容」 + 「Markdown 走 DOMPurify」。

- **marked v12**（Markdown → HTML）
  - 在 `web/js/features/chat.js` 中：解析 LLM 返回的 Markdown 流（代码块 / 列表 / 标题 / 链接等）。

## 在 `index.html` 中的引用（带 SRI）

```html
<script src="./js/vendor/dompurify.min.js"
        integrity="sha384-ZuC+DIACqSIZTsp+7YF57cR5Y+6qXa7YFbEKdA/EHA/R0T+41dtorqucYl71Zp+t"
        crossorigin="anonymous" defer></script>
<script src="./js/vendor/marked.min.js"
        integrity="sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi"
        crossorigin="anonymous" defer></script>
```

- `integrity="sha384-..."` — 浏览器加载脚本时会**逐字节**比对 hash；不匹配则拒绝执行（防御 CDN/中间人篡改）。
- `crossorigin="anonymous"` — SRI 规范**要求**该属性，否则浏览器不会执行完整性检查（同源脚本默认不发 CORS 请求）。
- `defer` — 与 spec § 4.2 「经典 `<script>` 标签顺序加载」一致；vendor 脚本无副作用，可以延迟到 DOMContentLoaded 之前。

## 升级步骤

1. **查新版**：
   - DOMPurify：<https://github.com/cure53/DOMPurify/releases>
   - marked：<https://github.com/markedjs/marked/releases>
2. **下载新版本**到本目录（覆盖旧文件）：
   ```bash
   # 从工作区根目录（worktree）运行
   curl -sSL -o web/js/vendor/dompurify.min.js \
     https://cdn.jsdelivr.net/npm/dompurify@<新版本>/dist/purify.min.js
   curl -sSL -o web/js/vendor/marked.min.js \
     https://cdn.jsdelivr.net/npm/marked@<新版本>/marked.min.js
   ```
3. **重算 sha384 SRI hash**：
   ```bash
   openssl dgst -sha384 -binary web/js/vendor/dompurify.min.js | openssl base64 -A
   openssl dgst -sha384 -binary web/js/vendor/marked.min.js | openssl base64 -A
   ```
4. **同步更新 `web/index.html`**：把对应 `<script>` 标签的 `integrity="sha384-<新hash>"` 替换为新计算结果。
5. **更新本 README** 表格中的「版本 + size + hash」三列。
6. **测试**：
   ```bash
   # 启动 web 服务，进入对话视图，发送带 Markdown + 代码块的提示词
   npm run web
   ```
   - 检查消息渲染是否正常（代码块着色、列表、链接可点）
   - 检查 XSS 净化是否生效（贴 `<img src=x onerror=alert(1)>` 不应弹窗）
7. **提交**：commit message 参考 `chore(vendor): bump dompurify 3.x.y → 3.x.z`。

## 安全提示（引用 security-checklist.md § Dependency Security）

- 本目录文件**不**在 `package.json` 中声明，因此 `npm audit` 不会扫到它们；升级流程完全靠人工。
- 升级前请到 [Snyk Vulnerability DB](https://snyk.io/vuln) / GitHub Advisory Database 检查目标版本是否有 CVE。
- 升级后保留旧文件 30 天（git history 即可），便于紧急回滚。

## 禁止项

- **不**允许 `npm install dompurify marked` —— spec § 4.3 明令「无 npm 包替代」。
- **不**允许引入 webpack/vite/rollup —— spec § 4.3「无构建工具」。
- **不**允许手动修改 `dompurify.min.js` / `marked.min.js` 内容 —— 修改后 hash 失配，浏览器会拒绝加载；如需定制，请 fork 上游并重新生成 minified。