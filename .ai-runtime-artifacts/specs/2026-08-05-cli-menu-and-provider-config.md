---
title: CLI 数字彩菜单 + 模型提供商本地配置
date: 2026-08-05
artifact: spec
route: superpowers:brainstorming
skills:
  - brainstorming
skills_evidence:
  - ~/.claude/skills/brainstorming/SKILL.md
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/entrypoints/HARNESS-PLATFORM-ENTRY.md
  - .ai-runtime-artifacts/plans/session-storage-and-skills-port.md
created_at: 2026-08-05
status: draft
approved: false
---

# CLI 数字彩菜单 + 模型提供商本地配置

> 本文为 my-agent 项目的设计与方案 spec。代码改动尚未开始，需通过本 spec 审批 + 后续 writing-plans 生成的实施计划批准后才进入实现阶段。

---

## 1. 背景与目标

### 1.1 现状

- `chat.ts` 当前通过 `DEEPSEEK_API_KEY` 环境变量硬编码使用 DeepSeek provider，没有运行时切换/配置能力。
- `~/.my-agent/` 目录已被 `.ai-runtime-artifacts/plans/session-storage-and-skills-port.md` 规划为 session 的存储根目录，但目前**还没有** providers 配置的概念。
- `src/providers/` 已实现 `DeepSeekProvider` 与 `ProviderRegistry`，但 CLI 没有任何机制让用户在运行时配置多个 provider。

### 1.2 用户故事

- **故事 1（核心）：** 用户克隆项目后第一次跑 `npx tsx chat.ts`，看到主菜单（带彩色数字），选 ② 进入设置，按提示填入 DeepSeek 的 API Key 和 Base URL，回主菜单选 ① 开始对话。
- **故事 2：** 用户想切换到自部署的 DeepSeek 兼容端点（不同 baseUrl），进入设置子菜单修改当前 provider 的 URL，保存后立即生效。
- **故事 3：** 用户想临时换一个 model（如 `deepseek-reasoner`），进入设置子菜单改 `defaultModel`，新会话立即使用。
- **故事 4：** 用户的 Key 留空，进入主菜单选 ①，系统主动提示「当前 provider 缺少 API Key，前往设置？」并跳转到设置子菜单。

### 1.3 目标

1. 提供一个**数字彩菜单**（ANSI 彩色数字）作为 CLI 启动入口。
2. 支持在**本地 JSON 文件**（`~/.my-agent/providers.json`）中维护一个或多个 provider 配置。
3. 首次启动**自动创建**默认配置（预填 DeepSeek，key 留空）。
4. 当前激活 provider 的 Key 留空时**主动引导**进入设置。
5. **不破坏**现有 `--load <id>` / `--list` 行为。

### 1.4 非目标（YAGNI）

- **不**实现 OpenAI 兼容 / Anthropic 等其他 provider 类（仅 DeepSeek；用户已确认）。
- **不**实现 Key 加密 / 引用环境变量（明文存 JSON + 文件权限 0600）。
- **不**实现多 provider 并行 / 聚合。
- **不**实现 Web UI / TUI 框架（如 Ink/Blessed）。
- **不**修改 `AgentRunner` 与 `ProviderRegistry` 主体逻辑（只改 chat.ts 装配方式）。

---

## 2. 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  chat.ts (启动入口)                                          │
│  ├─ 解析 CLI 参数（--load / --list）                         │
│  ├─ loadConfig("./config.json")                             │
│  ├─ loadProvidersStore() → 默认值/已有配置                   │
│  └─ 路由：                                                  │
│      --list   → 列出 sessions → 退出                         │
│      --load   → 跳过菜单，直进对话                            │
│      (默认)   → 进入主菜单                                    │
│                  ├─ ① 开始对话（若 key 为空 → 引导进设置）   │
│                  ├─ ② 设置（子菜单）                         │
│                  ├─ ③ 查看当前 provider                      │
│                  └─ ④ 退出                                   │
└─────────────────────────────────────────────────────────────┘
                │                       │
                ▼                       ▼
┌────────────────────────┐  ┌──────────────────────────────┐
│ src/cli/               │  │ src/storage/                  │
│  ├─ io.ts              │  │  ├─ providers-store.ts (新)   │
│  │   ANSI 颜色 + readline│  │  │  JSON 读写 + 原子写入       │
│  ├─ menu.ts            │  │  └─ ...                       │
│  │   主菜单渲染/路由     │  │                              │
│  └─ provider-menu.ts   │  │ 文件: ~/.my-agent/            │
│      设置子菜单+表单     │  │       providers.json         │
└────────────────────────┘  └──────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  src/providers/ (已存在，不改)                                │
│  DeepSeekProvider + ProviderRegistry                        │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 模块职责

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| `src/storage/providers-store.ts` | JSON 持久化、CRUD、原子写入、文件权限 | 不做 UI、不做 input |
| `src/cli/io.ts` | ANSI 颜色序列、readline 封装、prompt、confirm | 不做业务逻辑 |
| `src/cli/menu.ts` | 主菜单渲染、选单路由、对话衔接 | 不做表单 |
| `src/cli/provider-menu.ts` | 设置子菜单、表单字段、CRUD 调用 | 不做主菜单 |
| `chat.ts` | 启动装配、参数路由、对话主循环 | 不做菜单渲染/存储 |

---

## 3. 数据设计

### 3.1 文件路径

`~/.my-agent/providers.json`

- `~/.my-agent/` 目录与 `~/.my-agent/sessions/` 同级，沿用现有计划 ([session-storage-and-skills-port.md § 2.3](../plans/session-storage-and-skills-port.md))。
- 目录创建遵循 `Storage` 既有工具 `ensureDir`（参考 `src/storage/jsonl.ts`）。

### 3.2 Schema

```json
{
  "version": 1,
  "activeProviderId": "deepseek",
  "providers": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "type": "deepseek",
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com/v1",
      "defaultModel": "deepseek-chat",
      "enabled": true
    }
  }
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | `1` | ✅ | schema 版本号 |
| `activeProviderId` | string | ✅ | 当前激活 provider 的 id |
| `providers` | `Record<id, ProviderConfig>` | ✅ | id → 配置映射 |
| `providers[id].id` | string | ✅ | 全局唯一，与 map 键一致 |
| `providers[id].name` | string | ✅ | 用户可改的显示名 |
| `providers[id].type` | `"deepseek"` | ✅ | provider 类型（YAGNI：先只支持 deepseek） |
| `providers[id].apiKey` | string | ✅ | 允许空字符串（首次启动） |
| `providers[id].baseUrl` | string | ✅ | 完整 URL，含 `/v1` |
| `providers[id].defaultModel` | string | ✅ | 启动时使用的 model |
| `providers[id].enabled` | boolean | ✅ | 禁用后从菜单隐藏但保留配置 |

### 3.3 预填默认值（首次启动）

```json
{
  "version": 1,
  "activeProviderId": "deepseek",
  "providers": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "type": "deepseek",
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com/v1",
      "defaultModel": "deepseek-chat",
      "enabled": true
    }
  }
}
```

### 3.4 写入策略

- **首次创建：** 不存在文件 → 写入预填值，文件权限 `0o600`（POSIX）。
- **修改：** 写入临时文件 → `fs.rename` 原子替换（参考 `src/storage/jsonl.ts` 的 `atomicWrite`）。
- **读取：** `JSON.parse(fs.readFileSync(...))`；解析失败或 `version` 不匹配 → 备份文件为 `providers.json.bak-<timestamp>` 并返回默认配置 + 控制台黄色警告。
- **schema 校验：** 用 Zod 校验（`version` 必须为 `1`，否则视为损坏）。

---

## 4. CLI 视觉规范

### 4.1 数字彩菜单配色（6 色循环）

| 数字 | 颜色 | ANSI |
| --- | --- | --- |
| ① | 青色 | `\x1b[36m` |
| ② | 绿色 | `\x1b[32m` |
| ③ | 黄色 | `\x1b[33m` |
| ④ | 蓝色 | `\x1b[34m` |
| ⑤ | 紫色 | `\x1b[35m` |
| ⑥ | 红色 | `\x1b[31m` |
| ⑦+ | 循环回到 ① | — |
| 重置 | — | `\x1b[0m` |

**为什么不用 chalk：** 保持项目零运行时依赖（`package.json` 仅 `zod`）。

### 4.2 主菜单

```
┌─────────────────────────────────────────┐
│        🤖 My Agent — 主菜单              │
└─────────────────────────────────────────┘

   ① 开始对话
   ② 设置模型提供商
   ③ 查看当前提供商
   ④ 退出

请选择 (1-4): █
```

### 4.3 设置子菜单

```
┌─────────────────────────────────────────┐
│        ⚙️  模型提供商设置                  │
└─────────────────────────────────────────┘

当前: deepseek (DeepSeek) [启用]

   ① 列出所有提供商
   ② 修改当前提供商（Key / URL / 模型）
   ③ 切换当前提供商
   ④ 启用 / 禁用
   ⑤ 删除提供商
   ⑥ 返回上级

请选择 (1-6): █
```

### 4.4 表单（修改 provider）

```
── 修改 deepseek ──

  显示名称 [DeepSeek]: 
  API Key [***last3]: 
  Base URL [https://api.deepseek.com/v1]: 
  默认模型 [deepseek-chat]: 
  启用 (y/n) [y]: 

  [Enter] 保存   [Esc] 取消
```

**交互规则：**
- 每一项按 Enter 接受当前值（方括号内显示）；空输入 = 保留旧值。
- `*` 掩码显示现有 apiKey 的最后 3 位（不显示完整）。
- 输入非 `y/n` 时回退到默认值。
- 任意时刻按 Esc（`\x1b`）取消整个表单。

### 4.5 错误处理

| 场景 | 表现 |
| --- | --- |
| providers.json 损坏（JSON.parse 失败） | 备份为 `.bak-<ts>`，使用默认配置，控制台黄色警告 |
| 字段缺失或 `version` 不匹配 | 同上：备份 + 默认值 + 警告 |
| apiKey 为空但用户选 ① 开始对话 | 红色提示「⚠️ 当前 provider 缺少 API Key，是否进入设置？(y/n)」，回 y → 进入设置子菜单 |
| baseUrl 无效（不以 `http://` 或 `https://` 开头，或含尾部 `/`） | 保存前校验，红色提示「无效的 URL，应形如 https://.../v1」，回到表单 |
| 删除当前 active provider | 二次确认：`确认删除 "deepseek"？(y/n)`；确认后回退到第一个 enabled provider，否则报「没有可用 provider」 |
| active provider 被禁用 | 启动时回退到第一个 enabled provider；若无可用 → 强制进入设置子菜单 |
| apiKey 写入磁盘失败 | 红色提示「写入失败：<reason>」，回到表单不退出 |

---

## 5. chat.ts 改动

### 5.1 启动流程伪代码

```ts
const args = parseArgs(process.argv.slice(2));
const config = await loadConfig("./config.json");
const store = await ProvidersStore.load(); // 不存在则预填

if (args.list) {
  // 现有 SessionStore.list 逻辑
  process.exit(0);
}

if (args.load) {
  // 现有恢复会话逻辑
  // 跳过菜单，直接进对话
  await runChat({ config, store, sessionId: args.load });
  return;
}

// 默认：进主菜单
const choice = await mainMenu(store);
switch (choice) {
  case "start":
    await runChat({ config, store });
    break;
  case "settings":
    await providerMenu(store);
    // 设置后回到主菜单
    break;
  case "view":
    showCurrentProvider(store);
    break;
  case "quit":
    return;
}
```

### 5.2 启动时 key 引导

```ts
const active = store.getActiveProvider();
if (active && !active.apiKey) {
  const go = await io.confirm("⚠️ 当前 provider 缺少 API Key，是否进入设置？");
  if (go) {
    await providerMenu(store);
  }
}
```

### 5.3 与现有逻辑的兼容

- `[chat.ts:43-48]` 移除 `DEEPSEEK_API_KEY` 环境变量硬依赖。
- `[chat.ts:50-58]` 替换为读 `store.getActiveProvider()` 创建 `DeepSeekProvider`。
- `[chat.ts:134-163]` session 装载逻辑（`--list` / `--load` / 新建）保持不变。
- `[chat.ts:177-184]` `createRunner()` 接受新 `providers` 注入。
- `[chat.ts:191-347]` 对话主循环、`/help` 等命令保持不变。

---

## 6. 实施工作分解（建议 WU，切分给 writing-plans 阶段确认）

| WU | 内容 | 产出 | 估时 |
| --- | --- | --- | --- |
| **WU1** | `ProvidersStore`：Zod schema + JSON 读写 + 原子写入 + 默认值 | `src/storage/providers-store.ts` + 单测 | S |
| **WU2** | CLI `io` 工具：ANSI 颜色 + readline 封装 + prompt/confirm | `src/cli/io.ts` + 单测 | S |
| **WU3** | 主菜单 + 设置子菜单 + 表单 | `src/cli/menu.ts` + `src/cli/provider-menu.ts` | M |
| **WU4** | `chat.ts` 整合：装配 + 路由 + 引导 | 改 `chat.ts` | S |
| **WU5** | 端到端手动验证 + README 截图 | 手测 + 更新 README | XS |

**依赖：** WU1 → WU2 → WU3 → WU4 → WU5

---

## 7. 验收清单（Definition of Done）

### 7.1 功能

- [ ] 首次启动（`~/.my-agent/providers.json` 不存在）→ 自动创建预填 deepseek 的文件
- [ ] 主菜单数字 1-6 用 6 种颜色循环
- [ ] 设置子菜单可修改当前 provider 的 key / url / model
- [ ] 修改后立即落盘（原子写入）
- [ ] 切换当前 provider 后，对话使用新配置
- [ ] key 留空时启动主菜单选 ① 主动引导进入设置
- [ ] `--load <id>` 仍能跳过菜单进对话
- [ ] `--list` 仍能列出 sessions
- [ ] 损坏的 providers.json 不导致崩溃，备份 + 警告

### 7.2 质量

- [ ] `ProvidersStore` 单元测试覆盖：load 默认 / load 已有 / save 原子 / corrupt 恢复
- [ ] `io.ts` 单元测试：颜色输出 / prompt 输入
- [ ] `tsc --noEmit` 无错误
- [ ] `vitest run` 全绿
- [ ] 文件权限 0o600 验证（POSIX 系统）

### 7.3 文档

- [ ] `README.md` 更新使用说明（添加菜单截图）
- [ ] `.ai-runtime-artifacts/verifications/2026-08-05-cli-menu-and-provider-config-verification.md` 落盘

---

## 8. 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 配置文件损坏导致数据丢失 | 损坏文件备份为 `.bak-<ts>`；只丢未保存的当前表单 |
| Key 明文存储 | 文件 0o600；用户机器本地；不引入加密（YAGNI）；文档中提示 |
| 多 provider 切换的 `activeProviderId` 指向不存在 id | 启动时校验：若 active 不存在 → 回退到第一个 enabled provider |
| 当前 active provider 被禁用 | 启动时回退到第一个 enabled provider；若无 → 强制进入设置子菜单 |
| ANSI 颜色在 Windows cmd 不支持 | 检测 `NO_COLOR` 环境变量；terminal 不支持时降级为纯文本 |
| `chat.ts` 改造引入回归 | 现有单测（`test/agent-runner.test.ts` 等）必须仍通过；新增的手测包括 `--load` / `--list` 路径 |
| Esc 取消需要 raw mode，可能影响 prompt 渲染 | 仅在表单阶段切换 raw mode，使用 `\x1b` 监听；退格用单字符读取后立即恢复 |

---

## 9. References 检查

- [x] `harness-kit/entrypoints/HARNESS-PLATFORM-ENTRY.md`：项目背景（Harness 规则）
- [x] `harness-kit/core/routing.md`：路由判定（本文为 brainstorming 阶段）
- [x] `.ai-runtime-artifacts/plans/session-storage-and-skills-port.md`：复用 `~/.my-agent/` 路径
- [x] `src/providers/base.ts` / `registry.ts` / `deepseek.ts`：复用的 provider 抽象
- [x] `src/storage/jsonl.ts`：复用 `atomicWrite` / `ensureDir` 模式
- [x] `chat.ts`：被改造的入口
- [x] `package.json`：确认无运行时依赖需求（仅 zod + typescript 工具）

---

## 10. Next

**（写入后须暂停，等用户明确继续 — 见 `harness-kit/core/routing.md` § 阶段门禁）**

- 方案确认无误 → 说「**写计划**」或「**制定实施计划**」
- 范围小、无需计划 → 说「**直接实现**」或「**直接做**」
- 需要调整方案 → 直接说修改意见
