# Orkas 内置组件完整参考

> 面向仿造项目的完整清单：内置 Tools、Agents、Skills、Session 类型。

---

## 目录

1. [内置工具 (Tools)](#1-内置工具-tools)
2. [内置 Agent](#2-内置-agent)
3. [内置 Skill](#3-内置-skill)
4. [Session 类型](#4-session-类型)

---

## 1. 内置工具 (Tools)

**定义位置：** [src/main/model/core-agent/tool-catalog.ts](src/main/model/core-agent/tool-catalog.ts)

所有内置工具通过 `TOOL_CATALOG` 常量注册，按分组归类。共 **35 个内置工具**（不含 `extraTools`），分为 11 个组。

### 1.1 文件/工作区 (Files / workspace)

| 工具名 | 功能摘要 | 需要 localExec 权限 |
|--------|---------|-------------------|
| `read_file` | 从工作区或附件文件读取文本切片（PDF/现代 Office 文本或图像作为多模态） | — |
| `write_file` | 将文本/代码/markdown 写入工作区；路径解析基于 `$working_dir` | ✅ |
| `edit_file` | 对现有文本文件进行原地 `old_string → new_string` 替换（替代重写整个文件） | ✅ |
| `delete_file` | 删除单个文件；范围内的直接删除，范围外的弹出确认卡片 | ✅ |
| `list_files` | 列出工作区目录树 | — |
| `stat_file` | 触发 PDF/现代 Office 提取并返回 total_chars；在 read_file 之前调用 | — |
| `ocr_file` | 当 read_file/stat_file 无法获取可视文本时，对 PDF 页面或图像文件运行本地 OCR | — |
| `search_files` | 按名称/glob 在工作区+附件范围内查找文件 | — |
| `grep_files` | 在工作区+附件范围内搜索文本（PDF/现代 Office 自动提取后搜索）；可选 `glob` + `output_mode` | — |
| `tool_result_search` | 通过不透明引用搜索持久化的超大工具结果，返回有界匹配摘录 | — |
| `tool_result_read_chunk` | 通过不透明引用从持久化的超大工具结果中读取一个有界游标块 | — |
| `publish_outputs` | 声明当前回合中应作为最终交付物出现在消息页脚中的完整文件集 | — |
| `create_artifact` | 构建交互式多文件应用（HTML/CSS/JS），在聊天气泡内实时渲染并可点击；用于交互式仪表板/计算器/可视化/迷你工具 | ✅ |

### 1.2 Shell（命令行）

| 工具名 | 功能摘要 | 需要 localExec 权限 |
|--------|---------|-------------------|
| `bash` | 在用户机器上执行 shell 命令（cwd = `$working_dir`） | ✅ |
| `interactive_cli_start` | 为预期等待用户输入的任何本地 CLI 命令启动实时 stdin/stdout 会话 | ✅ |
| `interactive_cli_read` | 从交互式 CLI 会话读取状态和最近输出 | ✅ |
| `interactive_cli_send` | 向交互式 CLI 会话发送非机密 stdin；用户机密必须通过 UI 面板输入 | ✅ |
| `interactive_cli_close` | 终止交互式 CLI 会话及其进程树 | ✅ |

### 1.3 PDF（便携文档）

| 工具名 | 功能摘要 | 需要 localExec 权限 |
|--------|---------|-------------------|
| `markdown_to_pdf` | Markdown → PDF（中日韩友好，零外部依赖） | ✅ |
| `html_to_pdf` | HTML → PDF（相同渲染器） | ✅ |

### 1.4 Office 文档

捆绑 OfficeCLI 引擎 — 无需 MS Office。

| 工具名 | 功能摘要 | 需要 localExec 权限 |
|--------|---------|-------------------|
| `create_docx` | 从段落创建 Word (.docx) 文档（样式+内联粗体/字体/大小/颜色），外加表格和图像；中日韩就绪，首页 PNG 预览 | ✅ |
| `create_xlsx` | 从行数据创建 Excel (.xlsx) 工作簿（值+公式+数字格式+单元格填充/字体/对齐/边框），支持多工作表和列宽；中日韩就绪，PNG 预览 | ✅ |
| `create_pptx` | 创建 PowerPoint (.pptx) 演示文稿（标题/正文/布局，幻灯片背景/过渡，自由定位样式形状，加上图像和表格）；中日韩就绪，首页 PNG 预览 | ✅ |
| `office_read` | 读取现有 .docx/.xlsx/.pptx 的元素路径（text/outline/get/query），以便编辑可定位到具体元素；与 edit_office 配对 | ✅ |
| `edit_office` | 原地编辑现有 .docx/.xlsx/.pptx（在元素路径上 set/add/remove），保留格式；返回 PNG 预览 | ✅ |
| `office_render` | 将现有 .docx/.xlsx/.pptx 的一页渲染为 PNG 图像，以检查布局/字体/中日韩字形 | ✅ |

### 1.5 资料库 (Library / KB)

| 工具名 | 功能摘要 | 备注 |
|--------|---------|------|
| `kb_list` | 列出资料库文件和索引状态，在选择搜索或读取内容之前使用 | — |
| `kb_search` | 对用户资料库进行语义搜索 | — |
| `kb_read` | 读取 kb_search 命中的资料库文件的源文本块 | — |
| `research_rerank` | 通过本地嵌入相似度对候选研究段落进行语义重排序 — 深度研究压缩 skill 的词法过滤之后的第二阶段 | 仅对所有者为 DeepResearcher/KnowledgeManager/SocialResearcher/BrandResearcher 的 Agent 可见 |

### 1.6 会话历史

| 工具名 | 功能摘要 |
|--------|---------|
| `chat_search` | 搜索先前的消息以查找缺失的连续性上下文；项目对话默认搜索同项目历史 |
| `chat_read` | 读取 chat_search 命中附近的对话消息，或已知对话的最新消息 |

### 1.7 图像

| 工具名 | 功能摘要 | 需要 localExec 权限 |
|--------|---------|-------------------|
| `generate_image` | 调用配置的图像生成 API 并将结果保存到工作区 | ✅ |

### 1.8 视频

| 工具名 | 功能摘要 | 备注 |
|--------|---------|------|
| `video_studio` | VideoStudio 拥有的本机运行时，用于 HTML 预览、QA 门控草稿/导出以及语音转录回退编排 | 仅对 VideoStudio Agent (id: `79df9cc89f5f`) 可见 |

### 1.9 网页

| 工具名 | 功能摘要 |
|--------|---------|
| `web_search` | 内置回退网络搜索（当有供应商原生搜索时自动优先使用原生搜索） |
| `web_fetch` | 获取 URL 的正文内容；与 web_search 配对 |

### 1.10 连接器 (Connectors — 第三方服务)

| 工具名 | 功能摘要 |
|--------|---------|
| `list_connector_tools` | 发现特定连接器公开的操作（返回每个操作的名称+JSON 输入 schema） |
| `call_connector_tool` | 在连接器上调用操作；先调用 list_connector_tools 了解操作名称和 schema |
| `add_custom_connector` | 仅指挥官：添加用户描述的自定义 MCP 服务器（安装前需要用户确认对话框） |

### 1.11 任务/跨会话状态 (Meta)

| 工具名 | 功能摘要 |
|--------|---------|
| `manage_execution_plan` | 管理持久的当前任务目标和里程碑状态，用于长/工具密集型工作；会话本地，独立于上下文摘要 |
| `cross_session_memory` | 读/写跨会话持久化的用户档案、共享事实和 agent 记忆 |
| `project_instructions` | 替换项目的常设目标+规则（ORKAS.md，项目指令块）；仅指挥官，项目会话 |
| `project_tasks` | 读/更新项目的共享结构化任务积压；仅项目会话 |
| `metacognition` | 读/写元认知（COMPETENCE / LEARNING_STRATEGIES）；通过环境标志门控 |

### 1.12 额外工具 (Extra Tools — 由调用方提供)

以下工具不在 `TOOL_CATALOG` 中，由 `extraTools` 参数注入：

- `dispatch_to` — 指挥官将任务分派给群聊中的 Agent
- `run_worker` — 启动 Agent Worker
- `auto_tasks_list` — 列出自动化任务
- `marketplace_*` — Marketplace 浏览/搜索/安装相关
- `skill_search` — 搜索可用 Skill

---

## 2. 内置 Agent

**定义位置：** `resources/builtin/marketplace/agents/`

共 **4 个内置 Agent**，每个 Agent 具有独立的 `agent.json` 配置文件和嵌入式 Skill 集合。

### 2.1 DeepResearcher（深度研究）

| 属性 | 值 |
|------|-----|
| **ID** | `78900d8758bc` |
| **版本** | 1.0.6 |
| **分类** | data |
| **图标** | search |
| **颜色** | sky |
| **交互式** | 是 |
| **运行时** | in_process |
| **输出格式** | 文本报告 |

**中文描述：** 复杂主题的证据型深度研究：拆解问题、规划研究路径、检索网页与学术来源、整理用户材料、压缩证据、核验引用与来源质量，输出带置信度、矛盾点、限制说明和参考来源的可复核研究报告。

**输入参数：**
- `task` (textarea, 必填) — 研究问题
- `materials` (file, 可选, 多选) — 相关材料 (.pdf/.doc/.docx/.txt/.md/.csv/.tsv/.xlsx/.xls/.json/.png/.jpg/.jpeg)

**关联 Skill：**
- `ee99fbb42964` → deep-research（深度研究引擎）
- `9be6fda271a5` → material-organizer（资料整理）
- `e7f5c0e6f1be` → social-data（社媒数据）
- `6743aa0797a2` → brand-research（品牌研究）

**特殊能力：** 拥有 `research_rerank` 工具的独占访问权。

---

### 2.2 VideoStudio（视频工作室）

| 属性 | 值 |
|------|-----|
| **ID** | `79df9cc89f5f` |
| **版本** | 1.1.0 |
| **分类** | creation |
| **图标** | flame |
| **颜色** | violet |
| **交互式** | 是 |
| **运行时** | in_process |
| **输出格式** | artifact |
| **最低应用版本** | 1.6.0 |

**中文描述：** 做视频、也剪视频：解说/动画、AI 口播数字人、给已有视频加字幕/配音旁白、剪辑切片、高光、本地化、混音降噪。

**三条产线：**
1. **COMPOSE** — 解说/动画（脚本→分镜→HTML 合成渲染 mp4）
2. **GENERATE** — AI 生成实拍（口播/数字人）
3. **EDIT** — 剪辑用户上传的真实视频

**输入参数：**
- `topic` (textarea, 必填) — 视频主题/内容
- `aspect_ratio` (select: 16:9 / 9:16 / 1:1, 默认 16:9) — 宽高比
- `language` (select: en / zh, 默认 en) — 视频语言
- `duration_seconds` (number, 默认 60) — 时长（秒）

**关联 Skill (13 个，全部为 embedded_skills)：**
- `video-router` — 路由选择产线
- `gate-control` — 审批门控转换
- `frontend-design` — 前端设计美学
- `design-system-importer` — 设计系统导入
- `composition-design-review` — 组合设计审查
- `video-craft` — 视频工艺规范
- `stage-compose` — COMPOSE 产线阶段
- `stage-edit` — EDIT 产线阶段
- `stage-decide` — 决策阶段
- `stage-generate` — GENERATE 产线阶段
- `stage-consistency` — 一致性阶段
- `stage-plan` — 规划阶段
- `stage-assemble` — 组装阶段

**特殊能力：** 拥有 `video_studio` 工具的独占访问权。

---

### 2.3 UIDesigner（UI 设计师）

| 属性 | 值 |
|------|-----|
| **ID** | `bcfcb4921dce` |
| **版本** | 1.3.0 |
| **分类** | rnd |
| **图标** | palette |
| **颜色** | violet |
| **交互式** | 否 |
| **运行时** | in_process |
| **输出格式** | artifact |

**中文描述：** 将产品目标、PRD、现有界面、截图、可读取的 Figma/设计稿材料或品牌参考转成默认以 HTML 呈现、可连续修改并可独立打包的 UI 设计产物。

**输入参数：**
- `request` (textarea, 必填) — UI 请求
- `repo_path` (directory, 可选) — 本地应用路径
- `artifact_path` (directory, 可选) — 现有 artifact 目录
- `references` (file, 可选, 多选) — 设计参考（图片/.pdf/.fig/.json/.md/.txt/.html/.css/.js 等）

**关联 Skill (13 个，全部为 embedded_skills)：**
- `ui-design-executor` — 核心执行器（包含基线设计、品味、token、无障碍、响应式等）
- `ui-artifact-workspace` — Artifact 工作区管理
- `ui-design-source` — 可检查源（截图/Figma/PDF/HTML 等）
- `ui-live-artifact` — 实时/数据连接 Artifact
- `ui-design-contract` — 持久多屏幕/品牌方向
- `ui-reference-packs` — 显式风格参考
- `ui-design-system` — 可复用设计系统
- `ui-controls-accessibility` — 复杂表单/复合控件/无障碍审计
- `ui-taste` — 反通用/表达性品味
- `ui-color` — 调色板/暗色/图表/对比度
- `ui-html-renderer` — 复杂有状态 HTML 渲染
- `ui-craft-checks` — 正式审查/QA/交付
- `ui-design-review` — 设计审查

---

### 2.4 SeoGeoAgent（SEO/GEO 优化）

| 属性 | 值 |
|------|-----|
| **ID** | `e064dca9e1bd` |
| **版本** | 1.0.2 |
| **分类** | data |
| **图标** | target |
| **颜色** | gold |
| **交互式** | 否 |
| **运行时** | in_process |
| **输出格式** | dashboard |

**中文描述：** SEO/GEO 诊断与优化：给一个 URL，抓取+技术审计+内容质量+结构化数据+核心网页指标(CWV)+GEO 可引用性评分，出健康分、分级行动清单、可视化看板；能持续监控漂移、在拿到本地仓库时直接改代码并复测、按 GEO 模式写/优化内容。

**五种工作模式：**
1. **DIAGNOSE**（默认）— 完整诊断流水线
2. **QUICK DIAGNOSE** — 仅本页快速诊断
3. **MONITOR** — 对比基线监控漂移
4. **APPLY** — 本地仓库代码修复+复测
5. **CONTENT** — 写/优化内容

**输入参数：**
- `url` (text, 必填) — 目标 URL
- `repo_path` (directory, 可选) — 本地仓库路径

**关联 Skill (10 个，全部为 embedded_skills)：**
- `seo-crawl` — SEO 抓取
- `seo-tech-audit` — 技术审计
- `seo-content` — 内容分析
- `seo-schema` — 结构化数据
- `seo-cwv` — Core Web Vitals
- `geo-score` — GEO 可引用性评分
- `geo-probe` — AI 可见性探测
- `seo-opportunity` — 关键词/流量机会
- `seo-monitor` — 持续监控
- `seo-report` — 报告生成

---

## 3. 内置 Skill

Skill 分两类：**系统 Skill**（平台级，对所有 Agent 可见）和 **Marketplace Skill**（按需安装/引用）。

### 3.1 系统 Skill

**定义位置：** `resources/builtin/system/skills/`

| Skill ID | 名称 | 用途 |
|----------|------|------|
| `agent-creator` | agent-creator | 创建/编辑自定义 Agent，通过 `<agent>` 容器输出 |
| `skill-creator` | skill-creator | 创建/编辑自定义 Skill，通过 `<skill>` 容器和 `<<<skill-file>>>` 块输出 |
| `coding` | coding | 非平凡代码变更的工程规范：遵循仓库约定、计划、最小化编辑、验证 |
| `package-installer` | package-installer | 安装 GitHub 仓库/本地 git 目录为外部包 |
| `autotask-creator` | autotask-creator | 创建/修改/删除/启停自动化任务，通过 `<auto-task>` 容器输出 |

**系统 Skill 特征：**
- 不通过 Marketplace 分发
- 对所有执行上下文可见
- agent-creator 和 skill-creator 是编写规范的权威来源
- coding 是编码工程判断的通用 Skill

---

### 3.2 独立 Marketplace Skill

**定义位置：** `resources/builtin/marketplace/skills/`

这些 Skill 可被 Agent 通过 `skill_list` 引用，也可独立安装。

#### deep-research (`ee99fbb42964`)

- **分类：** data
- **版本：** 1.0.3
- **描述：** 深度研究引擎的确定性脚本组（四个操作）：
  - `caps` — 计算并强制抓取/成本预算上限
  - `academic` — 免费检索 arXiv/Crossref/OpenAlex/PubMed
  - `compress` — 按词面重叠去重压缩候选段落
  - `citations` — 逐条核验模型起草的"论断+引用"
- **实现：** Python 脚本，不调用模型，同样输入永远同样结果
- **参考文件：** 6 个 references（citation-style, evidence-standards, report-structure, research-workflow, scholarly-evidence, source-quality）

#### material-organizer (`9be6fda271a5`)

- **分类：** data
- **版本：** 1.0.1
- **描述：** 整理用户已提供的链接、PDF、Word、图片、文本片段或本地目录，做要点提取、来源溯源、知识卡沉淀、实体关系、去重归类、异常记录和关键词索引
- **参考文件：** 6 个 references（classification-rules, dedup-strategy, directory-organizing, extraction-rules, knowledge-flow, output-schema）

#### social-data (`e7f5c0e6f1be`)

- **分类：** data
- **版本：** 1.0.2
- **描述：** 采集和分析社媒数据：抓取小红书、X/Twitter、Reddit、YouTube、Bilibili 的公开帖子，或分析用户提供的社媒/活动数据，计算参与率、CTR、ROI、成本指标等
- **实现：** Python 脚本（fetch.py, analyze_performance.py, calculate_metrics.py, social_fetch_core.py）
- **参考文件：** 2 个 references（fetching, metrics）

#### brand-research (`6743aa0797a2`)

- **分类：** data
- **版本：** 1.0.1
- **描述：** 研究公司、产品或品牌的公开资料，整理 Brand DNA：定位、受众、竞品、语气、定价、社交证明、来源链接和内容缺口
- **参考文件：** 1 个 reference（brand-dna-template.md）

---

### 3.3 嵌入式 Agent Skill（概览）

这些 Skill 内嵌在 Agent 目录中，不独立分发。完整列表见上方各 Agent 的 `skill_list`/`embedded_skills`。

**VideoStudio 内嵌 Skill (13 个)：**
`video-router`, `gate-control`, `frontend-design`, `design-system-importer`, `composition-design-review`, `video-craft`, `stage-compose`, `stage-edit`, `stage-decide`, `stage-generate`, `stage-consistency`, `stage-plan`, `stage-assemble`

**UIDesigner 内嵌 Skill (13 个)：**
`ui-design-executor`, `ui-artifact-workspace`, `ui-design-source`, `ui-live-artifact`, `ui-design-contract`, `ui-reference-packs`, `ui-design-system`, `ui-controls-accessibility`, `ui-taste`, `ui-color`, `ui-html-renderer`, `ui-craft-checks`, `ui-design-review`

**SeoGeoAgent 内嵌 Skill (10 个)：**
`seo-crawl`, `seo-tech-audit`, `seo-content`, `seo-schema`, `seo-cwv`, `geo-score`, `geo-probe`, `seo-opportunity`, `seo-monitor`, `seo-report`

---

## 4. Session 类型

**定义位置：** [src/main/model/core-agent/session-store.ts](src/main/model/core-agent/session-store.ts)

Session ID 格式：`<kind>-<tail>`

### 可恢复 Session（存储在 `cloud/sessions/`）

| Kind | 用途 | 说明 |
|------|------|------|
| `gconv` | 指挥官会话 | 群聊的主对话，ID 为 `gconv-<cid>` |
| `gmember` | Agent Worker 会话 | 群聊中单个 Agent 的工作会话，ID 为 `gmember-<cid>-<agentId>` |
| `skill` | Skill 编辑会话 | Skill 内联编辑对话 |
| `agent` | Agent 编辑会话 | Agent 内联编辑对话 |
| `gworker` | Agent Worker（CLI 代理） | CLI Agent 的工作会话 |

### 短暂 Session（存储在 `local/sessions/`，7 天 GC）

| Kind | 用途 |
|------|------|
| `extract-img` | KB 图像理解（单图 → 描述） |
| `reflect` | Agent 元认知/反思 |
| `memory-extract` | 从压缩摘要周期提取事实 |
| `anon` | `streamChatWithModel` 未传 sessionId 时的回退 |
| `cli` | CLI Agent 的本地执行上下文 |

### Memory 作用域规则

- `gconv` → memory scope 为 `'commander'`（或传入的 agentId）
- `gmember` / `gworker` / `cli` → memory scope 为 agent id
- `agent` / `skill` / `extract-img` / `anon` / `reflect` / `memory-extract` → **无** memory 读写权限

