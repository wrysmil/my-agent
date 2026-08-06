---
artifact: document-review
route: superpowers:document-review
skills:
  - document-review
skills_evidence:
  - .agents/skills/document-review/SKILL.md
  - .agents/skills/document-review/review-rules/design.md
  - .agents/skills/document-review/checklists/review-checklist.md
source:
  - docs/plan/Skill系统实现文档.md
  - docs/plan/仿写Skill系统指南.md
  - 项目代码事实核查（src/skills/、src/storage/、src/prompts/、src/tools/、chat.ts、test/、package.json）
reviewer: 独立子 Agent（generalPurpose）
reviewed_by: Leader（复核关键发现属实）
created_at: 2026-08-06
---

# Skill系统实现文档 审查报告

## 文档类型

架构/技术设计文档（含 S1–S3 阶段映射与批次实施顺序等计划要素；按 design > plan > spec 优先判定）。

## 审查规则加载

- [x] 通用审查流程（document-review SKILL.md）
- [x] 文档类型特定规则（review-rules/design.md）
- [x] 通用审查 checklist（checklists/review-checklist.md）
- [x] 环境准备审查规则（如适用，本文档为 Windows/Node 场景）

## 审查结果

### 1. 文档完整性
[评分：基本完整]

现状盘点、架构图、依赖图、五项取舍、S1–S3 落地、测试矩阵、边界、坑对照、批次实施顺序齐全；但缺环境准备专章、迁移回滚方案、术语表/文档元数据。

### 2. 逻辑清晰度
[评分：基本完整]

S1 破坏性变更表、S1.1 验收表清晰；但 §S1.7 的 Node 脚本约定自相矛盾（`module.exports` vs "调 `default` export"），§2.2 依赖图与 §5.6 对 runner 的描述冲突。

### 3. 环境准备完整性
[评分：不完整]

无 node 版本要求、无 `npm install`/`npm run check`/`npm test` 预检命令、无新增依赖声明；run-skill 调用约定依赖 `MY_NODE`/`APP_DIR` 两个本项目**不存在**的环境变量，且为 bash 语法，在 Windows/PowerShell 下不可执行。

### 4. 事实准确性
[评分：基本完整（含 1 处硬错误）]

13 处代码核对中绝大部分属实，现状盘点质量高；但测试数量「16 例」实为 **11 例**；S1.7 的 Node 脚本执行方式未适配项目 `"type": "module"`。

### 5. 可执行性
[评分：基本完整]

各模块有骨架代码、验收表、批次工作量预估；但 run-skill 是本项目核心验收，按文档照做会在 Node 脚本加载上直接失败，降低了整体可执行性。

## 缺失项清单

### High
1. **run-skill 的 Node 脚本执行约定与项目 ESM 冲突**（未适配 `"type": "module"`）——不修则 B1 核心验收（`run-skill.cjs hello-skill main` 跑通）无法达成。
2. **环境准备章节缺失**——无 node 版本、安装/预检命令、新增依赖声明，`MY_NODE`/`APP_DIR` 在本项目无定义。
3. **迁移回滚方案缺失**——Loader 静态→实例、去重"后者覆盖"→"先到先得"均为行为反转；仓库内 `skills/coding` 与新建 `dataRoot/skills` 并存时 chat.ts 扫描源如何切换未说明。

### Medium
4. **测试数量硬错误**（16 vs 11），§S1.1 的"现有 16 例基础上新增 5–8 例"失真。
5. **§2.2 依赖图「agent/runner 注入菜单」与 §5.6「runner 不注入技能菜单」矛盾**——图中未标注目标态/现状。
6. **run-skill 调用约定为 bash 语法**——与 `childProcess.exec`（cmd/PowerShell）不符，LLM 无法照抄。
7. **接口类型未定义完整**——`SkillSearchResult`、`search` 的 `opts`、`resolveAllowlistRefs` 返回类型缺失；`buildAvailableSkillsBlock` 的 `roots` 强制含 `"system"`，与取舍 4（system 暂缓）存在张力。

### Low
8. **文档元数据缺失**（无日期/版本/作者）；**术语表缺失**（蓝本有附录 C）。
9. **`pickDescription` 精确匹配 `"en"` 的限制未注明**（传 `"en-US"` 会回落中文）。
10. **`.ts` 扩展名的执行方式未说明**。
11. **`scriptBase` 描述与 `assertPathSegment` 实际语义不一致**（文档称禁止含 `.`，实际函数只拒绝 `..`、`/`、`\`、`\0`）。
12. **§10 坑对照第 3 行交叉引用错误**（标「§5.4」，实际在 §4 第 3 条与 §S1.7）。

## 事实出入清单（文档声称 vs 代码实际）

### 硬错误

| # | 严重度 | 文档声称 | 代码实际 |
|---|--------|---------|---------|
| D1 | High | `test/skill-loader.test.ts` 16 例 | **11 例**（parseFrontmatter 3 + SkillLoader 5 + pickDescription 3） |
| D2 | High | §S1.7 Node 脚本用 `module.exports`；执行规则「`require` + 调 `default` export」 | `package.json` `"type": "module"`：`.cjs` 对 `.js` 调 `require()` 抛 `ERR_REQUIRE_ESM`；CJS 模块无 `.default` 属性。文档自身约定与自身执行规则互相矛盾，且都未适配 ESM |
| D3 | Medium | §S1.7 调用约定 `"$MY_NODE" "$APP_DIR/bin/run-skill.cjs"` | 全仓库仅 `MY_AGENT_HOME` 有定义；`MY_NODE`/`APP_DIR` 无任何设置来源；`"$VAR"` 为 bash 语法，Windows 下不可执行 |
| D4 | Low | §2.2 依赖图「agent/runner 注入菜单」 | `runner.ts` `buildSystemPromptWithEvolution`（925–958 行）未传 `skillsIndex`，菜单确由 chat.ts 注入 |
| D5 | Low | §S1.7「`scriptBase` 禁止含 `/ \ . ..`（直接 `assertPathSegment` 语义）」 | `assertPathSegment`（paths.ts 73–88 行）只拒绝 `..`、`/`、`\`、`\0`，不拒绝单个 `.` |

### 核对通过项（示例）

§1.1 各模块现状、§1.2 缺口、§1.3 数据根/去重/递归扫描、§5.2 描述回退问题、§5.6 `meta.skillsLoaded`（types.ts 541–548）、§9 `jsonl.ts atomicWrite` / `schema.ts evolution.skillsDir`、session kind 白名单 `gconv/cli/anon/extract` 均与代码一致。现状盘点质量高，13 处核对中绝大多数属实。

## 改进建议（按优先级）

1. **(High) 重写 §S1.7 Node 脚本执行段**：
   - `.js`（或 `.mjs`）用动态 `import()` 加载，取 `mod.default ?? mod` 作为入口；`.cjs` 用 `require` + `module.exports`。删除「`require` + 调 `default`」矛盾表述。
   - fixture `main.js` 明确用 ESM `export default async function`（与本项目 `type: module` 一致），或改用 `main.cjs` + `module.exports`，二选一并写入验收表。
   - `.ts` 扩展名：写明用 `tsx` 执行，或从 Windows 分派表移除。
2. **(High) 新增「环境准备」小节**（放在 §5 之前）：Node ≥18、`npm install`、`npm run check`、`npm test` 预检；声明无新增第三方依赖；`MY_NODE`/`APP_DIR` 替换为 `process.execPath` 与 `import.meta.dirname`，给出 Windows 可执行示例 `node bin/run-skill.cjs <id> <script> -- args`。
3. **(High) 补迁移与回滚**：`skills/coding` 归属与过渡方案；静态 `scan` 兼容层移除条件与回退路径。
4. **(Medium) 修正测试数量**：16 → 11（或补足用例后再声称）。
5. **(Medium) 统一 §2.2 图与 §5.6**：图中 runner 一行标注"(目标态/S2)"。
6. **(Medium) 补齐接口类型**：定义 `SkillSearchResult`、`search` 的 `opts`、`resolveAllowlistRefs` 返回结构；`buildAvailableSkillsBlock` 的 `roots` 去掉强制 `system`。
7. **(Low) 补元数据与术语表**；注明 `pickDescription` 的 `lang === "en"` 精确匹配限制；规范化 `parseFrontmatter` 的 body trim 行为；修正 §10 第 3 行交叉引用。

## 审查结论

**FAIL（需修订后复审）。**

理由：
1. **核心执行路径在真实项目上必然失败**——S1.7 是 B1 验收核心，其 Node 脚本约定（`module.exports` + `require` + 调 `default`）与本项目 `"type": "module"` 直接冲突且文档内部自相矛盾；run-skill 调用约定依赖两个不存在的环境变量且为 Windows 下不可执行的 bash 语法。按 document-review 原则「缺失环境配置带来的返工比缺失功能更严重」，不能放行。
2. **存在 1 处事实硬错误**（16 vs 11），与"基于项目实际情况"声明相悖。
3. **环境准备章节缺失**，属该技能红色警报项。

正面：文档结构优秀，现状盘点质量高，破坏性变更标注、验收表、测试矩阵、与 Evolution SkillStore 的边界区分清晰。问题集中在 §S1.7、环境准备与迁移细节，修复范围局部可控；修订 High 项后应能通过复审。

## Next

- 需要补充 → 按本报告 §6 修订文档（先改 High 项 D1–D3 + 环境准备 + 迁移），修订完成后重跑复审
- 若只改 Medium/Low → 可选择性处理，但 D1 测试数量建议同步修正
