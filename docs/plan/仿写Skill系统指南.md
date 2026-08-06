# 仿写 Skill 系统 — 从零构建指南

> **承接**：[`仿写Agent框架指南.md`](./仿写Agent框架指南.md) **第三阶段**（路径 / 沙箱 / 存储）完成后，进入本指南。  
> **对应源码**：`src/core-agent/src/skills/`、`src/main/model/core-agent/skill-registry.ts`、`src/main/features/skills.ts`、`bin/run-skill.cjs`。  
> **设计蓝图**：[`架构文档/Skill系统实现指南.md`](./架构文档/Skill系统实现指南.md)；细节对照 [`skill/`](./skill/)。  
> **本文做什么**：把「my-agent 还不支持 Skill」补成可动手的仿写路径——读 Orkas → 自己写 → 测通。  
> **本文不做什么**：不复制业务代码；不展开群聊 bus / connector / KB；Evolution 自我进化 `SkillStore` 只在附录标明「勿混」。

---

## 学习策略

与 Agent 指南相同：**逐个模块边学边做，不要全看完再动手。**

每个模块的节奏：

1. 读 Orkas 源码（30–60 分钟）
2. 关掉源码，凭理解自己写（1–2 小时）
3. 跑通测试，对比差异

**正文写全量；任务分阶段验收。** 先 S1 闭环，再 S2 产品层，最后 S3 对齐 Orkas。

---

## 前置条件（第三阶段必须已完成）

| 前置模块 | 用途 |
|----------|------|
| `paths.ts` 路径收口 | `userSkillsDir` / `userMarketplaceSkillsDir` / … 全部走命名函数 |
| `isPathAllowed` 沙箱 | `read_file` SKILL.md、写自定义 skill 文件前校验 |
| `storage.ts` 原子写 | `writeTextAtomicSync` 写 SKILL.md；CRUD 后失效缓存 |
| Runner + `read_file` / `bash`（第四阶段可并行） | 菜单注入后，LLM 靠既有文件工具读正文、靠 bash 调 run-skill |

第三阶段结束时，my-agent 已有持久化与路径闸；**缺的是「能力说明书」发现与执行管线**——本指南补上。

> Agent 指南里 **第四阶段（工具）**、**第五阶段 §5.4（Skill 概览）** 可与本指南并行。§5.4 只是速查；**动手写以本文为准**。

---

## 项目骨架扩展

在既有 `my-agent/` 上增加：

```
my-agent/
├── src/
│   ├── shared/ …          # 已有
│   ├── config/ …          # 已有
│   ├── providers/ …       # 已有
│   ├── tools/ …           # 已有（read_file / bash）
│   ├── agent/ …           # 已有 runner
│   ├── paths.ts           # 第三阶段
│   ├── storage.ts         # 第三阶段
│   ├── util/
│   │   └── path-sandbox.ts
│   └── skills/            # ← 本指南新增
│       ├── types.ts
│       ├── frontmatter.ts
│       ├── loader.ts
│       ├── registry.ts    # S2
│       ├── prompt.ts      # S2（或并入 registry）
│       ├── crud.ts        # S2
│       ├── gating.ts      # S2
│       └── index.ts
├── bin/
│   └── run-skill.cjs      # S1.7 起
├── fixtures/
│   └── skills/            # 测试用 SKILL.md 树
├── test/
└── …
```

---

## 完整依赖图（Skill 子系统）

```
                    ┌──────────────────────┐
                    │  agent/runner        │  注入 ## Available skills
                    │  + read_file / bash  │  读正文 / 调 run-skill
                    └──────────┬───────────┘
           ┌───────────────────┼───────────────────┐
           │                   │                   │
    ┌──────┴──────┐   ┌───────┴───────┐   ┌──────┴──────┐
    │ skills/     │   │ skills/       │   │ bin/        │
    │ registry    │   │ crud + gating │   │ run-skill   │
    └──────┬──────┘   └───────┬───────┘   └──────┬──────┘
           │                   │                   │
           └───────────────────┼───────────────────┘
                               │
                      ┌────────┴────────┐
                      │ skills/loader   │  扫盘 + frontmatter
                      └────────┬────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────┴──────┐  ┌─────┴─────┐  ┌──────┴──────┐
       │ frontmatter │  │  paths    │  │ path-sandbox│
       └─────────────┘  └───────────┘  └─────────────┘
```

**关键不变式：** Skill **不是** SDK `tools[]` 里的新函数。Registry 只注入菜单；正文靠 `read_file`；脚本靠统一 `run-skill` 入口。

---

# 📐 仿写路线图

| 阶段 | 目标 | 产出 | 验收一句话 |
|------|------|------|------------|
| **S0** | 概念纠偏 | 心智模型 | 能向别人讲清「Skill ≠ tool」 |
| **S1** | 核心闭环 | Loader + 最小 Prompt + run-skill | 放一个带脚本的 skill，LLM 能读说明书并跑通脚本 |
| **S2** | 产品层 | 分层 / 门控 / CRUD / 缓存 / skill_search | 自定义增删改即时进菜单；session 可见性矩阵测过 |
| **S3** | 全量对齐 | marketplace/system/runtime/编辑协议 | 行为与 Orkas 文档矩阵一致 |

---

# S0：概念纠偏（动手前必读）

## S0.1 一句话定义

**Skill = 含 `SKILL.md` 的目录（+ 可选 `scripts/`）。**  
LLM 在 system prompt 里看到菜单 → `read_file(<ROOT>/<id>/SKILL.md)` → 按步骤用内置工具或 `run-skill`。

```
用户发消息
  → Runner 注入 ## Available skills（名称 + 短描述 + ROOT）
  → LLM 判断匹配
  → read_file(.../SKILL.md) 加载说明书正文
  → 按步骤执行（工具 或 run-skill）
  → 结果回用户
```

**全文从不自动全量注入**到每个 agent 上下文。菜单轻、正文按需。

## S0.2 Skill vs Agent vs Tool

| | Skill | Agent | SDK Tool |
|---|---|---|---|
| 角色 | 能力说明书包 | 有 workflow 的角色 | 进程内可调用函数 |
| 文件 | `SKILL.md` + 可选 scripts | `agent.json` + 可选 private_skills | `defineTool()` 代码 |
| Prompt | `## Available skills` | `## Agents` | `tools[]` schema |
| 调用 | 读说明书 / run-skill | 群聊派发 | 模型直接 tool_use |

## S0.3 四条硬决策（写错架构就返工）

### 1. Skill 是说明书，不是可执行包注册表

```
✅ Skill = SKILL.md + 可选 scripts/
❌ Skill = 每个技能注册一个新 AgentTool / API endpoint
```

### 2. id ≠ name

- **id** = 目录名（marketplace 常为服务端 hex，如 `ee99fbb42964`）
- **name** = frontmatter 展示名（如 `deep-research`）

永远不要把二者重新耦合。Prompt 在 `name !== id` 时必须标 `internal read id`。

### 3. 发现与执行优先级故意不对称

| | 发现（list / prompt） | 执行（run-skill 找脚本） |
|---|---|---|
| 同 id 冲突 | **marketplace 先**（先到先得） | **custom 先** |
| 为何 | 产品/平台覆盖同名自定义展示 | 用户改过的脚本应盖住平台原版 |

这不是 bug。

### 4. 三层来源不要混

| 层 | 是什么 | Prompt |
|----|--------|--------|
| **TRUSTED** | marketplace + cloud 自定义 | `## Available skills`；可进 `skill_list` |
| **System** | 产品协议（skill-creator 等） | 独立 `## System skills`；仅特定 session |
| **OPEN** | 外部包 + `~/.claude` / `~/.codex` | external 可内联；global **永不整表注入**，靠 `skill_search` |

---

# S1：核心闭环（my-agent 首次具备 Skill）

**目标：** 本地放一个 skill 目录 → 菜单出现 → `read_file` 读到正文 → `run-skill` 跑通脚本。

**S1 模块总览：**

| # | 模块 | 产出文件 | 你需要定义的 |
|---|------|----------|--------------|
| S1.1 | Frontmatter 解析 | `skills/frontmatter.ts` | `parseFrontmatter`、引号/块标量 |
| S1.2 | SkillSpec | `skills/types.ts` | `SkillSpec`、`pickDescription` |
| S1.3 | 路径扩展 | `paths.ts` 增补 | `userSkillsDir` 等 |
| S1.4 | SkillLoader | `skills/loader.ts` | `list` / `invalidate` / mtime 缓存 |
| S1.5 | 最小 Prompt | `skills/prompt.ts` | ROOT 内联菜单 |
| S1.6 | Runner 接线 | `agent/runner.ts` | 拼 system prompt；沙箱含 skill 根 |
| S1.7 | run-skill | `bin/run-skill.cjs` | 定位脚本 + py/js 分派 |

**依赖：** S1.1 → S1.2 → S1.3 → S1.4 → S1.5 → S1.6 → S1.7

---

## S1.1 Frontmatter 解析器

**对应源码：** `src/core-agent/src/skills/frontmatter.ts`

### 为何自己写

core-agent 刻意少依赖；真实 SKILL.md 只用顶层标量 + 偶发 `|` / `>` 块。上完整 YAML 库过重，且易在未知嵌套上行为飘忽。

### SKILL.md 格式规范

```markdown
---
name: my-skill-name
description_zh: "中文描述：做什么；适合\"…\"；触发词：a、b"
description_en: "English description: what it does; use when \"…\"; triggers: a, b"
category: data
ownerAgent: agent-id-here
---

# Skill 正文

## When to use
...

## How to call
...

## Scripts (if any)
...
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 展示名；菜单与 `skill_list` 引用 |
| `description` | 旧版兼容 | 仅此字段时按是否含 CJK 迁到 zh/en |
| `description_zh` / `description_en` | 推荐 | 三段式：功能 + 适合「原话」+ 触发词 |
| `category` | 推荐 | 分类码 |
| `ownerAgent` | 可选 | 仅该 agent 可见（S2） |

**描述三段式（派发匹配用）：**

```
[功能一句话]；适合"[用户原话1]" "[用户原话2]"；触发词：词1、词2
```

### 接口与骨架

```ts
// src/skills/frontmatter.ts
export interface FrontmatterParseResult {
  data: Record<string, string>;
  body: string;
}

/**
 * 最小 YAML frontmatter：
 * - 支持 "…" / '…'；双引号容忍常见转义
 * - 支持 | 字面量块、> 折叠块（含可选 chomp/indent 指示符）
 * - 跳过空行、# 注释；跳过无冒号行、嵌套/列表（不解析）
 * - 未闭合 --- → 整篇当正文，不抛错
 * - 无前导 --- → { data: {}, body: text }
 */
export function parseFrontmatter(text: string): FrontmatterParseResult {
  // 快路径：首行不是 ---
  // 找闭合 ---；未找到 → 当正文
  // 逐行：key: value | 块标量收集 | 去引号
  // return { data, body }
}
```

### 仿写步骤

1. 读 Orkas `frontmatter.ts`（约 120 行），记下块标量缩进剥离算法。
2. 写 fixture：无 frontmatter、未闭合、双引号含冒号、`description: |` 多行、含 `#` 注释。
3. 自己实现；对照 fixture。

### 验收测试（必须覆盖）

| 输入形态 | 期望 |
|----------|------|
| 无 `---` | `data={}`，`body` 原样 |
| 未闭合 `---` | 当正文，不抛 |
| `name: foo` | `data.name === "foo"` |
| `description: "a: b"` | 值含冒号 |
| `description: \|` + 缩进多行 | 保留换行 |
| `description: >` + 多行 | 空格折叠；空行→换行 |
| `# comment` | 忽略 |
| `- item` 列表行 | 忽略（不进 data） |

### 踩坑

- 只剥匹配的成对引号；残缺引号原样保留，避免「聪明」纠错改语义。
- 块标量结束条件是**缩进 ≤ key 行缩进**的非空行，不是空行（空行要收进块）。
- 未知键原样保留（S2 的 `ownerAgent` / 未来字段靠这个）。

**代码量：** ~120 行。

---

## S1.2 SkillSpec 与描述选取

**对应源码：** `src/core-agent/src/skills/types.ts`

```ts
// src/skills/types.ts
export interface SkillSpec {
  id: string;              // 目录 basename
  name: string;            // frontmatter name || id
  description_zh: string;
  description_en: string;
  dir: string;             // skill 根绝对路径
  skillFile: string;       // SKILL.md 绝对路径
  source: string;          // 来自哪个 loader 根
  ownerAgent?: string;     // S2；S1 可先解析但不门控
}

export interface SkillLoaderOptions {
  /** 优先级从高到低；同 id 先到先得 */
  dirs: string[];
}

/** zh* → 优先 zh 回退 en；其它 → 优先 en 回退 zh */
export function pickDescription(
  spec: { description_zh?: string; description_en?: string },
  lang: string,
): string { /* … */ }
```

### 旧版 `description` 迁移（在 Loader.parseSpec 里做）

```ts
const legacy = normalize(data.description);
const hasCjk = /[一-鿿]/.test(legacy);
// 显式 description_zh/en 永远优先于 legacy
description_zh = explicitZh || (legacy && hasCjk ? legacy : "") || sidecarZh;
description_en = explicitEn || (legacy && !hasCjk ? legacy : "") || sidecarEn;
```

可选 `_meta.json` 侧车：Orkas 用它补双语描述；S1 建议支持读取，字段缺失当 `{}`。

### 验收

- 仅 `description: "分析数据"` → `description_zh` 有值、`description_en` 空
- 仅 `description: "Analyze data"` → 落入 `_en`
- `pickDescription(spec, "zh-CN")` / `"en-US"` 回退正确

**代码量：** ~60 行。

---

## S1.3 路径布局扩展（承接 3.1）

**对应源码：** `src/main/paths.ts` 中 skill 相关函数。

在第三阶段 `paths.ts` 增加（**禁止**缓存带 uid 的模块级常量）：

```ts
// 示意 — 全部接受 uid，用时再取
export const userSkillsDir = (uid: string) =>
  path.join(userCloudRoot(uid), "skills");

export const userMarketplaceSkillsDir = (uid: string) =>
  path.join(userLocalRoot(uid), "marketplace", "skills");

export const userSystemSkillsDir = (uid: string) =>
  path.join(userLocalRoot(uid), "system", "skills");

export const agentPrivateSkillsDir = (uid: string, agentId: string) =>
  path.join(userAgentsDir(uid), assertAgentSegment(agentId), "private_skills");

export const globalSkillRoots = (): string[] => [
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".codex", "skills"),
];
```

### S1 磁盘最小布局

```
<data-root>/<uid>/
├── cloud/
│   └── skills/
│       └── hello-skill/
│           ├── SKILL.md
│           └── scripts/
│               └── main.py   # 或 main.js
└── local/
    └── marketplace/
        └── skills/           # S1 可先空；S3 再 seed
```

`ensureUserLayout(uid)` 创建 `cloud/skills`（及后续 marketplace/system）。

### 硬约束（与 CLAUDE.md 一致）

- uid 不透明，不解析、不嵌入 session id
- 项目归属是 conversation 索引，**不要**编进 skill 路径
- id 进 `path.join` 前 assert：无 `/` `\` `..` `\0`

### 验收

- 切换 uid 后 `userSkillsDir` 指向新树
- 非法 `agentId` 抛错

---

## S1.4 SkillLoader

**对应源码：** `src/core-agent/src/skills/loader.ts`

### 职责

- 扫描 `dirs` 的**直接子目录**
- 含 `SKILL.md` 则解析 **frontmatter only**
- 同 id **先到先得**
- 按目录 mtime 缓存；`invalidate()` 丢缓存

### 骨架

```ts
// src/skills/loader.ts
export class SkillLoader {
  private readonly dirs: string[];
  private cache: { stamp: string; skills: SkillSpec[] } | null = null;

  constructor(opts: SkillLoaderOptions) {
    this.dirs = [...opts.dirs];
  }

  list(): SkillSpec[] {
    const stamp = this.dirStamp();
    if (this.cache?.stamp === stamp) return this.cache.skills;

    const seen = new Map<string, SkillSpec>();
    for (const dir of this.dirs) {
      if (!isDir(dir)) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        log.warn(`failed to read ${dir}: ${(err as Error).message}`);
        continue;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        // 符号链接：Dirent.isDirectory() 为 false，需 stat 跟随
        const skillDir = path.join(dir, e.name);
        if (!e.isDirectory() && !(e.isSymbolicLink() && isDir(skillDir))) continue;
        const skillFile = path.join(skillDir, "SKILL.md");
        if (!fs.existsSync(skillFile)) continue;
        if (seen.has(e.name)) continue;
        const spec = this.parseSpec(skillDir, skillFile, dir);
        if (spec) seen.set(e.name, spec);
      }
    }
    const skills = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
    this.cache = { stamp, skills };
    return skills;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** S1 可用；生产 Orkas 用 registry 渲染，见 S2 */
  renderSystemPromptBlock(lang = "en"): string { /* 简易版 */ }

  private dirStamp(): string {
    return this.dirs
      .map((d) => {
        try {
          return `${d}:${fs.statSync(d).mtimeMs}`;
        } catch {
          return `${d}:missing`;
        }
      })
      .join("|");
  }
}
```

### S1 推荐 dirs 顺序（发现层）

```ts
new SkillLoader({
  dirs: [
    userMarketplaceSkillsDir(uid), // 高优先级
    userSkillsDir(uid),            // 自定义
  ],
});
```

### 踩坑（极重要）

1. **只改 SKILL.md 内容往往不改父目录 mtime（POSIX）** → CRUD / 写入后必须显式 `invalidate()`，不能只靠 stamp。
2. 全局 skill 常是 symlink → 必须 `stat` 跟随，否则列表静默丢技能。
3. **只缓存元数据，不缓存正文** — 正文永远磁盘现读。
4. 目录不可读：warn + skip，不要让整次 list 崩溃。

### 验收

| 场景 | 期望 |
|------|------|
| 两根同 id | 返回先出现的那份（marketplace） |
| 连续两次 list 无变更 | 第二次不重扫（可用 spy） |
| invalidate 后 | 重扫 |
| symlink 子目录 | 出现在列表 |
| 无 SKILL.md 子目录 | 跳过 |
| 隐藏 `.foo` | 跳过 |

**代码量：** ~200 行。

---

## S1.5 最小 Prompt 注入

**对应源码（生产）：** `skill-registry.ts::renderSkillLines` / `getSystemPromptBlock`  
**S1：** 先实现「能用的菜单」；Source 标签可简化为 `custom` / `marketplace`。

### 正确形态（学 Orkas 经验）

```
## Available skills (skills)

`read_file(<ROOT>/<id>/SKILL.md)` — ROOT by Source:
- custom: /abs/path/to/<uid>/cloud/skills
Use these ROOT values verbatim. `<id>` is the internal read id for read_file paths only, even when it differs from display name.
These entries are skills, not tool names: read SKILL.md and follow it; never call the display name or id as a tool. Never mention skill ids in plans, workflows, progress, or final replies.

- **hello-skill** (Source: custom) — 打印 hello；适合"试一下 skill"；触发词：hello
```

当 `name !== id`：

```
- **deep-research** (Source: builtin; internal read id: ee99fbb42964) — …
```

### 设计细节（S1 就要遵守）

1. **ROOT 绝对路径内联在菜单上方** — 不要单独一节 `## Resource locations`；LLM 会忽略分离常量并编造假路径。
2. **不要写否定反例路径**（如 `do NOT use /data/custom/skills/`）— 模型可能复制反例。
3. 条目是 skill 不是 tool name — 写进固定说明句。
4. 描述压缩：S1 可先 `slice(0, 240)`；S2 再做「在适合/触发词处截断」。

### 与 Loader 默认 `renderSystemPromptBlock` 的关系

core-agent Loader 自带简易渲染（用 `basename(source)` 当 Source）。**Orkas 生产不用它**，因为两个根都以 `/skills` 结尾时 basename 冲突。S1 若只有 custom 一根可用简易版；**一上 marketplace 就必须按根路径算 Source（S2）**。

### 验收

- 菜单含绝对 ROOT
- `name !== id` 时有 `internal read id`
- 无 skill 时返回空字符串（不注入空壳标题也可，二选一但要测）

---

## S1.6 Runner / 沙箱接线

### Runner

在构造 system prompt 时追加 S1.5 块（evolution 引导若有，Skill 产品菜单与之分开，见附录）。

```ts
const skillBlock = buildAvailableSkillsBlock(uid, lang);
const systemPrompt = [basePrompt, skillBlock].filter(Boolean).join("\n\n");
```

### 沙箱允许根

`read_file` 必须能读到 skill 根，否则菜单等于摆设：

```ts
// allowedRoots 扩展
roots.push(userSkillsDir(uid));
roots.push(userMarketplaceSkillsDir(uid));
// S2+：system / packages / 当前编辑 skill 目录 / private_skills
```

仍走第三阶段 `isPathAllowed`（realpath 两侧 + `startsWith(root + sep)`）。

### 禁用绕过（S2 完整做；S1 可先记）

Orkas：`guardDisabledSkillAccess` 在 `read_file` 上检查路径是否属于已禁用 skill_id，防止只靠读 SKILL.md 绕过 UI 禁用。

### 验收

- 集成测：system prompt 含 `## Available skills`
- `read_file(<customRoot>/hello-skill/SKILL.md)` 成功
- 读 `/etc/passwd` 仍被沙箱拒绝

---

## S1.7 run-skill 最小执行器

**对应源码：** `bin/run-skill.cjs`（CommonJS，无 import 钩子体操）

### 调用约定（经 bash 工具）

```bash
"$MY_NODE" "$APP_DIR/bin/run-skill.cjs" <skill-id-or-name> <script-basename> [-- args...]
```

LLM 只学这一种形式，不关心脚本是 py 还是 js。

### S1 最小行为

1. 解析 argv；`scriptBase` **禁止**含 `/` `\` 或 `.` `..`
2. 在 custom → marketplace 顺序下找 `scripts/<base>.<ext>`
3. 扩展名尝试顺序：
   - Windows：`py, ts, mjs, js, ps1, cmd, bat, sh, rb`
   - 其它：`py, ts, mjs, js, sh, rb, ps1`
4. `.js`：`require` + 调 `default` export  
5. `.py`：spawn `python3` / Windows `py -3`（S1 可先系统 Python；S3 再 venv）
6. 失败：stderr 打 JSON `{ ok:false, error, searched? }`，非零退出

### Node 脚本约定

```ts
// scripts/main.js  (CJS 可用 module.exports = async function…)
export default async function (args: {
  args: string[];
  skillId: string;
  skillDir: string;
}): Promise<unknown> {
  // 返回 undefined → 脚本已自行写 stdout
  // 返回值 → run-skill JSON.stringify 到 stdout
  return { ok: true, hello: "world" };
}
```

### 执行层搜索顺序（与发现层不对称！）

```
1. cloud/skills/<id>/scripts/…          ← custom 优先
2. local/marketplace/skills/<id>/scripts/…
3. （S2+）agent private / packages / global
4. 按 frontmatter name 回退（id 对不上展示名时）
```

### Fixture 示例

`fixtures/skills/hello-skill/SKILL.md`：

```markdown
---
name: hello-skill
description_zh: "打印问候；适合\"试一下 skill\"；触发词：hello、你好"
description_en: "Print a greeting; use when trying skills; triggers: hello"
category: demo
---

# Hello Skill

1. Call run-skill with script `main`.
2. Report the JSON result to the user.
```

`scripts/main.py`：

```python
import json, sys
print(json.dumps({"ok": True, "msg": "hello from skill"}))
```

### 验收

| 场景 | 期望 |
|------|------|
| `run-skill.cjs hello-skill main` | stdout 含 ok |
| `scriptBase=../x` | exit 64，JSON error |
| 仅 marketplace 有脚本、custom 同 id 无脚本 | 跑到 marketplace |
| custom 与 marketplace 同 id 都有脚本 | **跑 custom 版** |
| 缺少脚本 | JSON error + searched 列表 |

**代码量：** S1 精简版 ~150–250 行；Orkas 全量 ~600+ 行。

---

## S1 总验收清单

- [ ] 解析器 fixture 全绿
- [ ] Loader 扫描 + 缓存 + symlink + 先到先得
- [ ] 菜单含绝对 ROOT；可被 runner 注入
- [ ] `read_file` 沙箱含 skill 根
- [ ] `run-skill` 跑通至少一种语言（建议 py + js 各一）
- [ ] 文档/注释写明：发现 marketplace 先、执行 custom 先

**过线标准：** 人工或脚本模拟「注入菜单 → 读 SKILL.md → run-skill」三步无需改 runner 主循环结构。

---

# S2：产品层

**目标：** 分层、门控、白名单、禁用、CRUD、缓存失效、`skill_search`——接近可给真实用户用的 Skill 产品面。

---

## S2.1 TRUSTED / System / OPEN

```
┌─────────────────────────────────────────────────┐
│                  Prompt 注入                       │
├─────────────────┬─────────────────┬──────────────┤
│  TRUSTED        │  System         │  OPEN        │
│  marketplace +  │  skill-creator  │  external 内联│
│  custom         │  等协议         │  global 靠搜索│
│  ## Available   │  ## System      │              │
└─────────────────┴─────────────────┴──────────────┘
```

| 子类 | 运行时路径 | Source 标签 |
|------|------------|-------------|
| builtin | `local/marketplace/skills/<id>/` + `_install.json.seed_source=builtin` | `builtin` |
| platform | 同上，非 builtin | `platform` |
| custom | `cloud/skills/<id>/` | `custom` |
| system | `local/system/skills/<name>/` | （独立块，不进 Available） |
| external | `local/packages/…` | `external` |
| global | `~/.claude/skills` 等 | `global` |

**展示名去重优先级：**

```
builtin (0) > platform (1) > custom (2) > external (3) > global (4)
```

同优先级、不同 id 的同名 skill **都保留**（平台之间不去重）。

**marketplace vs system 为何拆开：** 见 [`skill/marketplace-vs-system.md`](./skill/marketplace-vs-system.md)。一句话：marketplace = 可安装能力；system = 创作协议，不进管理面板、不跟安装态绑死。

---

## S2.2 SkillRegistry

**对应源码：** `src/main/model/core-agent/skill-registry.ts`

### 职责

1. 多根组装：TRUSTED 单例 Loader、OPEN Loader、agent-private Loader 缓存
2. Source 标签（按**根绝对路径** + `_install.json`，不用 basename）
3. Prompt 渲染（Available + System）
4. `resolveSkillAllowlistRefs`
5. `skill_search`（仅 global）
6. `invalidateSkills()`

### Loader 句柄

```ts
// TRUSTED：uid 变则重建；dirs = [marketplace, custom]
let _loaderPromise: Promise<SkillLoader> | null = null;

// OPEN：目录集合 signature 变则重建
let _openLoader: { signature: string; loader: SkillLoader } | null = null;

// Agent private：Map<root, SkillLoader>
```

### `invalidateSkills()` 触发面

- 自定义 skill 创建/更新/删除/写文件
- marketplace / system reconcile
- `activateUser` 切换用户
- 任何会改 SKILL.md 或目录树的路径

**实现：** 清 OPEN 句柄、清 private map、`trusted.invalidate()`、（若有）UI 列表缓存一并清。

---

## S2.3 Prompt 渲染完整规则

在 S1.5 基础上：

| 规则 | 说明 |
|------|------|
| Trusted ROOT 行始终输出 | 稳定 prompt cache 前缀 |
| external/global ROOT | 仅当本块出现对应条目时才输出 |
| `includeOpenSources` | 非白名单模式：内联 external；**不**整表列 global；末尾加 skill_search hint |
| 白名单模式 | 不内联 OPEN |
| 描述 | 最短约 16、最长约 240；在「适合/触发词/use when/triggers」处分段截断 |
| System 块 | 独立 `## System skills`；说明是 product protocols |

Global hint 固定文案思路：

```
More skills may be available from your global skill folders — these are NOT listed above.
Call skill_search with a capability query, then read_file the returned SKILL.md path.
```

---

## S2.4 Session-kind 门控

**对应源码：** `runner.ts` 中 `systemSkillsExposureFromSessionId` / `openSkillSourcesExposureFromSessionId`

Session id：`<kind>-<tail>`。

| kind | System | OPEN | TRUSTED | 典型用途 |
|------|:---:|:---:|:---:|----------|
| `gconv` | ✅ | ✅ | ✅ | 群聊指挥官 |
| `gmember` | ❌ | ✅ | ✅ | Agent worker |
| `agent` | ✅ | ✅ | ✅ | 编辑 Agent |
| `skill` | ✅ | ❌ | ✅ | 编辑 Skill |
| 其它 | ❌ | ❌ | ✅ | one-shot / reflect / … |

```ts
export function systemSkillsExposureFromSessionId(sessionId: string): boolean {
  return /^gconv-/.test(sessionId)
      || /^agent-/.test(sessionId)
      || /^skill-/.test(sessionId);
}

export function openSkillSourcesExposureFromSessionId(sessionId: string): boolean {
  return /^(gconv|gmember|agent)-/.test(sessionId);
}
```

### 验收：矩阵表每个格子写集成测试

不要只测 happy path；至少 `gmember` 不见 System、`skill` 不见 OPEN。

---

## S2.5 `agent.skill_list` 白名单

| `skill_list` | 含义 |
|--------------|------|
| 字段缺失 | 不过滤：TRUSTED 全集（再减 disabled） |
| `[]` | 明确零 skill |
| `["seo-crawl", "ee99…"]` | 白名单；支持 id 或 name |

```ts
function resolveSkillAllowlistRefs(
  specs: SkillSpec[],
  refs: string[],
): { ids: string[]; unknown: string[] } {
  // byId 精确；byName 同名按 Source 优先级取第一个
  // 未知进 unknown；启动期可选择拒绝 unknown
}
```

**项目绑定（若有）：** `renderAllowlist = intersect(skillList, projectAllowedSkillIds)`。

---

## S2.6 禁用与 `ownerAgent`

### 用户禁用

`component-enabled` 只存 `false`。渲染前从列表剔除；**即使在白名单也剔除**。  
`read_file` 路径侧再防绕过（S1.6）。

### `ownerAgent`

- frontmatter `ownerAgent: <agent_id>`
- 仅 `opts.agentId === ownerAgent` 时保留
- **在展示名去重之后**再过滤，避免私有条目挡住同名共享 skill
- 不出现在 UI 管理列表

---

## S2.7 `skill_search`

- **只搜 global**（TRUSTED 已在菜单；external 已内联）
- 返回：`name, id, source, read_path, description`
- 打分：name/description 词重叠，name 权重更高
- 过滤：disabled、与 TRUSTED 同 id
- 空 query：按名排序的有界列表
- 中文无结果时可提示换英文关键词（prompt 层）

工具仅对需要 OPEN 的 session 暴露（与门控一致）。

---

## S2.8 缓存三层

| 层 | 位置 | 策略 |
|----|------|------|
| 1 | SkillLoader | `dir:mtimeMs` stamp |
| 2 | Registry 句柄 | TRUSTED 单例 / OPEN signature / private Map |
| 3 | UI `features/skills.ts` | 内存列表 + 可选磁盘 catalog + 短 trust 窗口 |

**记住：** 文件内容变 ≠ 目录 mtime 变 → 写路径必须 `invalidate`。

---

## S2.9 自定义 Skill CRUD

**对应源码：** `src/main/features/skills.ts`

### 名称规则

```ts
const SKILL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
// 自定义目录名常用可读 name；marketplace 用 hex id
```

### 创建

1. 校验名称  
2. `cloud/skills/<name>/` 不存在  
3. 不与 marketplace **同展示名**冲突（避免藏平台技能）  
4. 写 SKILL.md + 可选 `_meta.json`  
5. `invalidate*`  

### 更新 / 重命名

- 改 name 且需 rename：校验 → `renameSync` 目录 → 迁移编辑会话（若有）→ invalidate  
- SKILL.md 用原子写  

### 删除

- 删目录树  
- 清关联编辑 session  
- invalidate  

### 导入（URL/目录）

- ≤200 文件 / ≤10MB  
- 黑名单：系统盘、`.ssh` / `.aws`、自身 data 根等  
- 过滤 `.git` / `node_modules` / `__pycache__` / `.venv`  
- 有 SKILL.md → 安装；无 → 可编辑草稿  
- `validateSkillDir` 不通过则拒绝  

### 写文件 `writeCustomSkillFile`

- 相对路径不得逃出 skill 根（接 `isPathAllowed`）  
- 写 SKILL.md 时规范化 frontmatter  
- 成功后 invalidate  

---

## S2.10 System 块（最小可用）

S2 可先：

1. 固定目录 `userSystemSkillsDir(uid)` 放 1–2 个协议 skill（可从仓库 fixtures 拷）  
2. `systemSkillsExposureFromSessionId` 为真时渲染 `## System skills`  
3. 不进 UI 列表、不进 `skill_list`  

完整 seed/reconcile 放到 S3。

---

## S2 总验收清单

- [ ] Source 标签按根路径，不靠 basename  
- [ ] 展示名去重优先级测过  
- [ ] Session 门控矩阵测过  
- [ ] `skill_list` 三态 + unknown  
- [ ] 禁用后菜单与 read_file 双闸  
- [ ] ownerAgent 去重后再滤  
- [ ] CRUD 后下一轮 list/prompt 立即反映  
- [ ] `skill_search` 只碰 global  

---

# S3：全量对齐 Orkas

**目标：** marketplace/system 生命周期、捆绑运行时、编辑协议、`private_skills`、与宿主边界清晰。

---

## S3.1 Marketplace 安装模型

- 服务端目录模型：安装到 `local/marketplace/skills/<server-id>/`  
- `<server-id>` 不透明 hex；展示名在 frontmatter  
- `_install.json`：`version`、`published_at`、`seed_source: "builtin"|"platform"` …  
- 云端 `installs.json` 协调跨设备；**PC 不写** Server 侧 `private/.../manifest.json`  

同 id：发现层 marketplace 盖 custom；执行层仍 custom 脚本优先。

---

## S3.2 System Skill reconcile

| | marketplace | system |
|---|---|---|
| 仓库种子 | `resources/builtin/marketplace/skills/` | `resources/builtin/system/skills/` |
| 运行时 | `local/marketplace/skills/` | `local/system/skills/` |
| 目录名 | hex id | 可读名（无服务端发号） |
| UI | 可装可卸（产品能力） | **不出现**在管理面板 |

启动/登录：seed → 用户本地镜像。运行时平台代码 **禁止** `import` 仓库 builtin 当业务依赖；只扫运行时路径。

至少包含：`skill-creator`、`agent-creator`、`package-installer`（以产品为准）。

---

## S3.3 捆绑运行时与 venv

对照 [`skill/runtime/README.md`](./skill/runtime/README.md)。

| 层 | 位置 | 作用 |
|----|------|------|
| 1 捆绑运行时 | `resources/runtime/{python,uv,node}` | 钉版本 |
| 2 共享依赖 | `<data-root>/venv/` | 跨账号缓存；升级 App 不冲掉 |
| 3 子进程 env | `buildSkillSandboxEnv` | 注入 `ORKAS_*`；**不污染**主进程 |

### 关键环境变量

| 变量 | 含义 |
|------|------|
| `ORKAS_PC_DIR` / `APP_DIR` | App 根 |
| `ORKAS_NODE` | Electron-as-Node 跑内部脚本 |
| `ORKAS_PYTHON` / `ORKAS_UV` | 捆绑解释器 |
| `ORKAS_WORKSPACE_ROOT` | 数据根 |
| `ORKAS_UID` / `ORKAS_AGENT_ID` | 解析 skill 根范围 |
| `ORKAS_RUN_SKILL_DIR` | 可选：强制只在该 skill 目录解析 |
| `ORKAS_VENV_ROOT` | 共享 venv |

### Python 解析顺序（对齐 Orkas）

1. 包级共享 venv（name+repo+commit 键）  
2. 自 skill 目录向上最多 3 层 `.venv`  
3. `ORKAS_PYTHON`  
4. 系统 `python3` / `py -3`  

### Prompt 约定

声明 python/uv/node/npm/npx 为内置；**禁止** brew/apt/curl 另装运行时；库版本不够则说明并停止。

---

## S3.4 Skill 编辑会话协议

Agent 指南 §5.4.5 概览；仿写时注意：

- 编辑块白名单：`<<<skill-file`、`<skill-meta`、`<skill-as-package`、`<skill` 等 **固定 leader**  
- 其它 `<<<` 开头一律不解析（防模型发明协议）  
- `path` 相对 skill 根；删除走 `delete_file` + UI 确认，不靠编辑块  
- 树视图忽略：`.git`、`node_modules`、`.venv`、`_install.json`、`_meta.json` …  

Session kind `skill-`：System ✅、OPEN ❌；并常把**当前编辑目录**放进 `extraRoots`。

---

## S3.5 Agent `private_skills` 与 `skill_list`

```
cloud/agents/<aid>/private_skills/<sid>/SKILL.md
```

- Loader 按 agent 根缓存  
- `ownerAgent` 或目录归属保证仅该 agent 可见  
- `agent.skill_list`：缺失=不过滤，空=无，非空=严格子集（id/name 解析在 TRUSTED；私有根另附）  

**不要**把 Evolution 目录 `cloud/agents/<aid>/skills/`（自我进化 SkillStore）与 `private_skills` / SkillLoader 混用——见附录 A。

---

## S3.6 与宿主其它子系统的边界

| 系统 | 关系 |
|------|------|
| 群聊 bus | Skill 不另开派发通道；菜单进 Commander/worker 的 prompt 即可 |
| Connector | 伞形 `list_connector_tools` / `call_connector_tool`；**不要**把 MCP action 摊成扁平 tools，也不要摊成 Skill |
| KB | 模型经 KB 工具访问 contexts；不要对 contexts 目录 shell 扫描冒充 skill |
| 路径沙箱 | 一切文件入口继续 `isPathAllowed` |

---

## S3.7 forceOpenSkillRefs（可选对齐）

群聊里用户从选择器显式点选的 global skill，强制注入当前回合 Available 列表（绕过「global 不内联」）。S3 末可选实现。

---

## S3 总验收清单

- [ ] builtin seed → marketplace 路径；system reconcile 独立  
- [ ] `_install.json.seed_source` 区分 builtin/platform  
- [ ] run-skill 全扩展名分派 + venv 顺序  
- [ ] sandbox env 不泄漏进主进程  
- [ ] skill 编辑协议白名单  
- [ ] private_skills 仅所属 agent 可见  
- [ ] 文档与测试标明和 Evolution SkillStore 的边界  

---

# 测试矩阵（跨阶段）

## 单元

- Frontmatter：S1.1 表  
- Loader：扫描 / 缓存 / 冲突 / symlink / 空目录  
- Registry：Source / 去重 / 白名单 / 描述压缩  
- 门控：session 矩阵  
- run-skill：参数校验 / 搜索顺序 / 扩展名  

## 集成

- CRUD → list → prompt → delete → list  
- 菜单 → read_file → run-skill  
- 切换 uid → invalidate → 无串数据  

## 安全

- 路径逃逸（写文件、导入、scriptBase）  
- 导入大小与黑名单  
- 禁用 skill 的 read_file 拦截  

**原则（对齐 Agent 指南）：** 测不变量、恢复、并发、跨层契约、文本陷阱；不测纯 getter / 仅类型包装。

---

# 常见坑汇总

| # | 坑 | 正确做法 |
|---|-----|----------|
| 1 | 把每个 skill 注册成 Tool | 菜单 + read_file + run-skill |
| 2 | id 与 name 当一回事 | 目录 id；展示 name；prompt 标 internal read id |
| 3 | 发现/执行用同一优先级 | 发现 marketplace 先；执行 custom 先 |
| 4 | ROOT 放单独章节 | 内联在 Available 块上方 |
| 5 | 否定反例路径 | 不写；只给正确绝对路径 |
| 6 | 靠 mtime 感知文件编辑 | 写入后强制 invalidate |
| 7 | 忽略 symlink | stat 跟随 |
| 8 | Source 用 basename(`skills`) | 用根绝对路径 + install 元数据 |
| 9 | global 整表进 prompt | 只 hint + skill_search |
| 10 | System 进管理面板 / Available | 独立块 + session 门控 |
| 11 | ownerAgent 在去重前过滤 | 去重后过滤 |
| 12 | 缓存带 uid 的路径常量 | 用时 `getActiveUserId()` |
| 13 | run-skill 允许 `../` basename | 拒绝路径分隔符 |
| 14 | 混用 Evolution SkillStore | 见附录 A |

---

# 建议节奏

| 阶段 | 参考天数 | 产出 |
|------|----------|------|
| S0 | 0.5 day | 概念过关 |
| S1 | Day 1–3 | Frontmatter → Loader → Prompt → 接线 → run-skill → **🎉 Skill 闭环** |
| S2 | Day 4–7 | Registry、门控、CRUD、缓存、skill_search |
| S3 | Week 2+ | marketplace/system、runtime、编辑协议、private_skills |

可与 Agent 指南第四阶段（工具目录/bash）并行；**S1.6/S1.7 依赖 read_file + bash 已可用**。

---

# 附录 A：两套「Skill」勿混

| | 产品 Skill（本文） | Evolution / 自我进化 |
|---|---|---|
| 路径 | marketplace / cloud/skills / system / … | `cloud/agents/<aid>/skills/`（SkillStore） |
| 加载 | SkillLoader + Registry | core-agent `skill_manage` / SkillStore |
| Prompt | `## Available skills` / `## System skills` | `## Self-improvement: skills & metacognition` |
| 可见性 | 多用户来源 + 门控 | 通常仅 owner agent |

仿写 my-agent 时：**先完成产品 Skill。** Evolution 是 Agent 指南里另一条线，不要塞进 SkillLoader。

---

# 附录 B：Orkas 源码对照

| 主题 | 路径 |
|------|------|
| SkillLoader | `src/core-agent/src/skills/loader.ts` |
| Frontmatter | `src/core-agent/src/skills/frontmatter.ts` |
| SkillSpec | `src/core-agent/src/skills/types.ts` |
| Registry / Prompt / search | `src/main/model/core-agent/skill-registry.ts` |
| 自定义 CRUD | `src/main/features/skills.ts` |
| System reconcile | `src/main/features/system_skills.ts` |
| run-skill | `bin/run-skill.cjs` |
| Session 门控 | `src/main/model/core-agent/runner.ts` |
| 捆绑运行时 | `src/main/util/bundled-runtime.ts` |
| 沙箱 env | `src/main/model/core-agent/client.ts`（`buildSkillSandboxEnv`） |
| 路径 | `src/main/paths.ts` |
| 学习文档 | `docs/skill/*`、`docs/架构文档/Skill系统实现指南.md` |

---

# 附录 C：术语表

| 术语 | 含义 |
|------|------|
| Skill | `SKILL.md` + 可选脚本的能力包 |
| SkillSpec | 内存中的元数据（不含正文） |
| TRUSTED | 市场 + 自定义；可进 skill_list |
| System | 产品创作协议 skill |
| OPEN | 外部包 + 全局目录 |
| internal read id | 供 `read_file` 使用的目录 id |
| run-skill | 统一脚本入口 |
| skill_list | agent.json 白名单三态 |
| invalidate | 丢弃 Loader/Registry/UI 缓存 |

---

# 附录 D：给 AI 的阶段任务索引

可执行指令的完整粘贴版见 [`架构文档/Skill系统实现指南.md` §13](./架构文档/Skill系统实现指南.md#13-给-ai-的执行指令模板)。与本指南映射：

| 实现指南阶段 | 本指南 |
|--------------|--------|
| 阶段 1 Frontmatter | S1.1–S1.2 |
| 阶段 2 SkillLoader | S1.4 |
| 阶段 3 磁盘布局 | S1.3 |
| 阶段 4 Registry + Prompt | S1.5 + S2.2–S2.3 |
| 阶段 5 门控白名单 | S2.4–S2.6 |
| 阶段 6 run-skill | S1.7 + S3.3 |
| 阶段 7 CRUD | S2.9 |
| 阶段 8 System | S2.10 + S3.2 |
| 阶段 9 Marketplace | S3.1 |
| 阶段 10 运行时 | S3.3 |
| 阶段 11 测试 | 本文「测试矩阵」 |

---

# 附录 E：S1 最小可运行脚本（自检）

```bash
# 准备 fixture 到 data/<uid>/cloud/skills/hello-skill/
# 注入 prompt 后：

node bin/run-skill.cjs hello-skill main
# 期望 stdout: {"ok":true,...}
```

Runner 侧确认 system prompt 含 `## Available skills` 与该 skill 的绝对 ROOT。

---

**下一步：** 打开第三阶段已完成的 my-agent，从 **S1.1 Frontmatter** 开始仿写；每完成一节打勾 S1 总验收，再进入 S2。
