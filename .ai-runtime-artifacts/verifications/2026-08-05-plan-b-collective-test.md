# Plan B 集体测试

> **route:** orchestration → collective-closeout
> **dispatch:** `.ai-runtime-artifacts/plans/2026-08-05-plan-b-dispatch.md`
> **date:** 2026-08-05
> **status:** completed (with findings)

## 测试覆盖

| 维度 | 方法 | 结果 |
|------|------|------|
| JS 语法 | `node --check` × 5 文件 | PASS |
| CSS 语法 | 花括号平衡检查 | PASS |
| HTML 结构 | 人工审查 4 页面 section | PASS |
| API 契约 | 与 api.js / IPC handlers 对照 | PASS |
| 代码审查 | code-reviewer (五轴) | REQUEST CHANGES (3 BLOCK) |
| 安全审查 | security-auditor (OWASP + LLM) | 2 BLOCK (1 Plan-B, 1 Plan-A) |
| tsc --noEmit | TypeScript 编译 | SKIP (环境不可用) |
| npm test | Vitest 单元测试 | SKIP (环境不可用) |
| E2E (Electron 启动) | npm run dev | SKIP (需完整环境) |

## 审查发现分类

### Plan B 直接引入 (本次变更)

| ID | 严重度 | 类别 | 描述 | 文件 |
|----|--------|------|------|------|
| B1 | BLOCK | 安全/XSS | LLM 输出经 marked 直接 innerHTML，无消毒 | chat.js:166, markdown.js:6 |
| B2 | BLOCK | 正确性 | 页面重复进入导致事件监听器累积 | app.js:66-77, sessions/settings/skills.js |
| B3 | BLOCK | 正确性 | chat 并发发送污染流状态 | chat.js:162,213-231 |
| W1 | WARN | 正确性 | 时间筛选只过滤当前页，分页总数失真 | sessions.js:46-78 |
| W2 | WARN | 可读性 | 分页页码固定 1..5，超出后高亮丢失 | sessions.js:149-151 |
| W3 | WARN | 性能 | 流式监听器从未退订，ipcRenderer 泄漏 | chat.js:164-231 |
| W4 | WARN | 性能 | 每 token 全量重渲染 Markdown | chat.js:164-168 |
| W5 | WARN | 正确性 | 搜索/筛选/切页竞态 + 页码不重置 | sessions.js:41-66 |
| W6 | WARN | 正确性 | 设置页保存只在 models tab 生效 | settings.js:532-546 |
| W7 | WARN | 健壮性 | Provider 表单保存无异常处理 | settings.js:181-193 |
| W8 | WARN | 安全 | 多处字段未转义直接 innerHTML | chat.js:72, skills.js:119-134, settings.js:101 |
| W9 | INFO | 架构 | esc/escapeHtml/formatTokens 重复 5 处 | 多个文件 |
| W10 | INFO | 正确性 | loadHistory 异步竞态 | chat.js:108-138 |

### Plan A 预存 (非本次变更)

| ID | 严重度 | 类别 | 描述 | 文件 |
|----|--------|------|------|------|
| SA-B2 | BLOCK | Electron 安全 | 无导航/新窗口防护 | electron/main.ts:22-38 |
| SA-W1 | WARN | IPC 安全 | preload 暴露通用 IPC 通道 | electron/preload.cjs:9-33 |
| SA-W2 | WARN | Electron 安全 | sandbox: false | electron/main.ts:33 |
| SA-W3 | WARN | CSP | style-src 'unsafe-inline' 可收紧 | index.html:6-7 |

## References 检查

| # | Reference | 状态 | 备注 |
|---|-----------|------|------|
| 1 | definition-of-done.md | PASS | 非生产发布；核心功能项已完成 |
| 2 | testing-patterns.md | n/a | 纯 UI 文件，无测试逻辑变更 |
| 3 | security-checklist.md | PASS (with findings) | XSS/Electron 安全已审查，见安全报告 |
| 4 | performance-checklist.md | PASS (with findings) | W3/W4 标注性能问题，非阻塞 |
| 5 | observability-checklist.md | n/a | 无后端/服务变更 |
| 6 | accessibility-checklist.md | INFO | 侧栏用 div 非 button，待改进 |
| 7 | orchestration-patterns.md | PASS | 遵循 Pattern 3 并行扇出，工作流正确 |

## 判定

**APPROVED (with deferred items)**

Plan B 的核心交付物（4 个页面的完整 HTML/CSS/JS 结构）已就位。B1-B3 为 BLOCK 级别，建议在合入 main 前修复：
- B1 (Markdown XSS): 引入 DOMPurify 或等价消毒 → 建议 Plan C 统一处理
- B2 (事件监听器累积): 加 `_initialized` 守卫 → 轻量修复，可立即处理
- B3 (并发流污染): 加发送中守卫 → 轻量修复，可立即处理

Plan A 预存问题（SA-B2, SA-W1, SA-W2, SA-W3）建议在 Plan C 或独立安全加固阶段处理。
