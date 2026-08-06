# Skill 系统实现文档 — my-agent 项目落地版

> **承接**：[`仿写Skill系统指南.md`](./仿写Skill系统指南.md)（Orkas 从零构建指南）  
> **定位**：把指南的 S0–S3 落到 my-agent **实际代码**，标注「已实现 / 待实现 / 与本项目差异」，
> 并给出每个模块的具体文件路径、接口骨架与验收测试。仿 `AgentRunner实现文档.md` 的工程文档风格。
> **本文做什么**：盘清现状 → 对齐指南 → 逐模块给出落地方案（含代码骨架）。
> **本文不做什么**：不复制 Orkas 业务代码；不做 Evolution SkillStore（见指南附录 A）；
> 不展开 marketplace 服务端、群聊 bus、connector、KB（本阶段无对应子系统）。

| 项 | 值 |
|---|---|
| 版本 | v1.1 |
| 日期 | 2026-08-06 |
| 作者 | my-agent 实现文档（经独立文档审查修订） |
| 状态 | 修订完成待复审（审查报告：`.ai-runtime-artifacts/reviews/2026-08-06-skill-system-document-review.md`） |

**修订记录：**

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-08-06 | 初稿 |
| v1.1 | 2026-08-06 | 按文档审查 FAIL 报告修订：§S1.7 适配 ESM + Windows 调用约定；新增「环境准备」小节；补迁移/回滚方案；补齐接口类型；修正测试数量（16→11）与若干事实出入；新增术语表 |

---

## 目录

1. [现状盘点（与指南前置条件的对照）](#1-现状盘点与指南前置条件的对照)
2. [架构目标与关键差异](#2-架构目标与关键差异)
3. [阶段映射与差距清单](#3-阶段映射与差距清单)
4. [S0 概念约束（本项目速记）](#4-s0-概念约束本项目速记)
5. [环境准备](#5-环境准备)
6. [S1 核心闭环实现](#6-s1-核心闭环实现)
7. [S2 产品层实现](#7-s2-产品层实现)
8. [S3 对齐 Orkas（本项目取舍）](#8-s3-对齐-orkas本项目取舍)
9. [测试矩阵](#9-测试矩阵)
10. [与其它子系统的边界](#10-与其它子系统的边界)
11. [常见坑对照（指南 14 条 → 本项目落地）](#11-常见坑对照指南-14-条--本项目落地)
12. [术语表](#12-术语表)

---

## 1. 现状盘点（与指南前置条件的对照）

指南假设「第三阶段完成后，my-agent **还没有任何 Skill 代码**，从 S1.1 开始写」。
**本项目实际已超出该假设**，有一个可运行的简化闭环，但距指南的 S1 验收还有差距。

### 1.1 已实现（可直接复用或演进）

| 模块 | 文件 | 现状 | 备注 |
|------|------|------|------|
| Skill 类型 | `src/skills/types.ts` | ✅ 完整 | `SkillSpec` / `SkillContent` / `pickDescription` |
| Frontmatter 解析 | `src/skills/loader.ts` `parseFrontmatter` | ⚠️ 简化版 | 仅 `key: value` + 续行；**无**块标量、无引号剥离 |
| Skill 扫描 | `src/skills/loader.ts` `SkillLoader.scan` | ⚠️ 简化版 | **递归**扫子目录、**后者覆盖**去重、无缓存 |
| 内容加载 | `SkillLoader.load` / `loadAll` | ✅ 完整 | 正文磁盘现读 |
| 模块导出 | `src/skills/index.ts` | ✅ | `SkillSpec` / `SkillContent` / `pickDescription` / `SkillLoader` / `parseFrontmatter` |
| 菜单注入 | `chat.ts` | ✅ 可用 | 扫 `./skills` → 渲染 `## 可用技能` → 经 `buildSystemPrompt({ skillsIndex })` 注入 |
| CLI 查看 | `chat.ts` | ✅ | `/skills` 列表、`/skill <id>` 看正文 |
| 示例 Skill | `skills/coding/SKILL.md` | ✅ | 带 `id/name/description_zh/description_en` frontmatter |
| 单测 | `test/skill-loader.test.ts` | ✅ 11 例 | frontmatter / scan / load / 去重 / pickDescription |
| Prompt 占位 | `src/prompts/templates/base-agent.md` `$skills_index` | ✅ | 默认 `(No additional skills loaded)` |
| Prompt 组装 | `src/prompts/system-prompt-builder.ts` | ✅ | `skillsIndex` 参数已接 |

### 1.2 待实现（指南 S1–S3 的核心缺口）

| 缺口 | 指南位置 | 现状 |
|------|---------|------|
| **run-skill 执行器** | S1.7 | ❌ 无 `bin/`、无脚本执行入口；Skill 只有说明书，不能跑脚本 |
| Orkas 风格 Prompt（ROOT 内联 / internal read id / 描述截断） | S1.5 | ❌ 当前菜单无 ROOT、无 Source 标签、无 `internal read id` |
| Skill 路径收口 | S1.3 | ❌ `src/storage/paths.ts` 无 `userSkillsDir` / `userMarketplaceSkillsDir` 等 |
| 沙箱包含 skill 根 | S1.6 | ❌ `src/tools/builtin.ts` `resolvePath` 只允许 `workingDir`，读不到 data 根下的 skill |
| Loader 实例化 + 缓存 + invalidate | S1.4 | ❌ 当前是静态方法，无 mtime 缓存 |
| Frontmatter 增强 | S1.1 | ❌ 块标量 / 引号 / 注释 / 旧版 `description` 迁移 |
| 注册表 / Source 标签 / 去重优先级 | S2.2 | ❌ |
| Session 门控 / `skill_list` 白名单 / 禁用 / ownerAgent | S2.4–S2.6 | ❌ |
| `skill_search` 工具 | S2.7 | ❌ |
| CRUD + 缓存三层 | S2.8–S2.9 | ❌ |
| marketplace / system / private_skills | S3 | ❌（本项目按取舍简化） |

### 1.3 关键差异：指南假设 vs 本项目实际

| 维度 | 指南（Orkas 向） | my-agent 实际 |
|------|-----------------|---------------|
| 数据根 | `data-root/<uid>/cloud|local/...` 多用户 | `~/.my-agent/`（`MY_AGENT_HOME` 可覆盖）单用户，无 uid |
| 技能目录 | 多来源（marketplace / cloud / system / global） | 目前仅项目根 `./skills` 一处，`source="system"` |
| 去重规则 | 发现层 marketplace 先（先到先得） | 目前「后者覆盖前者」（与指南相反，需对齐） |
| Loader | 实例 + mtime 缓存 + `invalidate()` | 静态方法，无缓存 |
| 扫描深度 | 仅 `dirs` 的**直接子目录** | 递归扫描 |
| 平台 | 假定 macOS/Linux | **Windows**（`run-skill` 扩展名顺序、`py -3`、无 venv） |
| 服务端 | marketplace 远程仓库 | 无服务端，S3 整体裁剪 |

> **结论**：本实现文档以「**在现有简化闭环上升级**」为基线，而不是从零重写。
> 凡与指南冲突处，优先满足本项目实际（单用户、Windows、无服务端），并在每节标注取舍。

---

## 2. 架构目标与关键差异

### 2.1 目标形态（对齐指南 S0.1 的一句话定义）

**Skill = 含 `SKILL.md` 的目录（+ 可选 `scripts/`）。**
LLM 在 system prompt 看到菜单 → `read_file(<ROOT>/<id>/SKILL.md)` 读说明书 →
按步骤用内置工具或 `run-skill` 执行脚本。

```
用户消息
  → Runner 注入 ## Available skills（name + 短描述 + ROOT）
  → LLM 匹配 → read_file(.../SKILL.md)
  → 按步骤执行（内置工具 或 run-skill）
  → 结果回用户
```

**关键不变式（沿用指南）：** Skill **不是** `tools[]` 里的新函数。
Registry 只注入菜单；正文靠 `read_file`；脚本靠统一 `run-skill` 入口。

### 2.2 本项目依赖图（落地版）

> 注：图中「chat.ts（当前接线层）+ agent/runner 注入菜单」两处为**目标态**；
> 当前 runner 并不注入菜单（§6.6 现状说明），S1 阶段由 chat.ts 注入，S2 再收敛到 runner。

```
                      ┌──────────────────────────┐
                      │  chat.ts（当前接线层）     │
                      │  + agent/runner 注入菜单  │ ← 目标态（S2），当前由 chat.ts 注入
                      └───────────┬──────────────┘
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
     ┌──────┴──────┐      ┌──────┴──────┐      ┌───────┴───────┐
     │ skills/     │      │ skills/     │      │ bin/          │
     │ registry    │  S2  │ crud+gating │  S2  │ run-skill.cjs │  S1.7
     └──────┬──────┘      └──────┬──────┘      └───────┬───────┘
            └────────────────────┼─────────────────────┘
                                 │
                        ┌────────┴────────┐
                        │  skills/loader  │  扫盘 + frontmatter（实例化 + 缓存）
                        └────────┬────────┘
                 ┌────────────────┼────────────────┐
                 │                │                │
          ┌──────┴──────┐ ┌──────┴──────┐ ┌───────┴───────┐
          │ frontmatter │ │ storage/    │ │ storage/      │
          │ (增强)      │ │ paths.ts    │ │ path-sandbox  │
          └─────────────┘ └─────────────┘ └───────────────┘
```

### 2.3 本项目五项取舍（相对指南）

| # | 取舍 | 理由 |
|---|------|------|
| 1 | **单用户无 uid**：`userSkillsDir()` 不需要 uid 参数，直接基于 `dataRoot()` | 项目单用户学习项目，`paths.ts` 已无 uid 概念 |
| 2 | **两级目录**：`<dataRoot>/skills/`（custom）+ `<dataRoot>/marketplace/skills/`（预置） | 无服务端，marketplace 退化为本地预置目录 |
| 3 | **不做 venv/捆绑运行时**：`run-skill` 走系统 `python3` / `py -3` / `node` | Windows 单机，S3.3 全量裁剪 |
| 4 | **system 协议 skill 暂缓**：S2 先不单独建 `## System skills` 块 | 项目无 skill-creator 等产品协议，S3 再评估 |
| 5 | **global/OPEN 来源不做**：不扫 `~/.claude/skills`、不做 `skill_search` 的 global 面 | 无多平台技能，`skill_search` 可先对内网目录实现或裁掉 |

---

## 3. 阶段映射与差距清单

| 指南阶段 | 指南目标 | 本项目状态 | 本实现文档章节 |
|---------|---------|-----------|---------------|
| S0 概念纠偏 | Skill ≠ tool | ✅ 已有认知（`chat.ts` 即此模式） | §4 |
| S1 核心闭环 | 菜单 → read_file → run-skill | ⚠️ 差 run-skill + Prompt 形态 | §6 |
| S2 产品层 | 分层 / 门控 / CRUD / 缓存 / search | ❌ 全部 | §7 |
| S3 对齐 Orkas | marketplace / system / runtime | ❌ 按取舍裁剪 | §8 |

---

## 4. S0 概念约束（本项目速记）

1. **Skill 是说明书包**，不是可执行包注册表 —— 菜单 + `read_file` + `run-skill`，禁止把每个 skill 注册成 `defineTool`。
2. **id ≠ name**：`id` = 目录名（或 frontmatter `id` 字段，本项目现状）；`name` = frontmatter 展示名。Prompt 在 `name !== id` 时必须标 `internal read id`。
3. **发现与执行优先级故意不对称**：
   - 发现（菜单）：同 id 时 **marketplace 先**（§6.4 Loader dirs 顺序）；
   - 执行（run-skill 找脚本）：同 id 时 **custom 先**（§6.7 candidates 顺序）。
4. **三层来源不混**：本项目只保留 **TRUSTED（custom + marketplace）**；System / OPEN 裁掉（§2.3）。

---

## 5. 环境准备

> document-review 将环境准备列为首要检查项（「缺失环境配置带来的返工比缺失功能更严重」）。
> 本文档所有模块均建立在以下环境之上，B1 开始前先验证。

### 5.1 运行环境

| 项 | 要求 | 说明 |
|----|------|------|
| Node.js | **≥ 18**（建议 20+） | `package.json` 未设 `engines`；dev 工具链（`tsx` / `vitest`）与代码中的全局 `fetch` 要求 Node ≥ 18；`run-skill` 核心仅需动态 `import()`（Node ≥ 12.17） |
| npm | 随 Node 附带 | 本项目无 `yarn`/`pnpm` 锁文件 |
| OS | Windows 10/11（开发验证环境） | 代码需同时保持 POSIX 可运行（`run-skill` 扩展名分派按平台分支） |
| Python | 可选（仅 `scripts/*.py` 需要） | Windows 下用 `py -3`，POSIX 用 `python3`；S1 可先只验证 JS 路径 |

### 5.2 依赖与预检

本项目 **不新增第三方运行时依赖**——`run-skill` 用 Node 内建模块（`child_process` / `path` / `fs` / `util`）。
现有依赖 `zod` / `async-mutex` 与 Skill 系统无关，不需要变更。

```powershell
# 1. 安装依赖（首次）
npm install

# 2. 类型检查（TypeScript strict 通过）
npm run check
# 预期：exit 0，无输出

# 3. 全量单测
npm test
# 预期：20 个测试文件，除 test/cli-io.test.ts 既有 4 项失败外全绿
# 参考：第三阶段 execution-log 尾盘记录（272/276；4 项为 Windows ANSI 环境既有问题）

# 4. Skill 相关专项测试（B1 后）
npx vitest run test/skill-loader.test.ts
```

### 5.3 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|:---:|--------|------|
| `MY_AGENT_HOME` | 否 | `~/.my-agent` | 数据根；Skill 目录位于其下 `skills/` 与 `marketplace/skills/` |
| `DEEPSEEK_API_KEY` | 否（聊天需要） | 空 | provider `apiKey` 为空时 fallback（`providers-store.ts` `resolveEnvApiKey`） |

> ⚠️ 本项目 **不存在** `MY_NODE` / `APP_DIR` 环境变量（审查 D3 已核实）。
> `run-skill.cjs`（CommonJS）内部用 `process.execPath` 定位 Node、`__dirname` 定位自身，
> 无需也不应依赖任何自定义环境变量。

### 5.4 平台差异

| 项 | Windows | macOS/Linux |
|----|---------|-------------|
| Python 入口 | `py -3` | `python3` |
| run-skill 扩展名顺序 | `py, ts, mjs, js, ps1, cmd, bat, sh, rb` | `py, ts, mjs, js, sh, rb, ps1` |
| 沙箱路径 | `C:\Users\...`（大小写不敏感，resolve 规范化） | `/Users/...` |
| 示例验证命令 | `node bin/run-skill.cjs hello-skill main` | 同左（`/` 分隔符） |

> **注**：本项目 `bash` 工具在 Windows 上通过 `child_process.exec` 实际走 `cmd.exe`；
> SKILL.md 正文里的 `run-skill` 调用示例应写平台无关形式 `node <abs>/bin/run-skill.cjs <id> <script> -- args`，
> 由模型按当前 OS 决定引号/分隔符，不要写 bash 专属的 `"$VAR"` 语法。

---

## 6. S1 核心闭环实现

**目标**：在现有简化闭环上升级 —— 放一个带 `scripts/` 的 skill，LLM 能读说明书并跑通脚本。

### S1.1 Frontmatter 增强（`src/skills/loader.ts`）

现状：`parseFrontmatter` 仅支持 `key: value` + 空格续行，无块标量、无引号剥离、注释未跳过。

升级目标（指南 S1.1 验收表）：

| 输入形态 | 期望 |
|----------|------|
| 无 `---` | `{ attrs: {}, body: text }`（现状 ✅） |
| 未闭合 `---` | 当正文，不抛错（现状 ✅） |
| `name: foo` | `attrs.name === "foo"`（现状 ✅） |
| `description: "a: b"` | 值含冒号（现状 ❌，需剥匹配成对引号） |
| `description: \|` + 缩进多行 | 保留换行（现状 ❌） |
| `description: >` + 多行 | 空格折叠、空行→换行（现状 ❌） |
| `# comment` | 忽略（现状 ❌） |
| `- item` 列表行 | 忽略不进 attrs（现状 ⚠️ 未显式处理） |

骨架（在现有函数上增强，保持返回 `{ attrs, body }`）：

```ts
export function parseFrontmatter(text: string): { attrs: Record<string, string>; body: string } {
  // 快路径：首行不是 ---
  // 找闭合 ---；未找到 → 当正文
  // 逐行：
  //   - 跳过空行、# 注释
  //   - key: value → 剥成对引号（"…" / '…'），残缺引号原样保留
  //   - | 字面量块 / > 折叠块：收集到「缩进 ≤ key 行缩进」的非空行
  //   - 列表行 / 嵌套 → 忽略不进 attrs
  // return { attrs, body }
}
```

**body trim 规范化**：现状在「有 frontmatter」时 `body = text.slice(endIdx + 3).trim()`（去掉首尾空白），
而无 frontmatter 时 `body = text` 原样返回，两者行为不一致。升级后统一为：
- 无 `---`：`body = text.trim()`；
- 有 `---`：`body = text.slice(endIdx + 3).trim()`。
并把「无 frontmatter 时 body 被 trim」写入验收测试（现有一例 `it("没有 frontmatter 时返回空 attrs")` 仅断言 attrs）。

**测试**：扩展 `test/skill-loader.test.ts`，逐行对照上面验收表（现有 11 例基础上新增 5–8 例，含 body trim 行为用例）。

### S1.2 SkillSpec 与描述选取（`src/skills/types.ts`）

现状已基本达标，需对齐两点：

1. **id 取值**：现为 `attrs.id || entry.name`。指南主张 `id = 目录名`。本项目可保留 frontmatter `id` 优先（`skills/coding/SKILL.md` 已用此约定），但要 **在文档与 prompt 中明确 `id` 是 internal read id**，避免与 `name` 混淆。
2. **旧版 `description` 迁移**（指南 S1.2）：当仅 `description` 字段时按是否含 CJK 迁到 `description_zh`/`description_en`。当前实现把 `description` 同时塞进 zh 和 en（`attrs.description_zh || attrs.description`），会导致英文描述出现在中文菜单。升级为：

```ts
const legacy = normalize(attrs.description);
const hasCjk = /[一-鿿]/.test(legacy);
description_zh = attrs.description_zh || (legacy && hasCjk ? legacy : "") || "";
description_en = attrs.description_en || (legacy && !hasCjk ? legacy : "") || "";
```

> ⚠️ **`pickDescription` 已知限制**：当前实现是 `lang === "en"` **字面精确匹配**，传 `"en-US"`、`"zh-CN"` 等 BCP-47 值会回落到默认分支（优先 zh）。本项目菜单注入目前只传 `undefined` 或 `"en"`，不受影响；但若未来引入 BCP-47 语言体系，需改为 `lang.startsWith("en")` 并补测试。

**可选**：支持 `_meta.json` 侧车补双语描述（字段缺失当 `{}`），本项目 S1 建议做，S2 必须做。

### S1.3 路径扩展（`src/storage/paths.ts`）

在现有 `paths.ts` 增加（本项目无 uid，直接基于 `dataRoot()`）：

```ts
/** 用户自定义 skill 目录 */
export function userSkillsDir(): string {
  return path.join(dataRoot(), "skills");
}

/** 本地预置（marketplace 退化）skill 目录 */
export function userMarketplaceSkillsDir(): string {
  return path.join(dataRoot(), "marketplace", "skills");
}

/** 系统协议 skill 目录（S3 预留，当前可不建） */
export function userSystemSkillsDir(): string {
  return path.join(dataRoot(), "system", "skills");
}
```

并在 `ensureDataLayout()` 中创建 `skills` / `marketplace/skills` 两目录。
**硬约束**：目录名断言复用现有 `assertPathSegment`（skill id 进 `path.join` 前校验，拒绝 `/ \ .. \0`）。

**测试**：`test/storage/paths.test.ts` 增加——`userSkillsDir()` 指向 dataRoot 下 skills；`_resetDataRoot()` 后可切换。

### S1.4 SkillLoader 实例化 + 缓存（`src/skills/loader.ts`）

现状是静态方法 + 递归 + 后者覆盖。升级为指南 S1.4 形态（实例 + 缓存 + 先到先得）：

```ts
export class SkillLoader {
  private readonly dirs: string[];
  private cache: { stamp: string; skills: SkillSpec[] } | null = null;

  constructor(opts: { dirs: string[] }) {
    this.dirs = [...opts.dirs];           // 优先级从高到低
  }

  list(): SkillSpec[] {
    const stamp = this.dirStamp();
    if (this.cache?.stamp === stamp) return this.cache.skills;

    const seen = new Map<string, SkillSpec>();
    for (const dir of this.dirs) {
      if (!isDir(dir)) continue;
      for (const e of readdirWithStat(dir)) {
        if (e.name.startsWith(".")) continue;
        // 符号链接需 stat 跟随（Windows 上也成立）
        const skillFile = path.join(dir, e.name, "SKILL.md");
        if (!exists(skillFile)) continue;
        if (seen.has(e.name)) continue;   // 先到先得 ← 与现状相反，需迁移
        const spec = this.parseSpec(dir, e.name);
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

  private dirStamp(): string {
    return this.dirs.map((d) => `${d}:${statMtime(d)}`).join("|");
  }
}
```

**三个破坏性变更（相对现状）**：

| 变更 | 现状 | 目标 | 影响 |
|------|------|------|------|
| 扫描深度 | 递归子目录 | 仅直接子目录 | `chat.ts` 扫描逻辑调整 |
| 去重规则 | 后者覆盖 | **先到先得**（dirs 数组序） | 迁移测试断言 |
| 接口形态 | 静态方法 | 实例 + `invalidate()` | 调用方改 `new SkillLoader({ dirs })` |

> ⚠️ **迁移注意**：现有 `chat.ts` 用 `SkillLoader.scan(skillDir, "system")` 静态调用，
> 升级后需改为构造实例。为减少回归，可先保留静态 `scan` 作为兼容层，新代码走实例 API。

#### 迁移与回滚方案（B1 实施前必读）

**S1.3 建 `dataRoot/skills` 后，仓库内 `skills/coding`（现状唯一菜单来源）的归属**，二选一：

| 方案 | 做法 | 过渡 | 适用 |
|------|------|------|------|
| A（推荐） | `skills/coding` 复制到 `<dataRoot>/skills/coding`，chat.ts 改扫 `userSkillsDir()` | 双目录并存期间，两处都扫（dirs 含仓库根 + dataRoot），用先到先得 | 保持仓库内示例可见，过渡最平滑 |
| B | 仓库 `skills/` 废弃，唯一来源 `<dataRoot>/skills/` | chat.ts 一次切换 | 干净但仓库内示例对首次使用者不可见 |

**静态 `scan` 兼容层移除条件**：当 chat.ts 及其测试全部迁移到实例 API、且 `test/skill-loader.test.ts` 无静态调用断言后，删除兼容层。回退路径：`git revert` 对应提交即可恢复静态 API，不影响 dataRoot 上已写入的 skill 文件（文件是唯一事实源）。

**回滚判定**：B1 若在「沙箱扩展」后出现 `read_file` 读不到既有 skill 根（回归）——回退到 §6.6 前状态，检查 `resolvePath` 的 `allowedRoots` 是否覆盖了 `userSkillsDir()` 与仓库 `skills/` 两处。

**踩坑（沿用指南）**：文件内容变 ≠ 父目录 mtime 变 → 写路径必须显式 `invalidate()`；
只缓存元数据，正文永远磁盘现读。

### S1.5 最小 Prompt 注入（`src/prompts/skills-index.ts` 或并入 loader）

现状 `chat.ts` 的菜单是简化版：

```
## 可用技能 (Skills)
- **coding** (`coding`): 非平凡代码变更的工程规范：...
通过描述中的关键词触发相应 Skill 的指令规范。
```

升级为指南 S1.5 形态（ROOT 内联、Source 标签、internal read id）：

```text
## Available skills (skills)

`read_file(<ROOT>/<id>/SKILL.md)` — ROOT by Source:
- custom: C:/Users/<name>/.my-agent/skills
- marketplace: C:/Users/<name>/.my-agent/marketplace/skills
Use these ROOT values verbatim. `<id>` is the internal read id for read_file paths only,
even when it differs from display name.
These entries are skills, not tool names: read SKILL.md and follow it;
never call the display name or id as a tool.

- **coding** (Source: custom) — 非平凡代码变更的工程规范；适合"改代码";触发词：编码
- **deep-research** (Source: builtin; internal read id: ee99fbb42964) — …
```

设计细节（S1 就遵守）：

1. **ROOT 绝对路径内联在菜单上方**，不单独开 `## Resource locations` 节（LLM 会忽略分离常量并编造路径）。
2. **不写否定反例路径**。
3. 条目是 skill 不是 tool name —— 固定说明句写进块。
4. 描述压缩：S1 先 `slice(0, 240)`；S2 做「在适合/触发词处截断」。
5. Source 标签按**根绝对路径**算（`custom` / `marketplace` / `builtin`），不靠 basename（两根都叫 `skills` 时会撞）。

封装函数（放 `src/skills/prompt.ts`，chat.ts 与 runner 共用）：

```ts
// roots 只含本项目实际存在的来源；system 目录当前不建（§2.3 取舍 4），故不强制要求该键。
export interface SkillRoots {
  custom: string;
  marketplace: string;
}

export function buildAvailableSkillsBlock(
  loader: SkillLoader,
  opts: { lang?: string; roots: SkillRoots },
): string;
```

### S1.6 Runner / 沙箱接线

#### 接线点（现状已半接）

- `chat.ts`：`buildSystemPrompt({ skillsIndex: skillContext || undefined })` —— 已接，换成 S1.5 的 `buildAvailableSkillsBlock` 输出。
- `src/agent/runner.ts`：`buildSystemPromptWithEvolution` 未传 `skillsIndex` —— runner 内目前不注入技能菜单（由 chat.ts 层注入）。S1 阶段**保持 chat.ts 注入**即可，runner 无需改动主循环。
- `meta.skillsLoaded`（`src/agent/types.ts` 542–548 行）为 Evolution `skill_manage` 预留，与产品 Skill 无关，**勿混用**。

#### 沙箱扩展（必须）

`src/tools/builtin.ts` 的 `resolvePath` 目前 `allowedRoots: [workingDir]`，LLM **读不到** data 根下的 skill。扩展：

```ts
// builtin.ts resolvePath 的 allowedRoots 改为：
const roots = [
  ctx.workingDir ?? process.cwd(),
  userSkillsDir(),                 // ← 新增
  userMarketplaceSkillsDir(),      // ← 新增
];
const err = guardPath(abs, { allowedRoots: roots });
```

仍走 `src/storage/path-sandbox.ts` 的 `isPathAllowed`（resolve 两侧 + startsWith(root + sep)）。

**验收（集成测试）**：
- `read_file(<customRoot>/hello-skill/SKILL.md)` 成功；
- `read_file(C:/Windows/system32/drivers/etc/hosts)` 仍被沙箱拒绝；
- system prompt 含 `## Available skills` 且含绝对 ROOT。

### S1.7 run-skill 最小执行器（`bin/run-skill.cjs`，CommonJS）

> ⚠️ **本小节已按审查 D2/D3 修订**：适配项目 `"type": "module"`，去除不存在的 `MY_NODE`/`APP_DIR` 环境变量，调用示例改为平台无关形式。

**调用约定（经 bash 工具）**：

```text
node <APP_DIR>/bin/run-skill.cjs <skill-id-or-name> <script-basename> [-- args...]
```

其中 `<APP_DIR>` 是项目根绝对路径（chat.ts 与 SKILL.md 正文中按当前 OS 拼写，Windows 下用 `node "D:\...\bin\run-skill.cjs"`）。LLM 只学这一种形式，不关心脚本是 py 还是 js。

> **为什么不用 `"$MY_NODE"` / `"$APP_DIR"`**：本项目不存在这两个环境变量（仅 `MY_AGENT_HOME` 有定义），且 `"$VAR"` 是 bash 语法，在 Windows PowerShell / cmd 下不可执行。`run-skill.cjs` 是 CommonJS 文件，内部用 `process.execPath` 获取当前 Node、`__dirname` 定位自身目录（CJS 天然支持，无需 `import.meta`），无需任何自定义环境变量。

**S1 最小行为**：

1. 解析 argv；`scriptBase` 用 `assertPathSegment` 语义校验（**仅拒绝** `..`、`/`、`\`、`\0`；单个 `.` 是合法字符，如 `main.test` 不被拒绝——与 `src/storage/paths.ts` 现有函数行为一致）。
2. 在 custom → marketplace 顺序下找 `scripts/<base>.<ext>`。
3. 扩展名尝试顺序（**Windows**）：`py, ts, mjs, js, ps1, cmd, bat, sh, rb`。
4. 脚本加载规则（**适配 ESM，修复 D2**）：
   - `.mjs` / `.js`：用**动态 `import()`** 加载，取 `mod.default ?? mod` 作为入口函数（`.js` 在本项目 `"type": "module"` 下按 ESM 解析，`require()` 会抛 `ERR_REQUIRE_ESM`）；
   - `.cjs`：用 `require()` + `module.exports`（CJS 模块无 `.default`，直接取 `mod`）；
   - `.ts`：本阶段**不执行**（Windows 分派表中保留但 B1 验证仅覆盖 mjs/js/cjs/py；若需运行，另引入 `tsx` 再评估，避免新增依赖）。
   - `.py`：spawn `py -3`（Windows）/ `python3`（POSIX）。
5. 失败：stderr 打 JSON `{ ok:false, error, searched? }`，非零退出。

```js
// bin/run-skill.cjs 核心（示意，CommonJS；入口用 async IIFE，CJS 无顶层 await）
(async () => {
  const candidates = [userSkillsDir(), userMarketplaceSkillsDir()]; // custom 先
  // 对每个根：scripts/<base>.<ext> 按扩展名顺序探测
  // .mjs/.js → await import(scriptPath);  const fn = mod?.default ?? mod;
  // .cjs     → fn = require(scriptPath);
  // .py      → spawn(pyExe, [scriptPath, ...args])
  // 找不到 → exit 64 + JSON { ok:false, error, searched }
})();
```

**Node 脚本约定（`scripts/main.mjs`，推荐 ESM 形态，与本项目 `"type": "module"` 一致）**：

```js
export default async function (args) {
  // args: { args: string[], skillId: string, skillDir: string }
  // 返回 undefined → 脚本已自行写 stdout；返回值 → JSON.stringify 到 stdout
  return { ok: true, hello: "world" };
};
```

若脚本作者偏好 CJS，可写 `scripts/main.cjs`：

```js
module.exports = async function (args) {
  return { ok: true, hello: "world" };
};
```

**两种形态都支持，但 `.js` 一律按 ESM 处理**（`import()` + `default`），不要用 `require()` 加载 `.js`。

**Fixture**：新增 `fixtures/skills/hello-skill/`（SKILL.md + `scripts/main.mjs` + `scripts/main.py`），
并同步到 `~/.my-agent/skills/`（或测试用临时 `MY_AGENT_HOME`）。

**验收**：

| 场景 | 期望 |
|------|------|
| `run-skill.cjs hello-skill main` | stdout 含 ok（验证 mjs 与 py 至少各一） |
| `scriptBase=../x` | exit 64，JSON error（含 `..` 被拒绝） |
| 仅 marketplace 有脚本、custom 同 id 无脚本 | 跑到 marketplace |
| custom 与 marketplace 同 id 都有脚本 | **跑 custom 版** |
| 缺少脚本 | JSON error + searched 列表 |
| `.js` 脚本含 ESM `export default` | 被 `import()` 正确加载（回归 D2） |

---

## 7. S2 产品层实现

> S2 目标是「分层、门控、CRUD、缓存、skill_search」。本项目按 §2.3 取舍裁剪为：
> TRUSTED 两层（custom + marketplace）+ 门控矩阵 + CRUD + 缓存三层 + `skill_search`（对内网目录）。

### S2.1 SkillRegistry（新增 `src/skills/registry.ts`）

```ts
export interface SkillSearchResult {
  name: string;
  id: string;
  source: SkillSource;          // custom | marketplace | builtin
  read_path: string;            // SKILL.md 绝对路径（给 read_file）
  description: string;          // 命中语言描述（zh/en 按 opts.lang）
}

export interface SkillSearchOptions {
  query: string;
  lang?: string;
  limit?: number;               // 默认 10
  excludeIds?: string[];        // 已列入菜单的 id，命中结果可过滤
}

export type SkillSource = "custom" | "marketplace" | "builtin";

export class SkillRegistry {
  private readonly trusted: SkillLoader;   // dirs = [marketplace, custom]
  private readonly uidScoped: boolean;     // 本项目固定 false

  list(): SkillSpec[];                     // 已按 Source 优先级去重
  renderAvailableBlock(lang?: string): string;   // 调 buildAvailableSkillsBlock
  resolveAllowlistRefs(refs: string[]): { ids: string[]; unknown: string[] };
  search(opts: SkillSearchOptions): SkillSearchResult[];  // 只搜允许范围
  invalidate(): void;                      // 清缓存
}
```

**Loader 句柄**（本项目单用户，trusted 为单例）：

```ts
let _trusted: SkillLoader | null = null;
export function trustedLoader(): SkillLoader {
  if (!_trusted) _trusted = new SkillLoader({
    dirs: [userMarketplaceSkillsDir(), userSkillsDir()], // 发现层 marketplace 先
  });
  return _trusted;
}
```

**Source 标签**按根绝对路径：

```ts
function sourceOf(dir: string): SkillSource {
  if (dir === userMarketplaceSkillsDir()) return "marketplace";
  if (dir === userSkillsDir()) return "custom";
  return "builtin";
}
```

### S2.2 展示名去重与优先级

```
builtin (0) > marketplace (1) > custom (2)
```
同优先级、不同 id 的同名 skill **都保留**。
`ownerAgent` 过滤放在**去重之后**（避免私有条目挡住同名共享 skill）。

### S2.3 Session 门控（本项目简化）

指南用 `session-<kind>-<tail>` 区分群聊/编辑等 session。本项目 `SessionStore.create(kind)` 已支持
kind（`gconv` / `cli` / `anon` / `extract`，见第三阶段执行日志）。对齐指南矩阵做**最小版**：

```ts
export function systemSkillsExposureFromSessionId(sessionId: string): boolean {
  return /^gconv-/.test(sessionId);      // 本项目仅群聊指挥官需要
}
```

> 本项目无 `agent-` / `skill-` kind 编辑会话，OPEN/System 面整体裁剪，矩阵退化为
> `gconv = 全量` / 其它 = TRUSTED 仅。若后续引入 kind，再展开矩阵。

### S2.4 `skill_list` 白名单与禁用

| `skill_list` | 含义 |
|--------------|------|
| 字段缺失 | 不过滤：TRUSTED 全集（再减 disabled） |
| `[]` | 明确零 skill |
| `["coding", "<id>"]` | 白名单；支持 id 或 name |

- `resolveAllowlistRefs`：byId 精确；byName 同名按 Source 优先级取第一个；未知进 unknown。
- 禁用：`component-enabled` 只存 `false`，渲染前剔除，**即使在白名单也剔除**。
- read_file 侧防绕过：`guardDisabledSkillAccess` 检查路径是否属于已禁用 skill_id。

### S2.5 自定义 Skill CRUD（新增 `src/skills/crud.ts`）

```ts
export function createCustomSkill(input: {
  name: string;                // 校验 /^[A-Za-z][A-Za-z0-9_-]*$/
  description_zh?: string;
  description_en?: string;
}): SkillSpec;
export function updateCustomSkill(id, patch): SkillSpec;   // SKILL.md 原子写
export function renameCustomSkill(id, newName): void;      // renameSync + invalidate
export function deleteCustomSkill(id): void;               // 删目录树 + invalidate
export function writeCustomSkillFile(id, relPath, content): void; // 相对路径防逃逸
```

要点：
- 创建校验：名称合法、`userSkillsDir()/<name>` 不存在、不与 marketplace **同展示名**冲突。
- 写文件用 `src/storage/jsonl.ts` 的原子写原语（`atomicWrite`），成功后 `invalidate()`。
- 相对路径不得逃出 skill 根（接 `isPathAllowed`）。

### S2.6 缓存三层

| 层 | 位置 | 策略 |
|----|------|------|
| 1 | SkillLoader | `dir:mtimeMs` stamp |
| 2 | Registry 句柄 | trusted 单例 |
| 3 | chat.ts / UI | 内存列表 + 短 trust 窗口 |

**记住**：文件内容变 ≠ 目录 mtime 变 → 写路径必须 `invalidate`。

### S2.7 `skill_search`（可选，本项目内网版）

- 搜 **marketplace + custom**（本项目无 global 面），走 `registry.search(opts: SkillSearchOptions)`（§7.1）。
- 返回：`SkillSearchResult`（`name, id, source, read_path, description`）。
- 打分：name/description 词重叠，name 权重更高。
- 过滤：disabled、与菜单同 id 已列出的可不出（`excludeIds`）。
- 工具仅对需要 OPEN 的 session 暴露（本项目可先不暴露，S2 末尾评估）。

---

## 8. S3 对齐 Orkas（本项目取舍）

按 §2.3，本项目 S3 全量裁剪。保留清单：

| 指南 S3 项 | 本项目决策 | 原因 |
|-----------|-----------|------|
| S3.1 marketplace 安装模型 | **裁**（无服务端） | marketplace 退化为本地预置目录，无 `_install.json` / `installs.json` |
| S3.2 System skill reconcile | **缓** | 无产品协议 skill（skill-creator 等），S2 先不建 `## System skills` 块 |
| S3.3 捆绑运行时与 venv | **裁**（系统解释器） | Windows 单机，无 App 打包 |
| S3.4 编辑会话协议 | **裁** | 无 GUI 宿主，编辑块白名单无消费方 |
| S3.5 `private_skills` | **裁**（或预留） | 无多 agent 工作流；若后续加，路径为 `<dataRoot>/agents/<aid>/private_skills/` |
| S3.6 与宿主边界 | **保留** | 见 §10 |
| S3.7 forceOpenSkillRefs | **裁** | 无 global 来源 |

**S3 唯一落地项**：`run-skill` 的扩展名分派顺序在 Windows 上测试通过（§6.7 已覆盖）。

---

## 9. 测试矩阵

### 单元

| 模块 | 用例 | 现状 |
|------|------|------|
| Frontmatter | S1.1 表逐行 | 部分（新增块标量/引号/注释） |
| Loader | 扫描 / 缓存 / 冲突 / symlink / 空目录 / invalidate | 部分（迁移先到先得 + 实例化） |
| Registry | Source 标签 / 去重 / 白名单 / 描述压缩 | 新增 |
| 门控 | session 矩阵 | 新增（简化版） |
| CRUD | 创建/更新/重命名/删除/写文件逃逸 | 新增 |
| run-skill | 参数校验 / 搜索顺序 / 扩展名 / Windows `py -3` / ESM `.js` 加载（回归 D2） | 新增 |

### 集成

- CRUD → list → prompt → delete → list（验证 invalidate 链路）
- 菜单 → read_file → run-skill（端到端）
- 切换 `MY_AGENT_HOME` → invalidate → 无串数据

### 安全

- 路径逃逸（写文件、import、scriptBase）
- 禁用 skill 的 read_file 拦截
- 沙箱含 skill 根后，`/etc/passwd` 类路径仍拒绝

**原则（对齐现有仓库）**：测不变量、恢复、并发、跨层契约、文本陷阱；不测纯 getter。

---

## 10. 与其它子系统的边界

| 系统 | 关系 |
|------|------|
| `src/storage/path-sandbox.ts` | 一切文件入口继续 `isPathAllowed`；skill 根加入 allowedRoots |
| `src/storage/paths.ts` | skill 路径全部走命名函数，禁止内联 `path.join(dataRoot, "skills", ...)` |
| `src/storage/jsonl.ts` | 原子写复用；**不**用 shell 写文本 |
| `src/config/schema.ts` Evolution | **勿混**：`evolution.skillsDir` 是自我进化 SkillStore 配置（`skill_manage`），与产品 Skill Loader/Registry 是两条线（指南附录 A） |
| `src/agent/runner.ts` | 主循环不感知 skill；菜单由 chat.ts 注入；`meta.skillsLoaded` 属 Evolution 线 |
| CLI（`chat.ts`） | `/skills`、`/skill <id>` 命令保留；新增 `/skill new|edit|delete`（S2） |
| tools（`builtin.ts`） | `read_file` / `bash` 是 skill 的载体，不新增 skill 工具 |

---

## 11. 常见坑对照（指南 14 条 → 本项目落地）

| # | 指南坑 | 本项目落地检查 |
|---|--------|---------------|
| 1 | 把每个 skill 注册成 Tool | `run-skill` 唯一入口，LLM 走 bash 调它 |
| 2 | id 与 name 当一回事 | Prompt 恒标 `internal read id` |
| 3 | 发现/执行同一优先级 | 发现 marketplace 先（§6.4）；执行 custom 先（§6.7） |
| 4 | ROOT 放单独章节 | 内联在 `## Available skills` 上方 |
| 5 | 否定反例路径 | 不写 |
| 6 | 靠 mtime 感知文件编辑 | 写入后强制 `invalidate()` |
| 7 | 忽略 symlink | `readdir` + stat 跟随 |
| 8 | Source 用 basename(`skills`) | 用根绝对路径 |
| 9 | global 整表进 prompt | 本项目无 global；若加只 hint + search |
| 10 | System 进管理面板 / Available | 本项目 system 裁掉；若加独立块 + 门控 |
| 11 | ownerAgent 在去重前过滤 | 去重后过滤 |
| 12 | 缓存带 uid 的路径常量 | 本项目无 uid，路径函数用时再取 `dataRoot()` |
| 13 | run-skill 允许 `../` basename | `assertPathSegment` 拒绝 `..` `/` `\` `\0`（单 `.` 合法，如 `main.test`） |
| 14 | 混用 Evolution SkillStore | `evolution.skillsDir` 与本系统物理隔离，README 标注 |

---

## 建议实施顺序

| 批次 | 内容 | 参考工作量 |
|------|------|-----------|
| **B1（S1 闭环）** | Frontmatter 增强 + Loader 实例化缓存 + Prompt S1.5 + 沙箱扩展 + run-skill | 2–3 天 |
| **B2（S2 产品层）** | Registry + 门控 + 白名单 + CRUD + 缓存三层 + skill_search | 2–3 天 |
| **B3（S3 取舍）** | Windows 全扩展名分派验证 + 边界文档 | 0.5–1 天 |

每批走：spec（如有行为决策）→ plan → 实现 → 集体测试 → 集体审查，产物落 `.ai-runtime-artifacts/`。

---

**下一步**：从 **B1** 开始，先做 S1.1 Frontmatter 增强（TDD：先补验收表测试，再改实现），
逐项对照 §6 打勾，然后进入 B2。

---

## 12. 术语表

| 术语 | 含义 |
|------|------|
| **Skill** | 含 `SKILL.md`（+ 可选 `scripts/`）的目录；说明书包，不是可执行工具 |
| **SKILL.md** | Skill 说明书：YAML-like frontmatter（`id`/`name`/`description_zh`/`description_en`）+ 正文步骤 |
| **frontmatter** | SKILL.md 顶部 `---` 之间的元数据段；本项目由 `parseFrontmatter` 解析 |
| **internal read id** | 用于 `read_file(<ROOT>/<id>/SKILL.md)` 的 id；与展示名 `name` 可不同 |
| **ROOT** | Skill 来源根目录的绝对路径（`custom` / `marketplace`）；内联在 Prompt 菜单上方 |
| **TRUSTED** | 本项目唯一保留的来源面：custom + marketplace（System / OPEN 裁剪） |
| **run-skill** | `bin/run-skill.cjs` 统一脚本执行入口；LLM 经 bash 调用 |
| **scriptBase** | `run-skill` 第二个参数；指向 `scripts/<base>.<ext>` 的基名，须通过 `assertPathSegment` |
| **SkillLoader** | 扫描目录 + 解析 frontmatter + 实例级缓存 + `invalidate()` |
| **SkillRegistry** | S2 层：Source 去重、白名单、门控、`skill_search` |
| **Evolution SkillStore** | `config/schema.ts` 中 `evolution.skillsDir` 对应物（`skill_manage` 自进化）；与产品 Skill 系统物理隔离，勿混用 |
| **source 标签** | Skill 来源（custom / marketplace / builtin）；按根**绝对路径**判定，不靠 basename |
