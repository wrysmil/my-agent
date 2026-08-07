---
artifact: security-review
route: orchestration.collective-closeout
plan: .ai-runtime-artifacts/plans/stage4-tool-system-implementation.md
reviewer: Security-Auditor (general-purpose agent)
created_at: 2026-08-07
status: NEEDS_FIX
---

# 阶段4：工具系统 — 安全审查报告

## 总体结论：NEEDS_FIX

3 个 HIGH、8 个 MEDIUM、4 个 LOW。核心风险集中在 bash 权限语义误导、环境变量泄露、SSRF 三个方面。

## HIGH 发现

### HIGH-1: bash `workspace_only` 名不副实
- **位置**: `src/tools/bash-permissions.ts:88-103`, `src/tools/builtin.ts:492-495`
- **问题**: `isBashAllowed` 只校验起始 cwd 是否在 workingDir 内，命令本身读写的文件完全不受约束
- **攻击场景**: `TOOL_EXEC_MODE=workspace_only` 下仍可 `cat /etc/passwd`、`cat ~/.aws/credentials`

### HIGH-2: bash 子进程透传完整 process.env
- **位置**: `src/tools/builtin.ts:505` (`env: { ...process.env }`)
- **问题**: 所有环境变量（含 API Key）传给子 shell，输出经 capToolResult 可明文持久化
- **runner 中 `sandboxEnv` 控制完全未生效**（runner.ts:1979,2069 → bashTool 忽略）

### HIGH-3: web_fetch SSRF 无防护
- **位置**: `src/tools/builtin.ts:557-598`
- **问题**: 仅检查 http/https scheme，无 localhost/私有网段/metadata IP 拦截，跟随重定向

## MEDIUM 发现

| # | 问题 | 位置 |
|---|---|---|
| M4 | 工具结果明文持久化，无脱敏 | `tool-result-cap.ts:131-166` |
| M5 | grep_files 显式放行 `.env*` 文件 | `builtin.ts:436` |
| M6 | symlink 逃逸（path-sandbox 不做 realpath） | `path-sandbox.ts:10` |
| M7 | toolResultsDir ref 解析子串匹配 + 可 symlink 投毒 | `tool-result-tools.ts:45-56` |
| M8 | read_file 无大小上限（OOM 风险） | `builtin.ts:36` |
| M9 | web_fetch 无响应体大小限制 | `builtin.ts:565-593` |
| M10 | 写工具默认可写全局 skill 目录 | `builtin.ts:642-646` |

## OWASP / LLM 安全对照

| 类别 | 判定 | 关键项 |
|---|---|---|
| A01 路径穿越 | ⚠️ 部分缓解 | 字符串级阻断正确，symlink 未堵 |
| A03 命令注入 | ❌ | workspace_only 可逃逸 |
| A02 不安全存储 | ❌ | 明文落盘 + env 全透传 |
| SSRF | ❌ | 无网段/重定向防护 |
| LLM01 间接提示注入 | ❌ | 工具输出无指令/数据隔离 |
| LLM02 过度代理 | ❌ | bash unrestricted 完全放行 |
| LLM06 敏感信息泄露 | ❌ | env + .env + 明文持久化三路径 |

## npm audit

6 个漏洞（全部为 devDependencies）：vitest critical、electron high、vite high。生产依赖 (`async-mutex`, `dompurify`, `zod`) 无已知漏洞。

## 已正确实现

- `..` 字符串级路径穿越防护（root 前缀检查正确）
- ref hex 正则校验（`tool-result-tools.ts:33`）
- cursor 边界校验
- bash maxBuffer 1MB + timeout 120s 上限
- GC 驱逐策略
