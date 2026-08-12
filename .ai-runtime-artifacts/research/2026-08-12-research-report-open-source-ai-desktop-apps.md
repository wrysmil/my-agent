---
artifact: research-report
route: web-investigator
created_at: 2026-08-12
topic: open-source-ai-desktop-apps
---

# 开源 AI 桌面应用调研报告

## 调研目标

全面梳理当前（截至 2026-08-12）GitHub 上主流的开源 AI 桌面应用，按 star 数、活跃度、技术栈、功能定位等维度进行分类分析，为选型或技术参考提供依据。

## 搜索结果摘要

数据来源：GitHub 仓库搜索 (`ai desktop app`，按 stars 降序排列) 及各项目主页直接抓取。

| # | 项目 | Stars | 许可证 | 语言/框架 | 定位 |
|---|------|-------|--------|-----------|------|
| 1 | nomic-ai/gpt4all | 77.4k | MIT | C++/Python/Qt | 本地 LLM 运行器 |
| 2 | lencx/ChatGPT | 54.4k | 未明确 | Rust/Tauri | ChatGPT 桌面包装器 |
| 3 | CherryHQ/cherry-studio | 50.3k | AGPL-3.0 | TypeScript/Electron | 多模型 AI 生产力工作室 |
| 4 | janhq/jan | 44.0k | Apache 2.0 | Rust/Tauri | 离线 ChatGPT 替代品 |
| 5 | HBAI-Ltd/Toonflow-app | 13.7k | 未明确 | TypeScript/Electron | AI 短剧创作工具 |
| 6 | dice2o/BingGPT | 8.9k | 未明确 | JavaScript/Electron | Bing AI 桌面客户端 |
| 7 | ValueCell-ai/ClawX | 7.6k | 未明确 | TypeScript | OpenClaw AI Agent GUI |
| 8 | Sylinko/Everywhere | 6.2k | 未明确 | C# | 屏幕感知桌面 AI 助手 |
| 9 | lightningpixel/modly | 4.9k | 未明确 | TypeScript | 图片→3D 模型生成 |
| 10 | buxuku/SmartSub | 4.6k | 未明确 | TypeScript | 视频字幕+AI 配音 |
| 11 | JabRef/jabref | 4.6k | MIT | Java | 文献管理（含 AI/OCR） |
| 12 | xingkongliang/skills-manager | 3.7k | 未明确 | Rust/Tauri | AI Agent 技能管理器 |
| 13 | lxf746/any-auto-register | 3.1k | 未明确 | Python | AI 平台账号自动注册 |

## 详细发现

### 1. GPT4All（nomic-ai）— 本地 LLM 运行标杆

- **仓库**: https://github.com/nomic-ai/gpt4all
- **Stars**: 77.4k | **Forks**: 8.3k | **Commits**: 2,289
- **许可证**: MIT（可商用）
- **定位**: 在日常台式机/笔记本上**完全本地**运行大语言模型。无需 API 调用、无需 GPU。
- **技术栈**: C++（llama.cpp 后端）、Python 绑定、Qt 桌面 UI
- **核心能力**:
  - 支持 DeepSeek R1 Distillations
  - Python 客户端: `pip install gpt4all` → `GPT4All("Meta-Llama-3-8B-Instruct.Q4_0.gguf")`
  - 集成: LangChain、Weaviate 向量数据库、OpenLIT (OTel 监控)
  - Docker 驱动的 OpenAI 兼容 API 服务器
  - Nomic Vulkan 支持 NVIDIA/AMD GPU 本地推理
- **平台**: Windows (x64 + ARM/骁龙)、macOS 12.6+ (Apple Silicon 最佳)、Linux x86-64（无 ARM）
- **系统要求**: Intel Core i3 2nd Gen / AMD Bulldozer 以上
- **关键里程碑**: 2024-07 v3.0 UI 重设计 + LocalDocs 改进；2023-10 GGUF 支持；2023-09 Vulkan GPU 加速；2023-06 Docker API 服务器

### 2. lencx/ChatGPT — ChatGPT 桌面包装器先驱

- **仓库**: https://github.com/lencx/ChatGPT
- **Stars**: 54.4k
- **技术栈**: Rust / Tauri
- **定位**: ChatGPT 的跨平台桌面应用（Mac/Win/Linux），最早一批第三方 ChatGPT 桌面客户端
- **现状**: 最后更新 2024-08，项目趋于停滞，但仍保有大量 star
- **评价**: 历史意义大，但维护活跃度已显著下降

### 3. Cherry Studio（CherryHQ）— 多模型聚合生产力平台

- **仓库**: https://github.com/CherryHQ/cherry-studio
- **Stars**: 50.3k | **Forks**: 4.8k | **Commits**: 8,193
- **许可证**: AGPL-3.0
- **技术栈**: TypeScript / Electron / pnpm workspace
- **定位**: 支持多个 LLM 提供商的生产力桌面客户端，README 支持 20 种语言
- **核心能力**:
  - ☁️ 云端模型: OpenAI、Gemini、Anthropic
  - 🔗 AI Web 服务: Claude、Perplexity、Poe
  - 💻 本地模型: **Ollama、LM Studio**
  - 📚 300+ 预配置 AI 助手 + 自定义助手
  - 💬 多模型同时对话
  - 📄 文档处理: 文本/图片/Office/PDF
  - ☁️ WebDAV 备份
  - 📊 Mermaid 图表、代码高亮、全局搜索、主题管理
  - ⚙️ MCP 服务器支持
  - 🎨 主题市场 (cherrycss.com)，支持透明窗口
- **路线图**: Deep Research、MCP 市场、知识管理/笔记/画布/OCR/TTS、鸿蒙 PC 版、Android/iOS App、多窗口、插件系统、ASR、Intel Core Ultra 支持
- **开发者共创计划**: 每季度 30+ 有意义的 commits → $70 Cursor 订阅额度 + 无限 DeepSeek/Qwen API + 偶尔的 Claude/Gemini/OpenAI API 访问
- **活跃度**: 极活跃（855 issues, 413 PRs, 持续更新）

### 4. Jan（janhq）— 离线优先的 ChatGPT 替代品

- **仓库**: https://github.com/janhq/jan
- **Stars**: 44.0k | **Forks**: 3.0k | **Commits**: 8,260
- **许可证**: Apache 2.0
- **技术栈**: Rust / Tauri / TypeScript
- **定位**: "100% 离线运行的开源 ChatGPT 替代品"
- **核心能力**:
  - 从 HuggingFace 下载并运行本地 LLM（Llama、Gemma、Qwen、GPT-oss 等）
  - 云端集成: OpenAI、Anthropic/Claude、Mistral、Groq、MiniMax
  - 自定义 AI 助手
  - **OpenAI 兼容 API 服务器**（`localhost:1337`）
  - **MCP 集成**，支持 agentic 能力
  - 隐私优先: 所有数据可完全本地运行
- **平台**: macOS 13.6+、Windows 10+ (NVIDIA/AMD/Intel Arc GPU)、Linux
- **系统要求**: macOS 8GB RAM (3B 模型) / 16GB (7B) / 32GB (13B)
- **构建**: Node.js ≥20.0.0, Yarn ≥4.5.3, Make ≥3.81, Rust + MetalToolchain (Apple Silicon)
- **活跃度**: 活跃（354 issues, 91 PRs）

### 5. Toonflow（HBAI-Ltd）— AI 短剧创作

- **仓库**: https://github.com/HBAI-Ltd/Toonflow-app
- **Stars**: 13.7k
- **技术栈**: TypeScript / Electron
- **定位**: 开源 AI 短剧创作工具，小说→动画短片全流程（AI 编剧、分镜、角色/视频生成）

### 6. BingGPT（dice2o）— Bing AI 桌面客户端

- **Stars**: 8.9k
- **技术栈**: JavaScript / Electron
- **定位**: New Bing AI Chat 桌面应用，跨平台
- **现状**: 最后更新 2024-02，已不活跃

### 7. ClawX（ValueCell-ai）— AI Agent GUI

- **Stars**: 7.6k
- **技术栈**: TypeScript
- **定位**: OpenClaw AI Agent 的桌面 GUI，将 CLI 编排转化为桌面体验
- **活跃度**: 极高（抓取前 25 分钟刚有更新）

### 8. Everywhere（Sylinko）— 屏幕感知桌面 AI 助手

- **Stars**: 6.2k
- **技术栈**: C#
- **定位**: 根据当前屏幕应用上下文提供 AI 辅助，支持多种 LLM、MCP 工具
- **活跃度**: 高（抓取前一天更新）

### 9. modly（lightningpixel）— 图片转 3D 模型

- **Stars**: 4.9k
- **技术栈**: TypeScript
- **定位**: 通过本地 AI 从图片生成 3D 模型，纯 GPU 本地运行

### 10. SmartSub（buxuku）— 视频字幕+AI 配音

- **Stars**: 4.6k
- **技术栈**: TypeScript
- **定位**: 视频→字幕提取、字幕翻译、AI 配音、声音克隆、字幕烧录。基于本地 Whisper/FunASR，完全离线。跨平台。

### 11. skills-manager（xingkongliang）— AI Agent 技能管理

- **Stars**: 3.7k
- **技术栈**: Rust / Tauri
- **定位**: 轻量桌面应用，管理/同步/组织 50+ 编程工具（Claude Code、Codex、Cursor、Copilot 等）的 AI Agent 技能
- **评价**: 针对开发者群体的垂直工具，与 AI 编码生态深度绑定

## 横向对比分析

### 按定位分类

| 类别 | 项目 |
|------|------|
| **本地 LLM 运行器** | GPT4All、Jan |
| **多模型聚合客户端** | Cherry Studio、lencx/ChatGPT、BingGPT |
| **AI Agent 工具** | ClawX、Everywhere、skills-manager |
| **垂直 AI 创作** | Toonflow（短剧）、modly（3D）、SmartSub（字幕） |
| **AI 辅助办公** | JabRef（文献管理） |

### 按技术栈分类

| 框架 | 项目 |
|------|------|
| **Tauri (Rust)** | lencx/ChatGPT、Jan、skills-manager — 更轻量，性能更好 |
| **Electron (JS/TS)** | Cherry Studio、Toonflow、BingGPT — 生态成熟，开发效率高 |
| **原生 (C++/C#)** | GPT4All、Everywhere — 性能最优 |

### 按许可证分类

| 许可证 | 项目 |
|--------|------|
| **MIT** | GPT4All、JabRef — 最宽松，可商用 |
| **Apache 2.0** | Jan — 宽松，含专利授权 |
| **AGPL-3.0** | Cherry Studio — 强 copyleft，网络使用也需开源 |

### 活跃度评估（2026-08）

| 项目 | 活跃度 | 说明 |
|------|--------|------|
| Cherry Studio | ⭐⭐⭐⭐⭐ | 极活跃，8k+ commits，持续 roadmap 推进 |
| Jan | ⭐⭐⭐⭐ | 活跃，8k+ commits，稳定迭代 |
| GPT4All | ⭐⭐⭐ | 中等活跃，功能成熟但更新频率下降 |
| ClawX | ⭐⭐⭐⭐⭐ | 极高频更新 |
| Everywhere | ⭐⭐⭐⭐ | 活跃 |
| lencx/ChatGPT | ⭐ | 停滞（最后更新 2024-08） |
| BingGPT | ⭐ | 停滞（最后更新 2024-02） |

## 结论

1. **GPT4All (77.4k stars)** 是当前 star 数最高的开源 AI 桌面应用，定位为纯本地 LLM 运行器，MIT 许可证最友好，适合需要隐私和离线使用的场景。

2. **Cherry Studio (50.3k stars)** 是增长最快的多模型聚合客户端，AGPL-3.0 许可证，功能最全面（云端+本地+300 助手+MCP），且拥有最活跃的开发者社区和完善的路线图。

3. **Jan (44.0k stars)** 在"离线 ChatGPT 替代"定位上最为专注，Apache 2.0 许可友好，MCP 集成使其具备 agentic 能力，技术栈（Tauri）比 Electron 更轻量。

4. **Tauri 正在成为 AI 桌面应用的首选框架** — Jan、skills-manager 均采用 Tauri，相比 Electron 内存占用更低、性能更好。

5. **MCP（Model Context Protocol）已成为标配** — Cherry Studio、Jan、Everywhere 均集成了 MCP，表明 agentic 能力是当前 AI 桌面应用的核心趋势。

6. 早期项目（lencx/ChatGPT、BingGPT）已停滞，新项目（Cherry Studio、ClawX、Everywhere）在功能和活跃度上全面超越。

## 建议

- **如需纯本地/隐私优先**: 首选 **GPT4All**（MIT 许可，生产就绪）或 **Jan**（Apache 2.0，MCP 集成）
- **如需多模型聚合 + 生产力**: 首选 **Cherry Studio**（功能最全，社区最活跃）
- **如需开发 AI Agent 桌面工具**: 参考 **ClawX**（Agent GUI 模式）和 **Everywhere**（屏幕感知模式）
- **如需嵌入 AI 桌面应用到自有产品**: 优先考虑 MIT/Apache 2.0 许可的项目（GPT4All、Jan）
- **技术选型建议**: 新项目优先考虑 Tauri（Rust）而非 Electron，以获得更好的性能和更小的安装包

## Next

- 如需深入某个项目的架构分析 → 说「写 spec」或「制定实施计划」
- 如需对比测试（安装体验、性能 benchmark） → 说明具体测试维度
- 仅需存档 → 无需继续
