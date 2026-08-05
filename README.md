# My Agent

LLM Agent 运行时框架 - 从零搭建学习项目。

## 特性

- **数字彩菜单 CLI** — 启动后进入主菜单，6 色循环编号，一键切换/配置/查看
- **本地 Provider 配置** — 在 `~/.my-agent/providers.json` 维护多个模型提供商，零环境变量
- **DeepSeek 适配** — 流式 / 非流式 / 工具调用 / 错误映射
- **持久化会话** — JSONL 消息存档 + 上下文侧车，可恢复历史对话

## 项目结构

```
my-agent/
├── src/
│   ├── shared/                     # 错误、类型、日志（零依赖）
│   ├── config/                     # Zod schema 配置
│   ├── tools/                      # 工具抽象层
│   ├── providers/                  # LLM Provider 适配层
│   ├── agent/                      # Agent 主循环
│   ├── cli/                        # 数字彩菜单 + 表单
│   ├── storage/                    # JSON / JSONL 持久化
│   └── prompts/                    # System Prompt 模板
├── harness-kit/                    # Harness-Kit 工程规范
└── tests/                          # 单测 + 集成测试
```

## 技术栈

- **TypeScript** + **Node.js** (ESM, NodeNext)
- **Zod** - 运行时配置校验
- **Vitest** - 测试框架
- **tsx** - TypeScript 直接执行
- **原生 ANSI 转义序列** - 数字彩菜单（无 chalk 依赖）

## 快速开始

```bash
npm install
npm run chat
```

首次运行会自动创建 `~/.my-agent/providers.json` 并预填 DeepSeek。进入主菜单后选 ② 设置 API Key。

## 数字彩菜单

```
┌───────────────────────────────────────┐
│            🤖 My Agent — 主菜单            │
└───────────────────────────────────────┘

   当前: deepseek (DeepSeek) [启用]

  ① 开始对话
  ② 设置模型提供商
  ③ 查看当前提供商
  ④ 退出

请选择 (1-4): 
```

**设置子菜单**（选 ② 进入）：

```
  ① 列出所有提供商
  ② 修改当前提供商
  ③ 切换当前提供商
  ④ 启用 / 禁用
  ⑤ 删除提供商
  ⑥ 返回上级
```

## Provider 配置

存储路径：`~/.my-agent/providers.json`（文件权限 `0o600`）

可通过环境变量 `MY_AGENT_HOME` 覆盖根目录。

```json
{
  "version": 1,
  "activeProviderId": "deepseek",
  "providers": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "type": "deepseek",
      "apiKey": "sk-xxxxx",
      "baseUrl": "https://api.deepseek.com/v1",
      "defaultModel": "deepseek-chat",
      "enabled": true
    }
  }
}
```

## CLI 命令

```bash
npm run chat              # 主菜单（默认）
npx tsx chat.ts --list    # 列出历史会话
npx tsx chat.ts --load <id>  # 恢复指定会话（跳过菜单）
```

对话内命令（输入 `/help` 查看）：

- `/quit` `/exit` — 退出
- `/clear` — 清空上下文（新建 session）
- `/save` — 显示当前 session ID
- `/tools` — 列出所有工具
- `/skills` — 列出所有 Skill
- `/skill <id>` — 查看 Skill 详细内容

## 开发

```bash
npm test            # 跑全量测试
npm run check       # TypeScript 类型检查
npm run chat        # 启动 CLI
```

## 文档

- 设计规范：[`.ai-runtime-artifacts/specs/2026-08-05-cli-menu-and-provider-config.md`](.ai-runtime-artifacts/specs/2026-08-05-cli-menu-and-provider-config.md)
- 实施计划：[`.ai-runtime-artifacts/plans/2026-08-05-cli-menu-and-provider-config-plan.md`](.ai-runtime-artifacts/plans/2026-08-05-cli-menu-and-provider-config-plan.md)
- 验证产物：[`.ai-runtime-artifacts/verifications/2026-08-05-cli-menu-and-provider-config-verification.md`](.ai-runtime-artifacts/verifications/2026-08-05-cli-menu-and-provider-config-verification.md)
