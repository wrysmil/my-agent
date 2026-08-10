---
artifact: verification-lite
route: leader-direct
skills:
  - systematic-debugging
  - source-driven-development
  - test-driven-development
  - verification-before-completion
skills_evidence:
  - .agents/skills/systematic-debugging/SKILL.md
  - .agents/skills/source-driven-development/SKILL.md
  - .agents/skills/test-driven-development/SKILL.md
  - .agents/skills/verification-before-completion/SKILL.md
source:
  - 用户：「那你修复下」
  - 用户提供的会话切换后重复/孤儿过程气泡截图
  - .ai-runtime-artifacts/specs/2026-08-10-chat-session-stream-isolation-spec.md
created_at: 2026-08-10
tier: 1
---

# Chat 历史工具循环聚合 — 轻量验证（Tier 1）

## 范围

- `web/src/features/chat/useChatStream.ts`
  - history 恢复时按 `runId` 聚合同一次发送的 assistant 与 tool_result 记录。
  - 旧 JSONL 缺少 `runId` 时回退到 `turnId`。
  - 聚合后采用最后一条 assistant 记录的稳定 message ID，并保持块顺序。
- `web/tests/features/chat/chat-session-stream-isolation.test.tsx`
  - 覆盖 user → intermediate assistant → tool result → final assistant 的持久化恢复。

## TDD 证据

- 未创建提交，commit hash 检查不适用。
- RED：目标测试失败，实际恢复 4 个消息，期望 2 个。
- GREEN：同一目标测试文件 22/22 通过。
- Happy path：通过。
- 边界：tool_result 的 `role: user` 存储语义与最终 assistant ID 收敛已覆盖。
- 兼容：实现包含缺少 `runId` 时按 `turnId` 聚合的旧数据回退。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm test -- --run "tests/features/chat/chat-session-stream-isolation.test.tsx"`（修复前） | FAIL；新增用例得到 4 个消息而非 2 个，正确复现缺陷 |
| `npm test -- --run "tests/features/chat/chat-session-stream-isolation.test.tsx"`（修复后） | PASS；1 文件、22 测试通过 |
| `npm run build` | PASS；TypeScript build 与 Vite build exit code 0；保留既有大 chunk warning |
| `npm test` | FAIL；180/183 通过。失败为既有 `chatRuntimeStore` fixture 缺少 `runId` 以及 2 个 bundle budget 超限，与本 diff 无关 |
| IDE diagnostics（两个改动文件） | PASS；无 linter errors |

## 验收检查

- [x] 会话切回后，同一 run 的中间 assistant 与最终 assistant 只形成一个气泡。
- [x] tool_result 不再形成空 user/孤儿过程气泡。
- [x] thinking、tool_call、tool_result、最终 text 保持持久化顺序。
- [x] 最终 assistant 的 message ID 用于 history/overlay 收敛。
- [x] 未修改 CSS 或用隐藏规则掩盖重复 DOM。

### References 检查

- `definition-of-done.md` Correctness：PASS（缺陷用例具备 RED/GREEN 证据，目标回归通过）。
- `definition-of-done.md` Quality：PASS（改动限于历史投影与对应测试，无无关重构）。
- `definition-of-done.md` Integration：PARTIAL（构建通过；全量测试存在 3 个已知非本次回归失败，已明确记录）。
- `definition-of-done.md` Documentation：N/A（无公共 API 变化）。
- `definition-of-done.md` Ship-readiness：N/A（未发布、未提交）。

## 未验证项

- 未启动真实 provider 做人工浏览器回切；自动测试直接覆盖对应 history 数据形态。
- 全量前端测试并非全绿，既有 3 个失败需另行处理。

## Next

- 用户可在当前运行中的 Web 服务刷新页面，切换到其他会话再切回，确认历史气泡视觉结果。
- 如需提交代码，另行执行 Git 路由。
