---
artifact: review
route: spec-stage-iteration
skills:
  - brainstorming
  - frontend-ui-engineering
  - api-and-interface-design
  - ui-ux-pro-max
skills_evidence:
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md frontmatter
source:
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md (v3)
  - src/agent/types.ts (AgentRunEvent union)
  - src/agent/runner.ts (AgentRunner API surface)
  - src/cli/menu.ts (mainMenuChoices 6 项)
created_at: 2026-08-07
batch_id: SPEC-REVIEW-V3
worktree_id: ""
worktree_path: ""
reviewer_instance: reviewer (subagent a4e35046cccb42a4f)
verdict: BLOCK
---

# Web Frontend Spec v3 — 独立审查

> **写入者：** Leader（reviewer readonly 返回正文后落盘）。
> **审查对象：** `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md` v3
> **变更焦点：** § 5.4.1 Slash 命令 8 → 18 条、新增 2 个服务端端点、4 个 Modal + theme.js
> **审查者：** Harness Reviewer（独立 subagent，未参与 spec 写作）

## 变更尺寸评估

| 指标 | 值 | 判定 |
|------|----|------|
| 变更行数（v2 → v3） | ~+230 行 | > 100，理想拆分 |
| 变更文件数 | 1（spec 主体） | OK |
| § 5.4.1 当前体量 | ~230 行 + 18 行命令表 + 字典 + ASCII + 端点表 + 边界 + F18 清单 + 重复块 | 建议拆分 |

## 对照依据

- spec：`.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md`
- 实际代码：
  - `src/agent/types.ts:584-807` AgentRunEvent 联合
  - `src/agent/runner.ts:1037-1874` AgentRunner API
  - `src/cli/menu.ts:12-93` 主菜单 6 项
- 声称对齐但实际不存在的源：CLI `chat.ts:478-523`（**该文件在仓库内不存在**，CLI 用数字菜单 1-6）

## Findings

### Critical（必须修复后才能完成）

1. **`/compact` 端点不可实现**：spec 声明 `POST /api/sessions/:cid/compact` 触发即时压缩；但 `AgentRunner` 无公开 `compact()` / `compactNow()`，服务端路由无路径可达。
   - 修复：§ 3.1.5 新增子节明确「需扩展 `AgentRunner` 公开 `compact()` 或新增 `Session.compact()` API」，否则 F-S-2 不可写。

2. **新端点缺失于 § 3 API 路由表 + § 6.2 路由字典 + § 7.1 WU 列表**：
   - `PATCH /api/providers/active/model`
   - `POST /api/sessions/:cid/compact`
   - `GET /api/providers/active`（被 `/provider` 引用）
   - 修复：补入 § 3.1.1 / § 3.1.2 / § 6.2 路由表 + § 3.4.2 错误码（`MODEL_NOT_FOUND`）+ § 7.1（新增 **B8**: 3 端点 + Zod + handler 测试）。

3. **`F18` WU 块未在 § 7 WU 主表中注册**：§ 7.1/§ 7.2 没有 F18 或 F-S-1/F-S-2；§ 12.1 changelog 写「7+18 WU」但 § 7.2 只列 F0-F17（17 项），差 1。
   - 修复：在 § 7.2 添加 **F18** 行（含 slash.js + 4 Modal + theme.js + slash.test.js），并核 18 项计数。

4. **§ 5.4.1 重复的「降级与边界 + F18 WU 落地清单」块**：line 913-934 和 line 936-948 近字面重复；line 946 残留 `/api/sessions/:cid/clear` 旧版措辞。
   - 修复：删除 line 936-948 整段。

5. **SSE 事件契约遗漏 `tool_start`**：spec § 6.1 事件枚举无 `tool_start`，但 `src/agent/types.ts:629-641` 定义该事件，`runner.ts:1608, 1619, 1678, 1762` 实际 yield。
   - 修复：§ 6.1 line 1250 加 `tool_start`，§ 6.4 `dispatchSseEvent` 加 case。

6. **`context_status` 事件实际不被发出**：`/compact` 声称「当前上下文使用率（来自 `context_status` 事件累加的 tokens / 上限）」。但 `grep 'type: "context_status"'` 仅在 `types.ts:732` 类型定义；`runner.ts` 全文不 yield 该事件。
   - 修复：要么补 runner yield `context_status`，要么改 `/compact` 改用其他来源（如 `Session.getTokenEstimate()`）。

### Important（应修复；可记录 defer 理由）

7. **`/theme` 三态枚举「dark/light/system」与 spec 其他位置冲突**：
   - § 3.3 line 224 只写 `"dark" | "light"`，无 `system`。
   - § 4.4.1 line 455 主题切换只支持 `data-theme="dark|light"`，未设计 `system` 模式。
   - 修复：要么把 `/theme` 退化为 dark/light 双态，要么把 § 3.3 / § 4.4.1 升级为三态 + `system` CSS 变量 fallback。

8. **`/theme` 的 localStorage key 与 § 3.3 不一致**：
   - § 3.3 + § 4.4.1 用 `my-agent.theme`（带前缀）。
   - § 5.4.1 line 749/910 用 `_theme`（无前缀）。
   - 修复：统一为 `my-agent.theme`。

9. **`/compact` 命令行为在表格 vs 代码 switch 上互相矛盾**：
   - 表格：先 Modal → 用户点击 → POST。
   - dispatchSlashKind：`await compactNow(cid)` 直接 POST，跳过 Modal。
   - 修复：要么表格改「直接 POST + 后置 Toast」，要么 switch 改 `openCompactModal()`。

10. **`/compact` 与 runner 自动 compaction 存在竞态，未在 § 9 风险表登记**：
    - 手动压缩与 `prepareContextBeforeModelCall`（runner.ts:1165）自驱压缩无互斥。
    - 修复：§ 9 风险表新增条目，或 spec 明确「服务端需对 cid 加 mutex」。

11. **`GET /api/sessions?archived=true&limit=50` query 参数未在 § 3 登记**：
    - § 3.1.2 只写 `GET /api/sessions — { sessions: [...] }`，无 query 参数说明。
    - 修复：§ 3.1.2 补 query 参数表（`archived?: boolean`、`limit?: number 1-200`、`offset?: number`）+ § 3.4.3 Zod schema。

12. **F18 落地清单 vs § 5.4.1 slash 表 Modal 数量不匹配**：
    - Slash 表触发 Modal 的命令有 10 个，F18 清单只列 5 个 Modal 文件。
    - 缺失：`ToolsModal.js`（/tools）、`SkillsModal.js`（/skills）、`SkillDetailModal.js`（/skill）、`CompactModal.js`（/compact）。
    - 修复：补 4 个 Modal 文件名到 F18 清单。

13. **CLI「1:1 对应」声明与实际不一致**：
    - § 5.4.1 标题写「Slash 命令（与 CLI `chat.ts:478-523` 1:1）」。
    - `chat.ts` **不存在**，CLI 用数字菜单 1-6，无 slash 命令。
    - 修复：标题改为「Slash 命令（与 CLI 数字菜单对齐 + Web 独有补充）」。

14. **CLI 主菜单 6 项 vs Web slash 命令覆盖不完整**：
    - ③「设置模型提供商」slash 不覆盖，走 Web 侧边栏设置入口。
    - spec 未说明「③ 为什么 slash 不覆盖」。
    - 修复：§ 5.4.1 表格下方加一段「CLI ③ → Web 走侧边栏设置入口（YAGNI 重复 slash）」。

### Suggestion（可改进非必须）

15. **F18 `slash.test.js` 测例未与 § 8 验收清单联动**：§ 8.1-8.8 无「Slash 命令 18 条全跑通」DoD 项。修复：§ 8.2 加一条 18 条命令各 1 case 通过。

16. **`/usage` 内存增长风险未评估**：spec 写「累加 done.result.usage」，长会话下无限增长。修复：§ 9 风险表新增或 § 5.4.1 /usage 加「窗口策略：会话内累计 + 切换 cid 时清零」。

17. **`/history` 前 50 条无分页机制**：修复：§ 5.4.1 加「50 条以上显示「查看更多」按钮，调用 `GET /api/sessions?limit=200&offset=50`」。

18. **`navigator.clipboard.writeText` 需 HTTPS / 权限处理**：spec 直接调 `navigator.clipboard`，未处理 `NotAllowedError`。修复：`/copy` + `/save` catch 时回退 `document.execCommand('copy')` 或 Toast 提示「请手动复制」。

19. **`/usage` Modal token 数据是否泄露**：本机 localhost 单用户，不算敏感。文档化「仅本地单用户使用」即可。

20. **§ 5.4.1 体量过大需拆分**：当前 ~230 行，建议拆为 § 5.4.1-§ 5.4.5。

21. **`theme.js` 与 F0 `theme.js` 重名冲突**：F0 `web/js/shared/theme.js`（CSS 变量注入器）+ F18 `web/js/features/theme.js`（`/theme` 命令）。建议 spec 明确两者职责切分。

22. **`/theme` 切主题是否影响 CSP**：§ 6.6 CSP 不含 `'unsafe-inline'`，且主题切换用 CSS 变量不引入 inline style。OK，但 spec 未明确。建议补一句。

### Nit（风格细节）

23. **`optionalArgs` 字段名拼写**：字典用 `optionalArgs`，与 `needsArgs`（语义「必须有参数」）不正交。改 `requiresArgs: false/true`（默认 false）+ `optionalArgs: true`（覆盖）。

24. **dispatchSlashKind 缺 `default` 兜底**：若误传 `kind: "unknown"` 落到 `return false`。建议加 `default: console.warn(...)`。

25. **`/save` Toast info 附「复制到剪贴板」按钮**：要求 Toast 支持 action button。补一句「所有 Toast 类型都允许 1 个 action button」。

26. **`/agent <id>`（表格 line 743）但字典无此命令**：v2 残留。修复：要么补 `/agent` 命令，要么表格里把 `/agent <id>` 改为「点击 Modal 内 entry → 切到 /agents/<id> 详情 Modal」。

## 结构疗法建议

| 重构模式 | 适用场景 | 建议 |
|---------|---------|------|
| 提取方法/函数 | § 5.4.1 当前 230 行 + 多张表 + ASCII 图 + 重复块 | 拆为 § 5.4.1-§ 5.4.5 子节 |
| 删除重复 | line 913-934 vs 936-948 近字面重复 | 删除 line 936-948 整段 |
| 补全枚举/路由表 | § 3 + § 6.2 + § 7.1 缺新端点 | 同步补 3 个端点 + Zod + WU |
| 事件契约对齐 | § 6.1 SSE 事件枚举与 runner.ts yield 不一致 | 加 `tool_start` + 对齐实际 yield 的事件子集 |

## 死代码 / 孤儿代码检查

- [ ] § 5.4.1 line 936-948 重复块删除
- [ ] § 5.4.1 line 946 `/api/sessions/:cid/clear` 旧版措辞清理
- [ ] /agent <id> 残留描述清理（Finding 26）

## 证据

- 已 Read: `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md`（line 1-1793）
- 已 Read: `src/agent/types.ts:584-807` AgentRunEvent
- 已 Read: `src/agent/runner.ts:1037-1874` AgentRunner
- 已 Read: `src/cli/menu.ts:12-93` 主菜单
- 已 grep `src/agent/` 内 `compact()` / `compactNow()` / `runCompact()` / `triggerCompact` 均无公开 API
- 已 grep `src/agent/` 内 `yield { type:` 实际产出：`text_delta / tool_delta / tool_start / done`（4 类），类型定义还有 7 类但 **不被发出**
- 已 grep spec 内 `PATCH /api/providers/active/model` + `POST /api/sessions/:cid/compact` + `GET /api/providers/active` 仅出现在 § 5.4.1 + § 12.1
- 已 grep § 7.2 仅 F0-F17（17 项），与 § 12.1 声明的「7+18 WU」差 1
- 已 grep § 5.4.1 line 749/910 用 `_theme`；§ 3.3 + § 4.4.1 用 `my-agent.theme`

## 未验证项

- § 5.4.1 `dispatchSlashKind` 中 16 个 helper 函数（`openHelpModal` / `promptQuitAndClose` / `clearContext` / ...）的实际签名 / 错误处理路径未在 spec 中定义——属实现细节，需 plan 阶段 WU 设计补充
- `/usage` Modal 的「按 provider.model 分组」逻辑，provider+model 来源（`done.result.meta.provider/model`）需对照 types.ts 确认
- § 6.4 dispatchSseEvent 中 `compaction` / `context_status` / `provider_fallback` / `retry` 实际不被发出，实现期才发现
- § 8.6 axe-core 自动扫描 F18 范围（属于 F17），新增 4 个 Modal 可能引入 axe 问题，需 F17 特别覆盖
- `/model` 端点的 404 错误码 `MODEL_NOT_FOUND` 缺失——属 § 3.4.2 缺失

## 结论

**verdict:** BLOCK

未关闭 Critical（6 项）+ Important（8 项）。Reviewer 强烈建议：

1. **必先修复 Finding 1-6（Critical）**：都是 spec 与实际代码不一致 / 章节不一致，会导致下游 plan / code 无法正确执行
2. **重要修复 Finding 7-14（Important）**：尤其是 7、8、11、13（涉及 spec 内部一致性，会让下游误解）
3. Finding 15-22（Suggestion）可在 plan 阶段一并处理
4. Finding 23-26（Nit）跟随 Critical 修复顺带清理

## Next

- BLOCK → 必须修复后再次派 reviewer
- 建议处理顺序：
  1. 先修 Finding 4（删重复）+ Finding 26（清残留）—— 最小操作，最快确认 spec 自洽
  2. 再修 Finding 5（SSE 补 tool_start）+ Finding 6（context_status 来源）—— 影响 § 6.1 / § 5.4.1
  3. 然后修 Finding 1 + 2 + 3（端点可实现性 + 端点登记 + F18 WU）—— 三位一体
  4. 接着修 Finding 7-14（一致性）
  5. 最后处理 Suggestion + Nit
- 修完后再次派 reviewer 走一遍五轴审查