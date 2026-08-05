# Plan B 安全审查报告

> **审查类型:** OWASP Top 10 + LLM Top 10 + Electron 安全
> **审查者:** security-auditor agent
> **审查范围:** dfe34b4 + 4f4476d + 关联主进程/preload/IPC 层
> **date:** 2026-08-05

## 总体判定: 2 BLOCK (1 Plan-B, 1 Plan-A), 4 WARN

## Plan B 直接引入

### BLOCK-1: LLM 输出经 marked 渲染后直接 innerHTML (XSS)
- **文件:** `electron/renderer/js/pages/chat.js:166`, `electron/renderer/modules/markdown.js:6`
- **OWASP:** LLM01 Prompt Injection, A03 XSS
- **详情:** marked v15 已移除内置 sanitize。LLM 输出中的裸 HTML 直接注入 DOM。CSP 挡住 script 但挡不住 UI 欺骗/钓鱼、file:// 引用等
- **修复:** 引入 DOMPurify 对 marked.parse 输出消毒

### WARN-4: 多处插值未转义
- **文件:** `chat.js:72` (s.model), `settings.js:101` (models), `skills.js:119-134` (icon/category/version)
- **修复:** 统一走 esc()/escapeHtml()

## Plan A 预存 (非本次变更)

### BLOCK-2: 渲染进程无导航/新窗口防护
- **文件:** `electron/main.ts:22-38`
- **风险:** 点击 markdown 链接可导航到远程页面，preload 在远程页面上仍然暴露完整 IPC
- **修复:** 添加 `setWindowOpenHandler` + `will-navigate` 守卫

### WARN-1: preload 暴露未白名单的通用 IPC 通道
- **文件:** `electron/preload.cjs:9-33`
- **修复:** 改为白名单枚举

### WARN-2: sandbox: false
- **文件:** `electron/main.ts:33`
- **修复:** 改为 `sandbox: true`

### WARN-3: CSP 可进一步收紧
- **文件:** `electron/renderer/index.html:6-7`
- **修复:** 移除 `style-src 'unsafe-inline'`，补充 `object-src/base-uri/frame-src/form-action`

## 正面实践

- `contextIsolation: true` + `nodeIntegration: false` 正确设置
- CSP meta 存在且 `script-src 'self'` 不含 unsafe-inline/eval
- API Key 全链路加密处理正确 (AES-256-GCM, 编辑不回显, 明文不返回渲染层)
- 删除/批量操作均有 confirm 二次确认

## 优先修复顺序

1. BLOCK-1 (Markdown 消毒) + SA-BLOCK-2 (导航防护) — 组合构成最现实利用链
2. SA-WARN-1 (preload 白名单) — 消除 IPC 全量面
3. SA-WARN-2/3 (sandbox, CSP) — 纵深加固
4. WARN-4 与其他 INFO 排期
